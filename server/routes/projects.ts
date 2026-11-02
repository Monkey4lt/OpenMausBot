import { readProjectMapState, scanSource, projectMapStateSchema, writeProjectMapState, type Project } from "../projects.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ProjectRouteDeps {
  dataDir: string;
}

/**
 * GET /api/projects        → the saved layout plus a fresh scan of every source
 * PUT /api/projects/state  → save the layout (sources, groups, links, positions)
 */
export function createProjectRoutes(deps: ProjectRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path === "/api/projects" && method === "GET") {
      const state = readProjectMapState(deps.dataDir);
      const projects: Project[] = [];
      const errors: { sourceId: string; message: string }[] = [];
      await Promise.all(state.sources.map(async (source) => {
        try {
          projects.push(...await scanSource(source));
        } catch (error) {
          errors.push({ sourceId: source.id, message: error instanceof Error ? error.message : String(error) });
        }
      }));
      projects.sort((a, b) => a.id.localeCompare(b.id));
      return json(res, 200, { state, projects, errors });
    }
    if (path === "/api/projects/state" && method === "PUT") {
      const parsed = projectMapStateSchema.safeParse(await readBody(req, 2_000_000));
      if (!parsed.success) return json(res, 400, { error: "Invalid project map" });
      writeProjectMapState(deps.dataDir, parsed.data);
      return json(res, 200, { ok: true });
    }
    return PASS;
  };
}
