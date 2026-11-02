import type { Architecture } from "../shared/projects-architecture.ts";
import type { Notification } from "../shared/notification.ts";
import { cartographeBotId } from "./cartographe-bot.ts";
import { AGENTS_TOOL_TIMEOUT_SECONDS } from "./drivers/agents-tool-limit.ts";
import { buildNotification } from "./notify.ts";
import type { OutboundRequestService } from "./outbound-requests.ts";
import { createProjectsHold, projectsCardMessage, PROJECTS_HOLD_MAX_MS, type ProjectsHold } from "./projects-hold.ts";
import { createCartographeRoutes } from "./routes/cartographe.ts";
import type { Store } from "./store.ts";

export interface CartographeHostDeps {
  dataDir: string;
  /** Team Cloud, Cloud Home or a hosted company workspace. */
  cloud: boolean;
  store: Pick<Store, "bot" | "groupByThread" | "appendMessage" | "messagesFor" | "patchMessage">;
  outboundRequests: OutboundRequestService;
  notify(notification: Notification | null): void;
  broadcast(payload: Record<string, unknown>, options?: { adminOnly?: boolean }): void;
  active(capability: unknown): boolean;
  architectureOf(projectId: string): Promise<Architecture | null>;
  mcpCallTimeoutMs(botId: string): number | null;
}

/** Engines that run the agents tools through openai-chat.ts, which ends a call after the turn's mcpCallTimeoutMs. */
const CHAT_ENGINES = new Set(["openai-compat", "grok", "mistral", "minimax", "cerebras", "groq", "greenference", "meta"]);

/** How long `engine` waits on one agents tool call, or null when the engine does not say. */
export function agentsCallTimeoutMs(engine: string | undefined, chatTimeoutMs: number): number | null {
  if (engine === "codex" || engine === "piAgent") return AGENTS_TOOL_TIMEOUT_SECONDS * 1000;
  return engine !== undefined && CHAT_ENGINES.has(engine) ? chatTimeoutMs : null;
}

/** The server pieces of the Cartographe, built from what index.ts already has. */
export function createCartographeHost(deps: CartographeHostDeps) {
  const { store } = deps;
  const cartographe = (): string | null => (deps.cloud ? null : cartographeBotId(deps.dataDir, (id) => Boolean(store.bot(id))));
  // hold.ask posts its card and notification before its first await, so this names the turn asking for both.
  let asking: { botId: string; threadId: string } | null = null;

  function dismissCard(threadId: string, requestId: string): void {
    const stale = store.messagesFor(threadId).find((message) => message.card?.requestId === requestId);
    if (stale?.card && !stale.card.answered) store.patchMessage(threadId, stale.id, { card: { ...stale.card, answered: "unavailable", dismissed: true } });
  }

  function withdrawCard(threadId: string, requestId: string): void {
    const allowed = store.messagesFor(threadId).find((message) => message.card?.requestId === requestId);
    if (allowed?.card) store.patchMessage(threadId, allowed.id, { card: { ...allowed.card, answered: "unavailable", dismissed: true } });
  }

  const inner = createProjectsHold({
    outboundRequests: deps.outboundRequests,
    maxMs: PROJECTS_HOLD_MAX_MS,
    appendCard: (threadId, card) => {
      const bot = asking ? store.bot(asking.botId) : undefined;
      const room = store.groupByThread(threadId);
      store.appendMessage(threadId, projectsCardMessage(card, room && bot ? { botId: bot.id, name: bot.name, color: bot.color } : undefined));
    },
    dismissCard,
    withdrawCard,
    notify: (botId, text) => {
      const bot = store.bot(botId);
      if (!bot || !asking) return;
      const room = store.groupByThread(asking.threadId);
      deps.notify(buildNotification("approval", bot, asking.threadId, text, { avatarUrl: bot.avatarUrl, ...(room ? { group: { id: room.id, name: room.name } } : {}) }));
    },
  });
  const hold: ProjectsHold = {
    withdraw: (input) => inner.withdraw(input),
    ask: (input) => {
      asking = { botId: input.botId, threadId: input.threadId };
      try {
        return inner.ask(input);
      } finally {
        asking = null;
      }
    },
  };

  const onChanged = (rev: number) => deps.broadcast({ kind: "projects.changed", rev }, { adminOnly: true });
  const isCartographe = (botId: string) => cartographe() === botId;

  const routes = createCartographeRoutes({
    dataDir: deps.dataDir,
    isCartographe,
    cloud: deps.cloud,
    hold,
    active: deps.active,
    architectureOf: deps.architectureOf,
    onChanged,
    mcpCallTimeoutMs: deps.mcpCallTimeoutMs,
  });

  return { hold, routes, dismissCard, onChanged, maxMs: PROJECTS_HOLD_MAX_MS, cartographeBotId: cartographe, isCartographe, mcpCallTimeoutMs: deps.mcpCallTimeoutMs };
}
