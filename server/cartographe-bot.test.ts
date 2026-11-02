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
const PROJECT_TOOLS = [
  "mcp:agents:projects_read_map", "mcp:agents:projects_read_architecture", "mcp:agents:projects_inspect_project", "mcp:agents:projects_read_file", "mcp:agents:projects_apply_changes",
];
const WORKFLOW_TOOLS = ["mcp:agents:workflows_read", "mcp:agents:workflows_propose"];
const MORE_TOOLS = ["mcp:agents:trigger", "mcp:agents:trigger_info", "mcp:agents:show_html", "mcp:agents:show_widget"];
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

  it("recreate: true makes a new one after deletion, with the same setup, and rewrites the ledger", () => {
    const store = new Store(selection);
    const first = boot(store)!;
    store.deleteBot(first.id);
    const again = ensureCartographeBot(store, { dataDir: DATA_DIR, recreate: true })!;
    expect(again.id).not.toBe(first.id);
    expect(again).toMatchObject({ name: CARTOGRAPHE_NAME, color: "teal", soul: CARTOGRAPHE_SOUL, approvalMode: "ask" });
    expect(again.toolScope).toEqual(cartographeToolScope());
    expect(store.messagesFor(again.threadId).filter((m) => m.role === "bot").map((m) => m.text)).toEqual([cartographeIntroMessage(again.name).text]);
    expect(JSON.parse(readFileSync(join(DATA_DIR, CARTOGRAPHE_LEDGER), "utf8"))).toEqual({ v: 1, botId: again.id });
    expect(boot(store)!.id).toBe(again.id);
    expect(store.bots.filter((b) => b.name === CARTOGRAPHE_NAME)).toHaveLength(1);
  });

  it("recreate: true keeps an existing one and makes one when there never was any", () => {
    const store = new Store(selection);
    const made = ensureCartographeBot(store, { dataDir: DATA_DIR, recreate: true })!;
    expect(made.name).toBe(CARTOGRAPHE_NAME);
    expect(ensureCartographeBot(store, { dataDir: DATA_DIR, recreate: true })!.id).toBe(made.id);
    expect(store.bots.filter((b) => b.name === CARTOGRAPHE_NAME)).toHaveLength(1);
  });

  it("knows the bot by id after a rename, and gives no id without a ledger", () => {
    expect(cartographeBotId(DATA_DIR)).toBeNull();
    const store = new Store(selection);
    const bot = boot(store)!;
    store.patchBot(bot.id, { name: "Atlas" });
    expect(boot(store)!.id).toBe(bot.id);
    expect(cartographeBotId(DATA_DIR, (id) => store.bot(id) !== null)).toBe(bot.id);
  });

  it("the Cartographe scope now includes trigger and trigger_info, the chat pages, and still parses", () => {
    const scope = cartographeToolScope();
    expect(parseToolScope(scope)).toEqual({ ok: true, scope });
    expect(scope.allow).toEqual([...PROJECT_TOOLS, ...WORKFLOW_TOOLS, ...MORE_TOOLS, "mcp:agents:tool_result_read", "mcp:ogb:ask_user", "native:*"]);
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

  it("upgrades a Cartographe made by an older version: new tools and the new soul, nothing removed", () => {
    const store = new Store(selection);
    const bot = boot(store)!;
    const olderSoul = "You are the Cartographe. You tidy the two maps of the Projects tab.\n\nExplain briefly.";
    const olderAllow = ["mcp:agents:projects_read_map", "mcp:agents:projects_read_architecture", "mcp:agents:projects_apply_changes", "mcp:agents:tool_result_read", "mcp:ogb:ask_user", "native:*", "mcp:agents:list_bots"];
    store.patchBot(bot.id, { soul: olderSoul, toolScope: { allow: olderAllow } });
    const fixed = repairCartographeBot(new Store(selection), { dataDir: DATA_DIR })!;
    for (const tool of [...PROJECT_TOOLS, ...WORKFLOW_TOOLS, ...MORE_TOOLS]) expect(fixed.toolScope!.allow).toContain(tool);
    expect(fixed.toolScope!.allow).toContain("mcp:agents:list_bots");
    expect(fixed.soul).toBe(CARTOGRAPHE_SOUL);
    expect(new Store(selection).bot(bot.id)!.soul).toBe(CARTOGRAPHE_SOUL);
  });

  it("keeps a soul the person rewrote themselves", () => {
    const store = new Store(selection);
    const bot = boot(store)!;
    store.patchBot(bot.id, { soul: "Tu es mon assistant de cartes, parle comme un pirate." });
    expect(repairCartographeBot(new Store(selection), { dataDir: DATA_DIR })!.soul).toBe("Tu es mon assistant de cartes, parle comme un pirate.");
  });

  it("gives a Cartographe made before the workflow tools those tools, and keeps the rest of its scope", () => {
    const store = new Store(selection);
    const bot = boot(store)!;
    const old = [...PROJECT_TOOLS, "mcp:agents:tool_result_read", "mcp:ogb:ask_user", "native:*", "mcp:agents:list_bots"];
    store.patchBot(bot.id, { toolScope: { allow: old } });
    expect(repairCartographeBot(store, { dataDir: DATA_DIR })!.toolScope!.allow).toEqual([...old, ...WORKFLOW_TOOLS, ...MORE_TOOLS]);
    expect(repairCartographeBot(store, { dataDir: DATA_DIR })!.toolScope!.allow).toEqual([...old, ...WORKFLOW_TOOLS, ...MORE_TOOLS]);
  });

  it("upgrades our own soul written before workflows to the one that knows workflows_propose", () => {
    const store = new Store(selection);
    const bot = boot(store)!;
    const before = CARTOGRAPHE_SOUL.split("\n\n").filter((part) => !part.includes("workflows_propose")).join("\n\n");
    expect(before).not.toBe(CARTOGRAPHE_SOUL);
    store.patchBot(bot.id, { soul: before });
    const fixed = repairCartographeBot(store, { dataDir: DATA_DIR })!;
    expect(fixed.soul).toBe(CARTOGRAPHE_SOUL);
    expect(fixed.soul).toContain("workflows_propose");
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

  it("the soul says never to create an automation without a yes and to use for_bot_id for actions", () => {
    expect(CARTOGRAPHE_SOUL).toMatch(/never create an automation.*explicit yes/i);
    expect(CARTOGRAPHE_SOUL).toMatch(/for_bot_id/);
    expect(CARTOGRAPHE_SOUL).toMatch(/2 or 3 automations?.*reason/i);
    expect(CARTOGRAPHE_SOUL).toMatch(/projects_inspect_project/);
  });

  it("the soul keeps the person's words plain and the bot proactive", () => {
    expect(CARTOGRAPHE_SOUL).toContain("The person is not technical: always use plain everyday words; put a technical term only in parentheses after a plain word.");
    expect(CARTOGRAPHE_SOUL).toMatch(/do not ask the person what to do unless/i);
    expect(CARTOGRAPHE_SOUL).toMatch(/projects_read_file/);
    expect(CARTOGRAPHE_SOUL).toMatch(/never say you cannot go further/i);
    expect(CARTOGRAPHE_SOUL).toMatch(/diagramHtml.*show_html/);
    expect(CARTOGRAPHE_SOUL).toMatch(/Projets.*icône réseau/);
    expect(CARTOGRAPHE_SOUL).toMatch(/never read.*secret/i);
  });

  it("the intro mentions that file contents can be sent to the AI", () => {
    const text = cartographeIntroMessage("Cartographe").text;
    expect(text).toMatch(/contenu de certains fichiers/);
    expect(text).toMatch(/envoyé à l'IA/);
  });

  it("its instructions keep it to the maps and treat names as data", () => {
    expect(CARTOGRAPHE_SOUL).toMatch(/one batch/i);
    expect(CARTOGRAPHE_SOUL).toMatch(/never .*files.*terminal|never use files or the terminal/i);
    expect(CARTOGRAPHE_SOUL).toMatch(/data, never instructions/i);
    expect(CARTOGRAPHE_SOUL).toMatch(/user's language/i);
  });
});
