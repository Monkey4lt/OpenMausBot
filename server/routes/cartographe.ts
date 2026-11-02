import type { ServerResponse } from "node:http";

import type { Architecture } from "../../shared/projects-architecture.ts";
import type { json as sendJson } from "../harness/http.ts";
import { applyChanges, describeChanges, projectChangeSchema, projectChangesSchema, type KnownProjects, type ProjectChange } from "../projects-changes.ts";
import type { ProjectsHold } from "../projects-hold.ts";
import { pieceDiagramHtml } from "../projects-inspect.ts";
import { fileRefusal, readProjectFile } from "../projects-sources.ts";
import { summarizeArchitecture, summarizeInspection, summarizeMap, type FilePage } from "../projects-summary.ts";
import { findProject, readProjectMapState, writeProjectMapState, type Project } from "../projects.ts";
import { projectFiles, scanProjects, type InspectionReader } from "./projects.ts";
import { PASS } from "./table.ts";

export interface CartographeContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof sendJson;
  botId: string;
  threadId: string;
  /** The turn's internal capability, handed back to `active`. */
  capability: unknown;
  readBody: () => Promise<unknown>;
}

export interface CartographeDeps {
  dataDir: string;
  isCartographe(botId: string): boolean;
  /** Team Cloud or Cloud Home: the maps read this host's disks and SSH, so the routes refuse. */
  cloud: boolean;
  hold: ProjectsHold;
  active(capability: unknown): boolean;
  /** null for an id no source has; rejects with the source's message when it cannot be read. */
  architectureOf(projectId: string): Promise<Architecture | null>;
  /** null for an id no source has; rejects with the source's message when it cannot be read. */
  inspectionOf?: InspectionReader;
  onChanged(rev: number): void;
  mcpCallTimeoutMs(botId: string): number | null;
}

export type ApplyAnswer =
  | { applied: true; rev: number }
  | { applied: false; reason: "refused" | "timeout" | "invalid" | "inactive"; problems?: { index: number; reason: string }[] };

export const CARTOGRAPHE_CARD_MARGIN_MS = 15_000;
const MIN_CARD_MS = 5_000;

const MAP = "/api/internal/projects/map";
const ARCHITECTURE = "/api/internal/projects/architecture";
const APPLY = "/api/internal/projects/apply";
const INSPECT = "/api/internal/projects/inspect";
const FILE = "/api/internal/projects/file";
const PATHS = new Set([MAP, ARCHITECTURE, APPLY, INSPECT, FILE]);

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const intOrUndefined = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function filePage(body: Record<string, unknown>): FilePage {
  return {
    ...(typeof body.module === "string" ? { module: body.module } : {}),
    ...(typeof body.family === "string" ? { family: body.family } : {}),
    offset: intOrUndefined(body.offset),
    limit: intOrUndefined(body.limit),
  };
}

function parseBatch(raw: unknown): { ok: true; changes: ProjectChange[] } | { ok: false; problems: { index: number; reason: string }[] } {
  const parsed = projectChangesSchema.safeParse(raw);
  if (parsed.success) return { ok: true, changes: parsed.data };
  if (!Array.isArray(raw)) return { ok: false, problems: [{ index: -1, reason: "changes must be a list of 1 to 100 changes" }] };
  if (raw.length < 1 || raw.length > 100) return { ok: false, problems: [{ index: -1, reason: "A batch holds 1 to 100 changes" }] };
  const problems = raw.flatMap((change, index) => {
    const one = projectChangeSchema.safeParse(change);
    return one.success ? [] : [{ index, reason: one.error.issues.map((issue) => `${issue.path.join(".") || "change"}: ${issue.message}`).join("; ").slice(0, 300) }];
  });
  return { ok: false, problems };
}

