// The agents tools' internal calls that need only the capability's bot, its body and its folders: research, the helper
// models' decide and extract, MausBot's notifications and the Cartographe's maps. Runs inside index.ts's /api/internal/
// block, after the capability bearer is checked; each route answers its own paths and passes the rest on.
import type { createCartographeRoutes, CartographeContext } from "./cartographe.ts";
import { createHelperToolRoutes, type HelperToolContext, type HelperToolDeps } from "./helper-tools.ts";
import { createMausBotNotificationRoutes, type LiveNotificationsDeps } from "./mausbot-notifications.ts";
import { PASS } from "./table.ts";
import { createXResearchInternalRoutes, type XResearchDeps } from "./x-research.ts";

export type InternalToolContext = HelperToolContext & Partial<Pick<CartographeContext, "threadId" | "capability">>;

export function createInternalToolRoutes(deps: { helpers: HelperToolDeps; xResearch: XResearchDeps; notifications: LiveNotificationsDeps; cartographe?: ReturnType<typeof createCartographeRoutes> }) {
  const routes = [createXResearchInternalRoutes(deps.xResearch), createHelperToolRoutes(deps.helpers), createMausBotNotificationRoutes(deps.notifications)];
  const { cartographe } = deps;
  return async (ctx: InternalToolContext): Promise<typeof PASS | void> => {
    for (const route of routes) if (await route(ctx) !== PASS) return;
    if (cartographe && ctx.threadId !== undefined && await cartographe({ ...ctx, threadId: ctx.threadId, capability: ctx.capability }) !== PASS) return;
    return PASS;
  };
}
