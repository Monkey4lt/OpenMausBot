export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface MapSyncDeps<S extends { rev?: number }> {
  /** PUT /api/projects/state; rejects with `status` 409 when baseRev is stale. */
  put(body: S & { baseRev: number }): Promise<{ rev: number }>;
  reload(): void;
  /** The map changed under an edit the person had not saved yet. */
  changedElsewhere(): void;
  status(value: SaveStatus): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
  delayMs: number;
}

/** The page's saves: each carries the rev it was based on, and a change made elsewhere drops the save that would undo it. */
export function createMapSync<S extends { rev?: number }>(deps: MapSyncDeps<S>) {
  let rev = 0;
  let timer: unknown = null;
  let pending = false;

  const cancel = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    const had = pending;
    pending = false;
    return had;
  };

  const stale = (error: unknown) => (error as { status?: unknown } | null)?.status === 409;

  async function send(next: S): Promise<void> {
    deps.status("saving");
    try {
      const answer = await deps.put({ ...next, baseRev: rev });
      rev = answer.rev;
      deps.status("saved");
    } catch (error) {
      if (stale(error)) {
        deps.reload();
        deps.changedElsewhere();
        deps.status("idle");
      } else {
        deps.status("error");
      }
      throw error;
    }
  }

  return {
    rev: () => rev,
    loaded(state: S) {
      cancel();
      rev = state.rev ?? 0;
    },
    later(next: S) {
      cancel();
      pending = true;
      deps.status("saving");
      timer = deps.setTimer(() => {
        timer = null;
        pending = false;
        send(next).catch(() => {});
      }, deps.delayMs);
    },
    now(next: S): Promise<void> {
      cancel();
      return send(next);
    },
    frame(frame: { kind?: unknown; rev?: unknown }) {
      if (frame.kind !== "projects.changed" || typeof frame.rev !== "number" || frame.rev <= rev) return;
      const lost = cancel();
      deps.reload();
      if (lost) {
        deps.changedElsewhere();
        deps.status("idle");
      }
    },
  };
}
