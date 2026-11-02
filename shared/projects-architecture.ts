export type Family = "tests" | "docs" | "i18n" | "data" | "config" | "scripts" | "assets" | "ui" | "server" | "other";

/** Priority order: a file goes to the first family whose rules match it. Also the order families are shown in. */
export const FAMILY_ORDER: readonly Family[] = ["tests", "docs", "i18n", "data", "config", "scripts", "assets", "ui", "server", "other"];

/** The person's corrections for one project, kept in projects-map.json under `overrides[projectId]`. */
export type ArchOverrides = { moduleFamily: Record<string, Family>; familyNames: Partial<Record<Family, string>> };

/**
 * The body of GET /api/projects/architecture.
 * Module ids are a folder prefix (`src/components`), `(root)/<family>` for loose files, and get `#<family>` appended
 * when two families share one folder; they are ids, not paths.
 */
export interface Architecture {
  families: { id: Family; name: string; files: number; modules: string[] }[];
  modules: { id: string; family: Family; files: number }[];
  files: { path: string; module: string; uses: string[]; usedBy: string[] }[];
  /** `weight` is the number of imports the edge stands for. */
  edges: { level: "family" | "module"; from: string; to: string; weight: number }[];
  external: { name: string; count: number }[];
  /** True when the project had more code files than the server reads. */
  truncated: boolean;
}

export const MAX_CODE_FILES = 3000;
