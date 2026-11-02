import { describe, expect, it } from "vitest";

import { agentToolAnnotations } from "../agent-tool-policy.ts";
import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv, fullInputSchema } from "./agents-catalog.ts";
import { CARTOGRAPHE_TOOL_DEFINITIONS, CARTOGRAPHE_TOOL_NAMES } from "./agents-cartographe-tools.ts";
import type { Json } from "./agents-client.ts";
import { AGENTS_MCP_ENV } from "./agents-mcp-env.ts";

const NAMES = ["projects_read_map", "projects_read_architecture", "projects_apply_changes"];
const base = { OMB_BOT_ID: "carto", OMB_CHIEF_OF_STAFF: "0", OMB_COMPUTER_SELECTION: "1" };
const listed = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ ...base, ...env }));

function context(answer: { ok: boolean; status: number; body: Json }, sent: Array<{ path: string; init?: { method?: string; body?: string } }>): ToolCallContext {
  return {
    botId: "carto", threadId: "t1", depth: 0, externalRuntime: false, sharedComputers: false,
    client: {
      api: async () => { throw new Error("unused"); },
      apiResponse: async (path, init) => { sent.push({ path, init }); return answer; },
    },
  };
}

describe("the Cartographe's projects tools", () => {
  it("lists the three tools only when OMB_CARTOGRAPHE=1, last and in this order", () => {
    expect(CARTOGRAPHE_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(NAMES);
    expect([...CARTOGRAPHE_TOOL_NAMES]).toEqual(NAMES);
    // The workflow tools (agents-cartographe-workflow-tools.ts) come after these.
    expect(listed({ OMB_CARTOGRAPHE: "1" }).slice(-5, -2).map((tool) => tool.name)).toEqual(NAMES);
    for (const env of [{}, { OMB_CARTOGRAPHE: "0" }, { OMB_CARTOGRAPHE: "true" }, { OMB_MAUSBOT: "1" }] as Array<Record<string, string>>) {
      const names = listed(env).map((tool) => tool.name);
      for (const name of NAMES) expect(names.includes(name), JSON.stringify(env)).toBe(false);
    }
  });

  it("leaves every other tool of the same profile unchanged", () => {
    expect(JSON.stringify(listed({ OMB_CARTOGRAPHE: "1" }).slice(0, -5))).toBe(JSON.stringify(listed({})));
  });

  it("the harness passes OMB_CARTOGRAPHE to the agents MCP server", () => {
    expect((AGENTS_MCP_ENV as readonly string[]).includes("OMB_CARTOGRAPHE")).toBe(true);
  });

  it("the two read tools are annotated read-only, apply is not", () => {
    const tools = new Map(CARTOGRAPHE_TOOL_DEFINITIONS.map((tool) => [tool.name, tool as { annotations?: unknown }]));
    expect(tools.get("projects_read_map")!.annotations).toEqual(agentToolAnnotations("list_bots"));
    expect(tools.get("projects_read_architecture")!.annotations).toEqual(agentToolAnnotations("list_bots"));
    expect(tools.get("projects_apply_changes")!.annotations).toBeUndefined();
    expect(agentToolAnnotations("projects_apply_changes")).toBeUndefined();
  });

  it("the apply schema caps the batch at 100 changes and lists each operation", () => {
    const full = fullInputSchema("projects_apply_changes") as { required: string[]; properties: { changes: { type: string; minItems: number; maxItems: number; items: { properties: Record<string, { enum?: string[] }>; required: string[] } } } };
    expect(full.required).toEqual(["changes"]);
    expect(full.properties.changes).toMatchObject({ type: "array", minItems: 1, maxItems: 100 });
    expect(full.properties.changes.items.properties.op.enum).toEqual(["create_group", "rename_group", "delete_group", "assign", "link", "unlink", "rename_family", "move_module"]);
    expect(full.properties.changes.items.required).toEqual(["op"]);
    expect(fullInputSchema("projects_read_architecture")).toMatchObject({ required: ["projectId"], properties: { projectId: { type: "string" }, includeFiles: { type: "boolean" } } });
  });

  it("keeps closed schemas, short descriptions and no keyword a provider drops", () => {
    for (const tool of CARTOGRAPHE_TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeLessThan(400);
    }
    expect(JSON.stringify(CARTOGRAPHE_TOOL_DEFINITIONS)).not.toMatch(/"(oneOf|anyOf|allOf|const|format|\$ref|\$defs)"/);
    const apply = CARTOGRAPHE_TOOL_DEFINITIONS.find((tool) => tool.name === "projects_apply_changes")!;
    expect(apply.description).toMatch(/one card/i);
    expect(apply.description).toMatch(/data/i);
  });

  it.each([
    ["projects_read_map", {}, "/api/internal/projects/map", {}],
    ["projects_read_architecture", { projectId: "s1:shop", includeFiles: true }, "/api/internal/projects/architecture", { projectId: "s1:shop", includeFiles: true }],
    ["projects_apply_changes", { changes: [{ op: "delete_group", groupId: "g1" }] }, "/api/internal/projects/apply", { changes: [{ op: "delete_group", groupId: "g1" }] }],
  ] as const)("%s posts to its internal route with the arguments", async (name, args, path, body) => {
    const sent: Array<{ path: string; init?: { method?: string; body?: string } }> = [];
    const result = await callTool(name, args as unknown as Json, context({ ok: true, status: 200, body: { applied: true, rev: 4 } }, sent));
    expect(sent).toEqual([{ path, init: { method: "POST", body: JSON.stringify(body) } }]);
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual({ applied: true, rev: 4 });
  });

  it("an assign to \"\" is sent as no group; other changes go as written", async () => {
    const sent: Array<{ path: string; init?: { method?: string; body?: string } }> = [];
    await callTool("projects_apply_changes", { changes: [{ op: "assign", projectId: "s1:shop", groupId: "" }, { op: "rename_group", groupId: "", name: "x" }] }, context({ ok: true, status: 200, body: {} }, sent));
    expect(JSON.parse(sent[0]!.init!.body!)).toEqual({ changes: [{ op: "assign", projectId: "s1:shop", groupId: null }, { op: "rename_group", groupId: "", name: "x" }] });
  });

  it("a refusal comes back as a tool error with the route's sentence", async () => {
    const result = await callTool("projects_read_map", {}, context({ ok: false, status: 403, body: { error: "Only the Cartographe can read or change the project maps." } }, []));
    expect(result).toEqual({ text: "Only the Cartographe can read or change the project maps.", isError: true });
  });

  it("an applied:false answer is a normal result the bot can read, not an error", async () => {
    const result = await callTool("projects_apply_changes", { changes: [{ op: "delete_group", groupId: "g1" }] }, context({ ok: true, status: 200, body: { applied: false, reason: "refused" } }, []));
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual({ applied: false, reason: "refused" });
  });
});
