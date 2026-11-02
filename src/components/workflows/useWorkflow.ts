import { useCallback, useEffect, useRef, useState } from "react";

import { listenLiveFrames } from "@/lib/live-events";
import { createMapSync, type SaveStatus } from "@/lib/projects-map-sync";
import type { WorkflowProblem } from "@/lib/workflows/editor";
import { runRefusal, upsertRun, type RunRefusal } from "@/lib/workflows/run";
import { api } from "@/state/api";
import type { Workflow, WorkflowRun } from "../../../shared/workflows";

type Answer = { workflow: Workflow; problems: WorkflowProblem[] };
const SAVE_DELAY_MS = 800;

/** One workflow as the editor sees it: loaded, saved shortly after each change with the rev it was based on, kept in
 * step with other tabs and with its runs through live frames. */
export function useWorkflow(id: string) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [problems, setProblems] = useState<WorkflowProblem[]>([]);
  const [saveState, setSaveState] = useState<SaveStatus>("idle");
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [gone, setGone] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [refusal, setRefusal] = useState<RunRefusal | null>(null);
  const latest = useRef<Workflow | null>(null);
  const unsaved = useRef(false);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const path = `/api/workflows/${encodeURIComponent(id)}`;

  const [sync] = useState(() => createMapSync<Workflow>({
    put: async ({ baseRev, ...next }) => {
      unsaved.current = false;
      const answer = await api<Answer>(path, { method: "PUT", body: JSON.stringify({ workflow: next, baseRev }) });
      setProblems(answer.problems);
      return { rev: answer.workflow.rev };
    },
    reload: () => { void loadRef.current(); },
    changedElsewhere: () => setChangedElsewhere(true),
    status: setSaveState,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    delayMs: SAVE_DELAY_MS,
    frameRev: (frame) => (frame.kind === "workflow" && frame.id === id && typeof frame.rev === "number" && frame.rev > 0 ? frame.rev : null),
  }));

  const load = useCallback(async () => {
    try {
      const [answer, history] = await Promise.all([api<Answer>(path), api<{ runs: WorkflowRun[] }>(`${path}/runs`).catch(() => ({ runs: [] }))]);
      sync.loaded(answer.workflow);
      latest.current = answer.workflow;
      setWorkflow(answer.workflow);
      setProblems(answer.problems);
      setRuns(history.runs.reduce<WorkflowRun[]>((list, run) => upsertRun(list, run), []));
      setLoadFailed(false);
    } catch (error) {
      if ((error as { status?: number }).status === 404) setGone(true);
      else setLoadFailed(true);
    }
  }, [path, sync]);
  loadRef.current = load;
  useEffect(() => { void load(); }, [load]);

  useEffect(() => listenLiveFrames({
    onFrame: (raw) => {
      const frame = raw as { kind: string; id?: unknown; rev?: unknown; run?: WorkflowRun };
      if (frame.kind === "workflow" && frame.id === id && frame.rev === 0) setGone(true);
      if (frame.kind === "workflow-run" && frame.run?.workflowId === id) setRuns((list) => upsertRun(list, frame.run!));
      sync.frame(frame);
    },
    onMissedFrames: () => { void loadRef.current(); },
  }), [id, sync]);

  /** Every change goes through here and is saved shortly after. */
  const edit = useCallback((change: (w: Workflow) => Workflow) => {
    const prev = latest.current;
    if (!prev) return;
    const next = change(prev);
    if (next === prev) return;
    latest.current = next;
    unsaved.current = true;
    setWorkflow(next);
    sync.later(next);
  }, [sync]);

  /** A change shown at once but saved only by a later edit (a block being dragged). */
  const preview = useCallback((change: (w: Workflow) => Workflow) => {
    const prev = latest.current;
    if (!prev) return;
    latest.current = change(prev);
    setWorkflow(latest.current);
  }, []);

  const act = useCallback(async (request: () => Promise<{ run?: WorkflowRun }>) => {
    setRefusal(null);
    try {
      if (unsaved.current && latest.current) await sync.now(latest.current);
      const answer = await request();
      if (answer.run) setRuns((list) => upsertRun(list, answer.run!));
      return answer.run ?? null;
    } catch (error) {
      const why = runRefusal(error);
      if (why.kind === "invalid") setProblems(why.problems);
      setRefusal(why);
      return null;
    }
  }, [sync]);

  const post = (url: string, body?: unknown) => api<{ run?: WorkflowRun }>(url, { method: "POST", body: JSON.stringify(body ?? {}) });
  return {
    workflow, problems, saveState, changedElsewhere, gone, loadFailed, runs, refusal,
    edit, preview,
    reload: () => { setChangedElsewhere(false); void load(); },
    dismissChanged: () => setChangedElsewhere(false),
    dismissRefusal: () => setRefusal(null),
    run: () => act(() => post(`${path}/run`)),
    runStep: (nodeId: string) => act(() => post(`${path}/run-step`, { nodeId })),
    retry: (runId: string, nodeId: string) => act(() => post(`/api/workflows/runs/${encodeURIComponent(runId)}/retry`, { nodeId })),
    cancel: (runId: string) => act(() => post(`/api/workflows/runs/${encodeURIComponent(runId)}/cancel`)),
    remove: async () => {
      await api(`${path}?baseRev=${sync.rev()}`, { method: "DELETE" });
    },
  };
}
