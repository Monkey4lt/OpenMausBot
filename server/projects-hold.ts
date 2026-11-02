import type { OutboundRequestService } from "./outbound-requests.ts";

/** The longest a map-change card waits on the person. */
export const PROJECTS_HOLD_MAX_MS = 9 * 60_000;
export const PROJECTS_APPLY_TOOL = "projects_apply_changes";

export type ProjectsCard = { title: string; lines: string[]; requestId: string };
export type ProjectsHoldAnswer = "allow" | "deny" | "timeout" | "inactive";

export interface ProjectsHoldDeps {
  outboundRequests: OutboundRequestService;
  appendCard(threadId: string, card: ProjectsCard): void;
  dismissCard(threadId: string, requestId: string): void;
  /** An allowed card whose change will not be made: shown as unavailable. */
  withdrawCard(threadId: string, requestId: string): void;
  notify(botId: string, text: string): void;
  maxMs: number;
}

export interface ProjectsHold {
  /** "inactive" when `signal` aborts first: the request is forgotten and its card dismissed. */
  ask(input: { botId: string; threadId: string; lines: string[]; timeoutMs?: number; signal?: AbortSignal }): Promise<ProjectsHoldAnswer>;
  /** After ask answered "allow" for this same input, its change was not made after all. */
  withdraw(input: { threadId: string }): void;
}

export function projectsCardTitle(count: number): string {
  return count === 1 ? "Appliquer ce changement à la carte ?" : `Appliquer ces ${count} changements à la carte ?`;
}

/**
 * The chat message for a map-change card. It carries `outboundRequest` so the existing card-answer path resolves it
 * through the same OutboundRequestService; `from` is set when the card is posted in a room.
 */
export function projectsCardMessage(card: ProjectsCard, from?: { botId: string; name: string; color: string }) {
  return {
    role: "bot" as const,
    kind: "options" as const,
    ...(from ? { from } : {}),
    card: {
      title: card.title,
      subtitle: card.lines.join("\n"),
      options: ["Allow", "Deny"],
      requestId: card.requestId,
      tool: PROJECTS_APPLY_TOOL,
      outboundRequest: { tool: PROJECTS_APPLY_TOOL, app: null, calls: card.lines.map((label) => ({ app: null, label })) },
    },
  };
}

/** Shows the card at every access level: the bot's approval mode and outbound policy are never read here. */
export function createProjectsHold(deps: ProjectsHoldDeps): ProjectsHold {
  const allowed = new WeakMap<object, string>();
  return {
    withdraw(input) {
      const requestId = allowed.get(input);
      if (requestId === undefined) return;
      allowed.delete(input);
      deps.withdrawCard(input.threadId, requestId);
    },
    async ask(input) {
      const { botId, threadId, lines, timeoutMs, signal } = input;
      if (signal?.aborted) return "inactive";
      const wait = Math.max(0, Math.min(timeoutMs ?? deps.maxMs, deps.maxMs));
      const held = deps.outboundRequests.open({ botId, threadId, tool: PROJECTS_APPLY_TOOL, timeoutMs: wait });
      const title = projectsCardTitle(lines.length);
      try {
        deps.appendCard(threadId, { title, lines, requestId: held.requestId });
        deps.notify(botId, title);
      } catch (error) {
        deps.outboundRequests.forget(held.requestId);
        throw error;
      }
      let onAbort = () => {};
      const aborted = new Promise<"inactive">((resolve) => {
        onAbort = () => resolve("inactive");
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      const answer = await Promise.race([held.answer, aborted]);
      signal?.removeEventListener("abort", onAbort);
      deps.outboundRequests.forget(held.requestId);
      if (answer === "timeout" || answer === "inactive") deps.dismissCard(threadId, held.requestId);
      if (answer === "allow") allowed.set(input, held.requestId);
      return answer;
    },
  };
}
