import type { Architecture } from "./projects-architecture.ts";

export type PieceKind = "ui" | "api" | "database" | "cache" | "jobs" | "external" | "chatbot" | "tests" | "deploy";

/** The order pieces are listed and shown in. */
export const PIECE_KINDS: readonly PieceKind[] = ["ui", "api", "database", "cache", "jobs", "external", "chatbot", "tests", "deploy"];

/** The plain word for each piece, shown first; the technology comes second, in small. */
export const PIECE_LABELS: Record<PieceKind, { fr: string; en: string }> = {
  ui: { fr: "Site / interface", en: "Website / interface" },
  api: { fr: "Serveur / API", en: "Server / API" },
  database: { fr: "Base de données", en: "Database" },
  cache: { fr: "Mémoire rapide", en: "Fast memory" },
  jobs: { fr: "Tâches en arrière-plan", en: "Background tasks" },
  external: { fr: "Service externe", en: "Outside service" },
  chatbot: { fr: "Bot de messagerie", en: "Messaging bot" },
  tests: { fr: "Tests", en: "Tests" },
  deploy: { fr: "Mise en ligne", en: "Going online" },
};

/** Why a file counts as evidence; the app turns each code into plain words, `reason` is the same in English for the bot. */
export const EVIDENCE_CODES = [
  "dependency", "compose_image", "vue_component", "svelte_component", "screen_component", "web_page", "prisma_schema",
  "migration", "sql_file", "docker_build", "compose_file", "ci_workflow", "vercel", "netlify", "fly", "procfile", "test_file",
] as const;
export type EvidenceCode = (typeof EVIDENCE_CODES)[number];

/**
 * One part of a project found from its manifests and files.
 * `tech` is empty when the piece has no single technology (the tests family).
 * `evidence` holds at most 5 entries; `reason` is a short English phrase for the bot, not shown as is.
 * `modules` are module ids of the project's architecture.
 */
export interface Piece {
  kind: PieceKind;
  tech: string;
  evidence: { path: string; code: EvidenceCode; reason: string }[];
  modules: string[];
}

/** `count` is the number of calls or importing files behind the link; `examples` holds at most 5 of them. */
export interface PieceLink {
  from: PieceKind;
  to: PieceKind;
  count: number;
  examples: { from: string; to: string }[];
}

/** The body of GET /api/projects/architecture. */
export type ArchitectureWithPieces = Architecture & { pieces: Piece[]; pieceLinks: PieceLink[] };
