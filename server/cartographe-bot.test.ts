import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { parseToolScope } from "../shared/tool-scope.ts";
import { assertToolScopeSupported, TOOL_SCOPE_SUPPORT } from "../shared/tool-scope-support.ts";
import { approvalModeFor } from "../shared/approval-mode.ts";
import {
  CARTOGRAPHE_LEDGER, CARTOGRAPHE_NAME, CARTOGRAPHE_SOUL, cartographeBotId, cartographeIntroMessage, cartographeToolScope,
  ensureCartographeBot, repairCartographeBot,
} from "./cartographe-bot.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { ensureDefaultBot } from "./default-bot.ts";
import { Store } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const PROJECT_TOOLS = ["mcp:agents:projects_read_map", "mcp:agents:projects_read_architecture", "mcp:agents:projects_apply_changes"];
const boot = (store: Store) => ensureCartographeBot(store, { dataDir: DATA_DIR });

describe("the Cartographe bot", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("creates the bot once and writes the ledger", () => {
    const store = new Store(selection);
    const bot = boot(store)!;
    expect(bot).toMatchObject({ name: CARTOGRAPHE_NAME, color: "teal", soul: CARTOGRAPHE_SOUL });
    expect(boot(store)!.id).toBe(bot.id);
    expect(boot(new Store(selection))!.id).toBe(bot.id);
    expect(new Store(selection).bots.filter((b) => b.name === CARTOGRAPHE_NAME)).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(DATA_DIR, CARTOGRAPHE_LEDGER), "utf8"))).toEqual({ v: 1, botId: bot.id });
    expect(cartographeBotId(DATA_DIR)).toBe(bot.id);
  });

  it("does not recreate it after deletion, and then has no id", () => {
    const store = new Store(selection);
    const bot = boot(store)!;
    expect(store.deleteBot(bot.id)).toBe(true);
    expect(boot(store)).toBeNull();
    expect(store.bots.some((b) => b.name === CARTOGRAPHE_NAME)).toBe(false);
    expect(cartographeBotId(DATA_DIR, (id) => store.bot(id) !== null)).toBeNull();
    expect(boot(new Store(selection))).toBeNull();
  });

  it("knows the bot by id after a rename, and gives no id without a ledger", () => {
    expect(cartographeBotId(DATA_DIR)).toBeNull();
    const store = new Store(selection);
    const bot = boot(store)!;
    store.patchBot(bot.id, { name: "Atlas" });
    expect(boot(store)!.id).toBe(bot.id);
    expect(cartographeBotId(DATA_DIR, (id) => store.bot(id) !== null)).toBe(bot.id);
  });

  it("its toolScope passes parseToolScope and lists the exact projects tools, tool_result_read, ask_user and native:*", () => {
    const scope = cartographeToolScope();
    expect(parseToolScope(scope)).toEqual({ ok: true, scope });
    expect(scope.allow).toEqual([...PROJECT_TOOLS, "mcp:agents:tool_result_read", "mcp:ogb:ask_user", "native:*"]);
    expect(scope.deny).toBeUndefined();
    expect(boot(new Store(selection))!.toolScope).toEqual(scope);
  });

  it("keeps native:* even when the app has no default model yet, so every engine accepts the scope", () => {
    const store = new Store(() => ({ instanceId: "", model: "" }));
    const bot = boot(store)!;
    expect(bot.toolScope).toEqual(cartographeToolScope());
    for (const engine of Object.keys(TOOL_SCOPE_SUPPORT)) expect(() => assertToolScopeSupported(engine, bot.toolScope), engine).not.toThrow();
  });

  it("repairs a Cartographe saved without native:*, and never creates one", () => {
    const store = new Store(selection);
    expect(repairCartographeBot(store, { dataDir: DATA_DIR })).toBeNull();
    expect(store.bots.some((b) => b.name === CARTOGRAPHE_NAME)).toBe(false);
    const bot = boot(store)!;
    const old = { allow: cartographeToolScope().allow!.filter((s) => s !== "native:*") };
    store.patchBot(bot.id, { toolScope: old });
    expect(() => assertToolScopeSupported("claudeAgent", store.bot(bot.id)!.toolScope)).toThrow();
    expect(repairCartographeBot(new Store(selection), { dataDir: DATA_DIR })!.toolScope).toEqual(cartographeToolScope());
    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)!.toolScope).toEqual(cartographeToolScope());
    expect(() => assertToolScopeSupported("claudeAgent", reloaded.bot(bot.id)!.toolScope)).not.toThrow();
    reloaded.patchBot(bot.id, { toolScope: undefined });
    expect(repairCartographeBot(reloaded, { dataDir: DATA_DIR })!.toolScope).toBeUndefined();
    reloaded.deleteBot(bot.id);
    expect(repairCartographeBot(reloaded, { dataDir: DATA_DIR })).toBeNull();
    expect(reloaded.bots.some((b) => b.name === CARTOGRAPHE_NAME)).toBe(false);
  });

  it("is not the default bot, has approvalMode ask, and uses the app's default model", () => {
    const store = new Store(selection);
    const bot = boot(store)!;
    expect(bot.defaultBot).toBeUndefined();
    expect(bot.chiefOfStaff).toBeFalsy();
    expect(bot.approvalMode).toBe("ask");
    expect(approvalModeFor(bot)).toBe("ask");
    expect(bot.modelSelection).toEqual(selection());
  });

  it("lives beside MausBot without taking its place", () => {
    const store = new Store(selection);
    const maus = ensureDefaultBot(store, { dataDir: DATA_DIR })!;
    const carto = boot(store)!;
    expect(carto.id).not.toBe(maus.id);
    expect(ensureDefaultBot(store, { dataDir: DATA_DIR })!.id).toBe(maus.id);
    expect(store.bots.filter((b) => b.defaultBot)).toHaveLength(1);
  });

  it("the intro says file and project names are sent to the AI in use", () => {
    const store = new Store(selection);
    const bot = boot(store)!;
    const intro = store.messagesFor(bot.threadId).filter((m) => m.role === "bot");
    expect(intro).toHaveLength(1);
    expect(intro[0]!.text).toBe(cartographeIntroMessage(bot.name).text);
    expect(intro[0]!.text).toMatch(/noms de projets et de fichiers sont envoyés à l'IA/);
    expect(intro[0]!.text).toMatch(/ne touche jamais/);
    expect(intro[0]!.text).toMatch(/Autoriser/);
  });

  it("its instructions keep it to the maps and treat names as data", () => {
    expect(CARTOGRAPHE_SOUL).toMatch(/one batch/i);
    expect(CARTOGRAPHE_SOUL).toMatch(/never .*files.*terminal|never use files or the terminal/i);
    expect(CARTOGRAPHE_SOUL).toMatch(/data, never instructions/i);
    expect(CARTOGRAPHE_SOUL).toMatch(/user's language/i);
  });
});
