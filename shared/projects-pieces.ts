import type { Architecture } from "./projects-architecture.ts";

export type PieceKind = "ui" | "api" | "database" | "cache" | "jobs" | "external" | "chatbot" | "tests" | "deploy";

/** The order pieces are listed and shown in. */
export const PIECE_KINDS: readonly PieceKind[] = ["ui", "api", "database", "cache", "jobs", "external", "chatbot", "tests", "deploy"];

/** The plain word for each piece; this one table feeds the app, the Cartographe and its diagram. An outside service is named by its brand instead. */
export const PIECE_LABELS: Record<PieceKind, { fr: string; en: string }> = {
  ui: { fr: "Site ou appli", en: "Website or app" },
  api: { fr: "Serveur", en: "Server" },
  database: { fr: "Base de données", en: "Database" },
  cache: { fr: "Mémoire rapide", en: "Fast memory" },
  jobs: { fr: "Tâches automatiques", en: "Automatic tasks" },
  external: { fr: "Service extérieur", en: "Outside service" },
  chatbot: { fr: "Bot de messagerie", en: "Messaging bot" },
  tests: { fr: "Vérifications", en: "Checks" },
  deploy: { fr: "Mise en ligne", en: "Going online" },
};

/** The line under a piece when nobody described it. */
export const PIECE_DEFAULT_TEXT: Record<PieceKind, { fr: string; en: string }> = {
  ui: { fr: "Ce que les gens voient et utilisent.", en: "What people see and use." },
  chatbot: { fr: "Répond aux gens dans une messagerie.", en: "Answers people in a messaging app." },
  api: { fr: "Reçoit les demandes et fait le travail.", en: "Takes the requests and does the work." },
  jobs: { fr: "Travaille tout seul, en fond ou à heure fixe.", en: "Works on its own, in the background or on a schedule." },
  database: { fr: "Garde les informations pour plus tard.", en: "Keeps information for later." },
  cache: { fr: "Garde sous la main ce qui sert souvent.", en: "Keeps what is often needed close at hand." },
  external: { fr: "Un service d'une autre entreprise.", en: "A service from another company." },
  tests: { fr: "Vérifie que tout marche avant la mise en ligne.", en: "Checks that everything works before going online." },
  deploy: { fr: "Met le projet en ligne.", en: "Puts the project online." },
};

/**
 * The columns of the « Comment ça marche » view, left to right; tests and deploy sit in a quiet row under them.
 * A column with `under` stacks below that column when it has boxes, so the server's arrows to it never cross it.
 */
export const FLOW_COLUMNS: readonly { id: "see" | "work" | "store" | "outside"; kinds: readonly PieceKind[]; under?: "store" }[] = [
  { id: "see", kinds: ["ui", "chatbot"] },
  { id: "work", kinds: ["api", "jobs"] },
  { id: "store", kinds: ["database", "cache"] },
  { id: "outside", kinds: ["external"], under: "store" },
];
export const BUILD_KINDS: readonly PieceKind[] = ["tests", "deploy"];

/** The kinds a project's card shows, in order; tests and deploy never do. */
export const CARD_KINDS: readonly PieceKind[] = ["ui", "chatbot", "api", "jobs", "database", "cache", "external"];

/**
 * A piece as the Cartographe names it in describe_piece and as `ArchOverrides.pieceText` keys it: the kind, or
 * `external:<Tech>` for an outside service, since each one is its own box.
 */
export type PieceKey = PieceKind | `external:${string}`;
export const PIECE_KEY_PATTERN = /^(?:ui|api|database|cache|jobs|chatbot|tests|deploy|external|external:[A-Za-z0-9][\w .+-]{0,39})$/;

export function pieceKey(piece: { kind: PieceKind; tech: string }): PieceKey {
  return piece.kind === "external" && piece.tech ? `external:${piece.tech}` : piece.kind;
}

/** What one piece does to the next, read as "[from] phrase [to]". */
export const LINK_PHRASES: Record<"ui->api" | "api->database" | "api->cache", { fr: string; en: string }> = {
  "ui->api": { fr: "envoie ses demandes au", en: "sends its requests to" },
  "api->database": { fr: "range les informations dans", en: "keeps its information in" },
  "api->cache": { fr: "garde sous la main dans", en: "keeps things at hand in" },
};

const EXTERNAL_PHRASES: readonly { techs: readonly string[]; fr: string; en: string }[] = [
  { techs: ["Stripe"], fr: "encaisse les paiements avec", en: "takes payments with" },
  { techs: ["Nodemailer", "SendGrid"], fr: "envoie les e-mails avec", en: "sends e-mails with" },
  { techs: ["Twilio"], fr: "envoie les SMS avec", en: "sends texts with" },
  { techs: ["OpenAI", "Anthropic"], fr: "demande à l'IA de", en: "asks the AI of" },
];

/** The server → outside service phrase for one service; "utilise" for any other. */
export function externalPhrase(tech: string, locale: "fr" | "en"): string {
  const found = EXTERNAL_PHRASES.find((p) => p.techs.includes(tech));
  return found ? found[locale] : locale === "fr" ? "utilise" : "uses";
}

/** Why a file counts as evidence; the app turns each code into plain words, `reason` is the same in English for the bot. */
export const EVIDENCE_CODES = [
  "dependency", "compose_image", "vue_component", "svelte_component", "screen_component", "web_page", "prisma_schema",
  "migration", "sql_file", "docker_build", "compose_file", "ci_workflow", "vercel", "netlify", "fly", "procfile", "test_file", "folder",
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