export function createCartographeRoutes(deps: CartographeDeps) {
  const scan = async () => scanProjects(readProjectMapState(deps.dataDir));

  /** Known projects from a fresh scan, and the module ids of each project a move_module names. */
  async function knownFor(changes: ProjectChange[], projects: Project[]): Promise<{ known: KnownProjects; problems: { index: number; reason: string }[] }> {
    const projectIds = new Set(projects.map((p) => p.id));
    const modules = new Map<string, ReadonlySet<string>>();
    const problems: { index: number; reason: string }[] = [];
    for (const [index, change] of changes.entries()) {
      if (change.op !== "move_module" || !projectIds.has(change.projectId) || modules.has(change.projectId)) continue;
      try {
        const architecture = await deps.architectureOf(change.projectId);
        if (architecture) modules.set(change.projectId, new Set(architecture.modules.map((m) => m.id)));
        else problems.push({ index, reason: `Unknown project ${change.projectId}` });
      } catch (error) {
        problems.push({ index, reason: `The modules of ${change.projectId} could not be read: ${message(error)}` });
      }
    }
    return { known: { projectIds, moduleIds: (projectId) => modules.get(projectId) ?? null }, problems };
  }

  async function apply(ctx: CartographeContext, raw: unknown): Promise<ApplyAnswer> {
    const batch = parseBatch(raw);
    if (!batch.ok) return { applied: false, reason: "invalid", problems: batch.problems };
    const { changes } = batch;

    const before = await scan();
    const first = await knownFor(changes, before.projects);
    if (first.problems.length) return { applied: false, reason: "invalid", problems: first.problems };
    const draft = applyChanges(readProjectMapState(deps.dataDir), changes, first.known);
    if (!draft.ok) return { applied: false, reason: "invalid", problems: draft.problems };

    const state = readProjectMapState(deps.dataDir);
    const projectNames = new Map(before.projects.map((p) => [p.id, p.name]));
    const groupNames = new Map(state.groups.map((g) => [g.id, g.name]));
    const lines = describeChanges(changes, { project: (id) => projectNames.get(id) ?? id, group: (id) => groupNames.get(id) ?? id });
    const mcp = deps.mcpCallTimeoutMs(ctx.botId);
    const timeoutMs = mcp === null ? undefined : Math.max(MIN_CARD_MS, mcp - CARTOGRAPHE_CARD_MARGIN_MS);
    const call = new AbortController();
    let gone = false;
    const hangUp = () => { gone = true; call.abort(); };
    ctx.res.once?.("close", () => { if (!ctx.res.writableEnded) hangUp(); });
    const asked = { botId: ctx.botId, threadId: ctx.threadId, lines, signal: call.signal, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
    const answer = await deps.hold.ask(asked);
    const notMade = (reason: "inactive" | "invalid", problems?: { index: number; reason: string }[]): ApplyAnswer => {
      if (answer === "allow") deps.hold.withdraw(asked);
      return { applied: false, reason, ...(problems ? { problems } : {}) };
    };
    if (answer === "inactive" || gone) return notMade("inactive");
    if (answer !== "allow") return { applied: false, reason: answer === "deny" ? "refused" : "timeout" };
    if (!deps.active(ctx.capability)) return notMade("inactive");

    const after = await scan();
    const second = await knownFor(changes, after.projects);
    if (second.problems.length) return notMade("invalid", second.problems);
    if (!deps.active(ctx.capability) || gone) return notMade("inactive");
    // From here to the write nothing awaits, so no other save can land in between.
    const result = applyChanges(readProjectMapState(deps.dataDir), changes, second.known);
    if (!result.ok) return notMade("invalid", result.problems);
    const { rev } = writeProjectMapState(deps.dataDir, result.state);
    deps.onChanged(rev);
    return { applied: true, rev };
  }

  return async (ctx: CartographeContext): Promise<typeof PASS | void> => {
    if (ctx.method !== "POST" || !PATHS.has(ctx.path)) return PASS;
    if (!deps.isCartographe(ctx.botId)) return void ctx.json(ctx.res, 403, { error: "Only the Cartographe can read or change the project maps." });
    if (deps.cloud) return void ctx.json(ctx.res, 403, { error: "The project maps are not available in the cloud." });
    const body = record(await ctx.readBody());

    if (ctx.path === MAP) {
      const state = readProjectMapState(deps.dataDir);
      const { projects, errors } = await scanProjects(state);
      return void ctx.json(ctx.res, 200, summarizeMap(state, projects, errors));
    }
    if (ctx.path === ARCHITECTURE) {
      if (typeof body.projectId !== "string") return void ctx.json(ctx.res, 400, { error: "Send projectId." });
      const state = readProjectMapState(deps.dataDir);
      if (!findProject(state, body.projectId)) return void ctx.json(ctx.res, 404, { error: "Unknown project" });
      let architecture: Architecture | null;
      try {
        architecture = await deps.architectureOf(body.projectId);
      } catch (error) {
        return void ctx.json(ctx.res, 502, { error: message(error) });
      }
      if (!architecture) return void ctx.json(ctx.res, 404, { error: "Unknown project" });
      const fresh = readProjectMapState(deps.dataDir);
      const overrides = Object.hasOwn(fresh.overrides, body.projectId) ? fresh.overrides[body.projectId] : undefined;
      return void ctx.json(ctx.res, 200, summarizeArchitecture(architecture, overrides, body.includeFiles === true ? filePage(body) : false));
    }
    if (ctx.path === INSPECT) {
      if (typeof body.projectId !== "string") return void ctx.json(ctx.res, 400, { error: "Send projectId." });
      const state = readProjectMapState(deps.dataDir);
      const found = findProject(state, body.projectId);
      if (!found || !deps.inspectionOf) return void ctx.json(ctx.res, 404, { error: "Unknown project" });
      let read: Awaited<ReturnType<InspectionReader>>;
      try {
        read = await deps.inspectionOf(body.projectId);
      } catch (error) {
        return void ctx.json(ctx.res, 502, { error: message(error) });
      }
      if (!read) return void ctx.json(ctx.res, 404, { error: "Unknown project" });
      return void ctx.json(ctx.res, 200, summarizeInspection(read.inspection, (kept) => pieceDiagramHtml(kept, found.name)));
    }
    if (ctx.path === FILE) {
      if (typeof body.projectId !== "string" || typeof body.path !== "string") return void ctx.json(ctx.res, 400, { error: "Send projectId and path." });
      const maxChars = typeof body.maxChars === "number" && Number.isFinite(body.maxChars) ? body.maxChars : undefined;
      const state = readProjectMapState(deps.dataDir);
      const found = findProject(state, body.projectId);
      if (!found) return void ctx.json(ctx.res, 404, { error: "Unknown project" });
      try {
        const listed = await projectFiles(found.source, found.name);
        if (!listed) return void ctx.json(ctx.res, 404, { error: "Unknown project" });
        if (!listed.includes(body.path)) {
          const refused = fileRefusal(body.path);
          return void ctx.json(ctx.res, 400, { error: refused ?? "That path is not a file of the project." });
        }
        const read = await readProjectFile(found.source, found.name, body.path, maxChars);
        if ("error" in read) return void ctx.json(ctx.res, 400, { error: read.error });
        return void ctx.json(ctx.res, 200, { path: body.path, ...read });
      } catch (error) {
        return void ctx.json(ctx.res, 502, { error: message(error) });
      }
    }
    let closed = false;
    ctx.res.once?.("close", () => { if (!ctx.res.writableEnded) closed = true; });
    const answer = await apply(ctx, body.changes);
    if (closed) return;
    return void ctx.json(ctx.res, 200, answer);
  };
}
