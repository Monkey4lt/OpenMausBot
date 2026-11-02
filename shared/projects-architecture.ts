export type Family = "tests" | "docs" | "i18n" | "data" | "config" | "scripts" | "assets" | "ui" | "server" | "other";

/** Priority order: a file goes to the first family whose rules match it. Also the order families are shown in. */
export const FAMILY_ORDER: readonly Family[] = ["tests", "docs", "i18n", "data", "config", "scripts", "assets", "ui", "server", "other"];

/**
 * The person's corrections for one project, kept in projects-map.json under `overrides[projectId]`.
 * `summary` is the "En bref" card (at most 600 characters, line breaks kept), its first line the sentence on the project's card;
 * `familyText`, `moduleText` and `pieceText` are one-line descriptions of at most 160 characters, `pieceText` keyed by `PieceKey`.
 */
export type ArchOverrides = {
  moduleFamily: Record<string, Family>;
  familyNames: Partial<Record<Family, string>>;
  summary?: string;
  familyText?: Partial<Record<Family, string>>;
  moduleText?: Record<string, string>;
  pieceText?: Record<string, string>;
};

export const SUMMARY_MAX = 600;
export const DESCRIPTION_MAX = 160;

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
