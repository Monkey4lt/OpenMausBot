// The workflow pieces of the server, built from what server/index.ts already has: the store, the runner with its steps
// wired to the app's engines, bots, cards and notifications, and the routes.
import { viewersDefaultBot, type DefaultBotFields } from "../../shared/default-bot.ts";
import type { Notification } from "../../shared/notification.ts";
import type { WorkflowRun } from "../../shared/workflows.ts";
import type { RoutineRun } from "../routines.ts";
import { buildNotification, summarize } from "../notify.ts";
import type { OutboundRequestService } from "../outbound-requests.ts";
import { clean } from "../records-block.ts";
import { serverLine, type ServerLineKey } from "../server-lines.ts";
import type { SideJobText } from "../side-jobs.ts";
import { flushUsageLedger, readUsage } from "../usage-ledger.ts";
import { KIND_NAME } from "./graph.ts";
import { findProject, readProjectMapState } from "../projects.ts";
import { createWorkflowCartographeRoutes, type WorkflowCartographeDeps } from "./cartographe.ts";
import { createWorkflowRoutineLink, type WorkflowRoutines } from "./routine-link.ts";
import { createWorkflowRoutes } from "./routes.ts";
import { createWorkflowRunner } from "./runner.ts";
import { StepError, type Cost, type StepDeps } from "./steps.ts";
import { createWorkflowStore } from "./store.ts";

export const WORKFLOW_APPROVAL_TOOL = "workflow_approval";
const AI_TIMEOUT_MS = 10 * 60_000;

export interface WorkflowHostBot {
  id: string;
  name: string;
  threadId: string;
  color?: string;
  avatarUrl?: string;
  notifications?: boolean;
  hidden?: boolean;
}

export interface WorkflowHostDeps {
  dataDir: string;
  language(): string | undefined;
  botExists(id: string): boolean;
  broadcast(payload: Record<string, unknown>, options?: { adminOnly?: boolean }): void;
  /** The place's MausBot (else its first bot shown) writes AI and Condition blocks with its side-job engine, and its
   * chat gets approval cards, notifications and failure news. */
  bots(): readonly (WorkflowHostBot & DefaultBotFields)[];
  bot(id: string): WorkflowHostBot | null | undefined;
  /** A side-job text call for `botId`, on `instanceId` when the block names one; null when nobody can write it. */
  sideText(botId: string, instanceId?: string): SideJobText | null;
  /** False once the app's monthly spend limit is reached. */
  budgetAllows(): boolean;
  createTask(botId: string, title: string): { threadId: string } | null | undefined;
  /** A turn whose prompt carries data from other steps: it must start with the untrusted-data boundary of the app's
   * automations, at the bot's own access level. */
  startTurn(botId: string, prompt: string, opts: { threadId: string; onSettled(outcome: { ok: boolean; text: string }): void; onDispatchError(message: string): void }): Promise<void>;
  interruptTurn(botId: string, threadId: string): Promise<void> | void;
  appendMessage(threadId: string, message: Record<string, unknown>): void;
  dismissCard(threadId: string, requestId: string): void;
  outboundRequests: Pick<OutboundRequestService, "open" | "forget">;
  notify(notification: Notification | null): void;
  /** The routines engine, once it is up: a workflow whose trigger runs on a schedule gets its own routine. */
  routines?(): WorkflowRoutines | null;
  /** The Cartographe's side: absent, it gets no workflow routes. */
  cartographe?: Pick<WorkflowCartographeDeps, "chat" | "isCartographe" | "active" | "mcpCallTimeoutMs">;
}

/** "<instanceId>" or "<instanceId>/<model>"; a model id may itself hold slashes. */
export function splitModelRef(ref: string | undefined): { instanceId?: string; model?: string } {
  const value = ref?.trim();
  if (!value) return {};
  const slash = value.indexOf("/");
  if (slash === -1) return { instanceId: value };
  const instanceId = value.slice(0, slash).trim(), model = value.slice(slash + 1).trim();
  return { ...(instanceId ? { instanceId } : {}), ...(model ? { model } : {}) };
}

