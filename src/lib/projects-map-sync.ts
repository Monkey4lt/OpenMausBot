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
  /** The rev a live frame announces for this state, or null when the frame is about something else. */
  frameRev?(frame: { kind?: unknown; rev?: unknown; id?: unknown }): number | null;
}

/**
 * The page's saves: each carries the rev it was based on, and a change made elsewhere drops the save that would undo it.
 * Saves go one at a time; a projects.changed frame that lands during a save is weighed against the rev the save answers,
 * since the server sends the frame for that save before its answer.
 */
function projectsFrameRev(frame: { kind?: unknown; rev?: unknown }): number | null {
  return frame.kind === "projects.changed" && typeof frame.rev === "number" ? frame.rev : null;
}

export function createMapSync<S extends { rev?: number }>(deps: MapSyncDeps<S>) {
  let rev = 0;
  let timer: unknown = null;
  let pending = false;
  let saving = 0;
  let heldRev = 0;
  let epoch = 0;
  let queue: Promise<void> = Promise.resolve();

  const cancel = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    const had = pending;
    pending = false;
    return had;
  };

  const stale = (error: unknown) => (error as { status?: unknown } | null)?.status === 409;

  function changedElsewhere(): void {
    epoch++;
    const lost = cancel();
    deps.reload();
    if (lost) {
      deps.changedElsewhere();
      deps.status("idle");
    }
  }

  function settleHeld(): void {
    const newest = heldRev;
    heldRev = 0;
    if (newest > rev) changedElsewhere();
  }

  async function put(next: S): Promise<void> {
    deps.status("saving");
    try {
      const answer = await deps.put({ ...next, baseRev: rev });
      rev = answer.rev;
      deps.status("saved");
    } catch (error) {
      if (stale(error)) {
        epoch++;
        heldRev = 0;
        deps.reload();
        deps.changedElsewhere();
        deps.status("idle");
      } else {
        deps.status("error");
      }
      throw error;
    }
  }

  function send(next: S): Promise<void> {
    const queuedAt = epoch;
    const start = saving ? queue.catch(() => {}).then(() => (epoch === queuedAt ? put(next) : undefined)) : put(next);
    saving++;
    const run = start.finally(() => {
      saving--;
      if (!saving) settleHeld();
    });
    queue = run;
    return run;
  }

  return {
    rev: () => rev,
    loaded(state: S) {
      if (cancel()) {
        deps.changedElsewhere();
        deps.status("idle");
      }
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
    frame(frame: { kind?: unknown; rev?: unknown; id?: unknown }) {
      const announced = (deps.frameRev ?? projectsFrameRev)(frame);
      if (announced === null || announced <= rev) return;
      if (saving) {
        heldRev = Math.max(heldRev, announced);
        return;
      }
      changedElsewhere();
    },
  };
}
