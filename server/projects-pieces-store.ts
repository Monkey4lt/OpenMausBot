import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { PIECE_KINDS, type PieceKind } from "../shared/projects-pieces.ts";
import { writeFileAtomic } from "./atomic.ts";

/**
 * The kinds of pieces found the last time each project was read, so the overview can show them without reading any file.
 * It holds project ids and piece kinds only: no file name, path or content.
 */
export const PIECES_FILE = "projects-pieces.json";

const fileSchema = z.object({
  v: z.literal(1),
  kinds: z.record(z.string().min(1).max(400), z.array(z.enum(PIECE_KINDS as [PieceKind, ...PieceKind[]])).max(PIECE_KINDS.length)),
});

export function readPieceKinds(dataDir: string): Record<string, PieceKind[]> {
  try {
    const parsed = fileSchema.safeParse(JSON.parse(readFileSync(join(dataDir, PIECES_FILE), "utf8")));
    return parsed.success ? parsed.data.kinds : {};
  } catch {
    return {};
  }
}

/** Saves one project's kinds, deduplicated in display order; writes nothing when they did not change. */
export function savePieceKinds(dataDir: string, projectId: string, found: readonly PieceKind[]): void {
  const kinds = PIECE_KINDS.filter((kind) => found.includes(kind));
  const all = readPieceKinds(dataDir);
  const before = Object.hasOwn(all, projectId) ? all[projectId] : undefined;
  if (before && before.join() === kinds.join()) return;
  writeFileAtomic(join(dataDir, PIECES_FILE), JSON.stringify({ v: 1, kinds: { ...all, [projectId]: kinds } }), { mode: 0o600 });
}
