import { describe, expect, it } from "vitest";

import { agentToolAnnotations } from "../agent-tool-policy.ts";
import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv, fullInputSchema } from "./agents-catalog.ts";
import { CARTOGRAPHE_TOOL_DEFINITIONS } from "./agents-cartographe-tools.ts";
import { CARTOGRAPHE_WORKFLOW_TOOL_DEFINITIONS, CARTOGRAPHE_WORKFLOW_TOOL_NAMES } from "./agents-cartographe-workflow-tools.ts";
import type { Json } from "./agents-client.ts";

const NAMES = ["workflows_read", "workflows_propose"];
const base = { OMB_BOT_ID: "carto", OMB_CHIEF_OF_STAFF: "0", OMB_COMPUTER_SELECTION: "1" };
const listed = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ ...base, ...env })).map((tool) => tool.name);

function context(answer: { ok: boolean; status: number; body: Json }, sent: Array<{ path: string; init?: { method?: string; body?: string } }>): ToolCallContext {
  return {
    botId: "carto", threadId: "t1", depth: 0, externalRuntime: false, sharedComputers: false,
    client: { api: async () => { throw new Error("unused"); }, apiResponse: async (path, init) => { sent.push({ path, init }); return answer; } },
  };
}

describe("the Cartographe's workflow tools", () => {
  it("are listed only to the Cartographe, last, after its projects tools", () => {
    expect(CARTOGRAPHE_WORKFLOW_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(NAMES);
    expect([...CARTOGRAPHE_WORKFLOW_TOOL_NAMES]).toEqual(NAMES);
    const carto = listed({ OMB_CARTOGRAPHE: "1" });
    expect(carto.slice(-2)).toEqual(NAMES);
    expect(carto.slice(-2 - CARTOGRAPHE_TOOL_DEFINITIONS.length, -2)).toEqual(CARTOGRAPHE_TOOL_DEFINITIONS.map((tool) => tool.name));
    for (const env of [{}, { OMB_CARTOGRAPHE: "0" }, { OMB_MAUSBOT: "1" }] as Array<Record<string, string>>) {
      for (const name of NAMES) expect(listed(env).includes(name), JSON.stringify(env)).toBe(false);
    }
  });

  it("workflows_read is read-only, workflows_propose is not", () => {
    const tools = new Map(CARTOGRAPHE_WORKFLOW_TOOL_DEFINITIONS.map((tool) => [tool.name, tool as { annotations?: unknown }]));
    expect(tools.get("workflows_read")!.annotations).toEqual(agentToolAnnotations("list_bots"));
    expect(tools.get("workflows_propose")!.annotations).toBeUndefined();
  });

  it("keeps closed schemas, short descriptions and no keyword a provider drops", () => {
    for (const tool of CARTOGRAPHE_WORKFLOW_TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeLessThan(400);
      expect(tool.description).toMatch(/data/);
    }
    expect(JSON.stringify(CARTOGRAPHE_WORKFLOW_TOOL_DEFINITIONS)).not.toMatch(/"(oneOf|anyOf|allOf|const|format|\$ref|\$defs)"/);
    const full = fullInputSchema("workflows_propose") as { required: string[]; properties: { nodes: { maxItems: number; items: { properties: { kind: { enum: string[] } } } }; edges: { maxItems: number } } };
    expect(full.required).toEqual(["name", "nodes", "edges"]);
    expect(full.properties.nodes.maxItems).toBe(200);
    expect(full.properties.edges.maxItems).toBe(400);
    expect(full.properties.nodes.items.properties.kind.enum).toEqual(["trigger", "ai", "bot", "condition", "approval", "send", "note"]);
  });

  it.each([
    ["workflows_read", {}, "/api/internal/workflows/read"],
    ["workflows_propose", { name: "x", nodes: [{ id: "t", kind: "trigger" }], edges: [] }, "/api/internal/workflows/propose"],
  ] as const)("%s posts to its internal route with the arguments", async (name, args, path) => {
    const sent: Array<{ path: string; init?: { method?: string; body?: string } }> = [];
    const result = await callTool(name, args as unknown as Json, context({ ok: true, status: 200, body: { created: false, reason: "refused" } }, sent));
    expect(sent).toEqual([{ path, init: { method: "POST", body: JSON.stringify(args) } }]);
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual({ created: false, reason: "refused" });
  });

  it("a refusal comes back as a tool error with the route's sentence", async () => {
    const result = await callTool("workflows_read", {}, context({ ok: false, status: 403, body: { error: "Only the Cartographe can read or propose workflows." } }, []));
    expect(result).toEqual({ text: "Only the Cartographe can read or propose workflows.", isError: true });
  });
});