/** What a bot's turn in `threadId` cost, from the usage ledger: null when nothing was booked or a row has no price. */
export async function threadCost(dataDir: string, threadId: string, since: number): Promise<Cost> {
  await flushUsageLedger(dataDir);
  const rows = readUsage(dataDir, { from: new Date(since - 60_000), to: new Date(Date.now() + 60_000) }).filter((row) => row.threadId === threadId);
  if (!rows.length || rows.some((row) => typeof row.costUsd !== "number")) return null;
  return rows.reduce((sum, row) => sum + (row.costUsd as number), 0);
}

export function createWorkflowHost(deps: WorkflowHostDeps) {
  const line = (key: ServerLineKey, params?: Record<string, string | number>) => serverLine(deps.language(), key, params);
  const store = createWorkflowStore(deps.dataDir);
  try {
    store.failInterruptedRuns(line("server.workflow.restart"));
  } catch (error) {
    console.error("workflows: could not close the runs a restart cut", error);
  }

  const defaultBot = (): WorkflowHostBot | null => {
    const bots = deps.bots();
    return viewersDefaultBot(bots) ?? bots.find((b) => !b.hidden) ?? null;
  };

  const aborted = (signal: AbortSignal, onAbort: () => void) => new Promise<never>((_, reject) => {
    const stop = () => { onAbort(); reject(signal.reason); };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });

  const steps: StepDeps = {
    async generateText({ prompt, model, signal }) {
      const bot = defaultBot();
      const ref = splitModelRef(model);
      const writer = bot ? deps.sideText(bot.id, ref.instanceId) : null;
      if (!writer) throw new StepError(line("server.workflow.noAi"));
      let total = 0, reported = false, unknown = false;
      const text = await writer.generateText(prompt, {
        signal, timeoutMs: AI_TIMEOUT_MS, ...(ref.model ? { model: ref.model } : {}),
        onUsage: (usage) => {
          reported = true;
          if (typeof usage.costUsd === "number") total += usage.costUsd;
          else unknown = true;
        },
      });
      return { text, costUsd: reported && !unknown ? total : null };
    },

    async runBot({ botId, prompt, workflowName, signal }) {
      const bot = deps.bot(botId);
      const task = bot ? deps.createTask(botId, workflowName.slice(0, 60)) : null;
      if (!bot || !task) throw new StepError(line("server.workflow.botMissing"));
      const since = Date.now();
      const settled = new Promise<{ ok: boolean; text: string }>((resolve, reject) => {
        deps.startTurn(botId, prompt, {
          threadId: task.threadId,
          onSettled: resolve,
          onDispatchError: (message) => reject(new StepError(message)),
        }).catch(reject);
      });
      const outcome = await Promise.race([settled, aborted(signal, () => {
        void Promise.resolve(deps.interruptTurn(botId, task.threadId)).catch((error: unknown) => console.error("workflows: could not stop a bot's turn", error));
      })]);
      const costUsd = await threadCost(deps.dataDir, task.threadId, since).catch(() => null);
      if (!outcome.ok) throw new StepError(outcome.text.trim() || line("server.workflow.botFailed"), costUsd);
      return { text: outcome.text, costUsd };
    },

    async askApproval({ message, data, workflowName, signal, timeoutMs }) {
      const bot = defaultBot();
      if (!bot) throw new StepError(line("server.workflow.botMissing"));
      const held = deps.outboundRequests.open({ botId: bot.id, threadId: bot.threadId, tool: WORKFLOW_APPROVAL_TOOL, timeoutMs });
      const excerpt = data.trim() ? clean(data, 400) : "";
      try {
        deps.appendMessage(bot.threadId, {
          role: "bot",
          kind: "options",
          card: {
            title: message.trim() || workflowName,
            subtitle: [`Workflow « ${workflowName} »`, excerpt].filter(Boolean).join("\n"),
            options: ["Allow", "Deny"],
            requestId: held.requestId,
            tool: WORKFLOW_APPROVAL_TOOL,
            outboundRequest: { tool: WORKFLOW_APPROVAL_TOOL, app: null, calls: [{ app: null, label: summarize(message || workflowName, 200) }] },
          },
        });
        deps.notify(buildNotification("approval", bot, bot.threadId, `${workflowName} · ${message}`, bot.avatarUrl ? { avatarUrl: bot.avatarUrl } : undefined));
      } catch (error) {
        deps.outboundRequests.forget(held.requestId);
        throw error;
      }
      try {
        const answer = await Promise.race([held.answer, aborted(signal, () => deps.dismissCard(bot.threadId, held.requestId))]);
        if (answer === "timeout") deps.dismissCard(bot.threadId, held.requestId);
        return answer === "allow" ? "yes" : answer === "deny" ? "no" : "timeout";
      } finally {
        deps.outboundRequests.forget(held.requestId);
      }
    },

    async notify({ title, body }) {
      const bot = defaultBot();
      if (!bot || bot.notifications === false) return;
      deps.notify({ kind: "notice", botId: bot.id, botName: bot.name, threadId: bot.threadId, title: summarize(title, 120), body: summarize(body, 240) });
    },

    async postToBotChat({ botId, text }) {
      const bot = deps.bot(botId);
      if (!bot) throw new StepError(line("server.workflow.botMissing"));
      deps.appendMessage(bot.threadId, { role: "bot", kind: "text", text });
    },
  };

  const runner = createWorkflowRunner({
    store,
    steps,
    botExists: deps.botExists,
    budgetAllows: deps.budgetAllows,
    language: deps.language,
    onRunChanged: (run: WorkflowRun) => deps.broadcast({ kind: "workflow-run", run }, { adminOnly: true }),
    onRunFailed: (run, step, workflow) => {
      const bot = defaultBot();
      if (!bot || bot.notifications === false) return;
      const kind = workflow.nodes.find((n) => n.id === step?.nodeId)?.kind;
      const french = deps.language()?.toLowerCase().startsWith("fr") ?? false;
      const stepName = kind ? KIND_NAME[kind][french ? "fr" : "en"] : "—";
      deps.notify({
        kind: "routine-failed", botId: bot.id, botName: bot.name, threadId: bot.threadId,
        title: line("server.workflow.failed", { name: workflow.name, step: stepName }),
        body: summarize(run.reason ?? "", 240),
        ...(bot.avatarUrl ? { avatarUrl: bot.avatarUrl } : {}),
      });
    },
  });

  const routineLink = createWorkflowRoutineLink({ routines: () => deps.routines?.() ?? null, store, runner });

  const routes = createWorkflowRoutes({
    store,
    runner,
    botExists: deps.botExists,
    onChanged: (id, rev) => deps.broadcast({ kind: "workflow", id, rev }, { adminOnly: true }),
    routines: routineLink,
  });
  /** RoutineManagerOptions.onRunFailed for a workflow routine run that never got to start its workflow (missed, the
   * workflow gone or not ready): the workflow's own failure notice covers a run that started. */
  const routineRunFailed = (run: Pick<RoutineRun, "id" | "target" | "routineName" | "error">) => {
    if (run.target !== "workflow" || routineLink.startedRun(run)) return;
    const bot = defaultBot();
    if (!bot || bot.notifications === false) return;
    deps.notify({
      kind: "routine-failed", botId: bot.id, botName: bot.name, threadId: bot.threadId,
      title: line("server.workflow.notStarted", { name: run.routineName }),
      body: summarize(run.error ?? "", 240),
      ...(bot.avatarUrl ? { avatarUrl: bot.avatarUrl } : {}),
    });
  };

  const cartographeRoutes = deps.cartographe ? createWorkflowCartographeRoutes({
    ...deps.cartographe,
    store,
    botExists: deps.botExists,
    projectName: (projectId) => findProject(readProjectMapState(deps.dataDir), projectId)?.name ?? null,
    language: deps.language,
    outboundRequests: deps.outboundRequests,
    notify: deps.notify,
    onSaved: (workflow) => {
      deps.broadcast({ kind: "workflow", id: workflow.id, rev: workflow.rev }, { adminOnly: true });
      const synced = routineLink.sync(workflow);
      if (synced.routineError) console.warn(`workflows: the schedule of ${workflow.id} could not be kept: ${synced.routineError}`);
    },
  }) : null;

  return { store, runner, routes, steps, routineLink, routineRunFailed, cartographeRoutes };
}
