import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, Gauge, History, Loader2, Play, ShieldAlert, Square, Trash2, TriangleAlert, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { centerOn, DEFAULT_VIEW, screenToWorld, type PortAnchor, type Point, type Rect } from "@/lib/canvas/geometry";
import type { Tool } from "@/lib/canvas/gestures";
import { annotationBounds, annotationText, cleanAnnotations, type Annotation } from "@/lib/canvas/model";
import { activeLocale, t } from "@/lib/i18n";
import type { SaveStatus } from "@/lib/projects-map-sync";
import {
  addNode, connect, duplicateNode, hasBlockOfKind, insertApprovalBefore, moveNode, newEditorId, NODE_HEIGHT, NODE_WIDTH, nodeSummary, openingView,
  portsFor, problemsByTarget, problemText, removeEdge, removeNode, updateNodeData, type ConnectRefusal, type WorkflowProblem,
} from "@/lib/workflows/editor";
import { formatUsd, isRunning, stepsByNode, type RunRefusal } from "@/lib/workflows/run";
import { viewerTimeZone } from "@/lib/workflows/schedule";
import type { LocaleKey } from "@/locales";
import { DEFAULT_LIMITS, NODE_KINDS, type NodeKind, type OutputPort, type Workflow, type WorkflowRun } from "../../../shared/workflows";
import { AnnotationLayer } from "../canvas/AnnotationLayer";
import { Canvas } from "../canvas/Canvas";
import { CanvasSearch, type CanvasSearchItem } from "../canvas/CanvasSearch";
import { EdgeLayer, type CanvasEdge } from "../canvas/EdgeLayer";
import { portAnchors } from "../canvas/NodeFrame";
import { Toolbar } from "../canvas/Toolbar";
import type { BotOption, ModelOption } from "./NodeSettings";
import { PillSelect } from "./NodeSettings";
import { RUN_DOT, RunPanel } from "./RunPanel";
import { useWorkflow } from "./useWorkflow";
import { KIND_ICON, KIND_LABEL, WorkflowNodeCard } from "./WorkflowNodeCard";

export type { BotOption, ModelOption } from "./NodeSettings";

const REFUSED: Record<ConnectRefusal, LocaleKey> = {
  "edge-to-note": "workflows.refused.edge-to-note", "edge-from-note": "workflows.refused.edge-from-note", "bad-port": "workflows.refused.bad-port",
  "self-loop": "workflows.refused.self-loop", cycle: "workflows.refused.cycle", "duplicate-edge": "workflows.refused.duplicate-edge", "dangling-edge": "workflows.refused.dangling-edge",
};
const KIND_HINT: Record<NodeKind, LocaleKey> = {
  trigger: "workflows.kind.trigger.hint", ai: "workflows.kind.ai.hint", bot: "workflows.kind.bot.hint", condition: "workflows.kind.condition.hint",
  approval: "workflows.kind.approval.hint", send: "workflows.kind.send.hint", note: "workflows.kind.note.hint",
};
const OUTPUTS: readonly string[] = ["out", "yes", "no"];

export type EditorProps = {
  workflowId: string;
  projects: readonly { id: string; name: string }[];
  bots: readonly BotOption[];
  models: readonly ModelOption[];
  onBack: () => void;
  onDeleted: () => void;
  /** Asks the person to confirm; resolves true on yes. */
  confirm: (title: string, text: string) => Promise<boolean>;
};

/** The workflow editor on the Atelier canvas (loaded on demand). */
export default function WorkflowEditor({ workflowId, projects, bots, models, onBack, onDeleted, confirm }: EditorProps) {
  const wf = useWorkflow(workflowId);
  if (wf.gone) {
    return <Centered>
      <p className="text-[14px] text-ink">{t("workflows.deleted")}</p>
      <button type="button" onClick={onDeleted} className="mt-3 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-app">{t("workflows.backToAtelier")}</button>
    </Centered>;
  }
  if (!wf.workflow) {
    return <Centered>{wf.loadFailed
      ? <><p className="text-[14px] text-ink">{t("workflows.loadFailed")}</p><button type="button" onClick={wf.reload} className="mt-3 rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-raised">{t("projects.map.retry")}</button></>
      : <Loader2 size={20} className="animate-spin text-ink-secondary" />}</Centered>;
  }
  return <WorkflowEditorView workflow={wf.workflow} problems={wf.problems} saveState={wf.saveState} changedElsewhere={wf.changedElsewhere}
    runs={wf.runs} refusal={wf.refusal} projects={projects} bots={bots} models={models}
    onEdit={wf.edit} onPreview={wf.preview} onRun={wf.run} onRunStep={wf.runStep} onRetry={wf.retry} onCancel={wf.cancel}
    onBack={onBack} onReload={wf.reload} onDismissChanged={wf.dismissChanged} onDismissRefusal={wf.dismissRefusal}
    onDelete={async () => {
      if (!await confirm(t("workflows.delete.title", { name: wf.workflow!.name }), t("workflows.delete.text"))) return;
      await wf.remove().then(onDeleted, () => {});
    }} />;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-app p-6 text-center">{children}</div>;
}

type WireDraft = { from: { node: string; port: OutputPort }; start: PortAnchor; at: Point };

export type EditorViewProps = {
  workflow: Workflow;
  problems: readonly WorkflowProblem[];
  saveState: SaveStatus;
  changedElsewhere: boolean;
  runs: readonly WorkflowRun[];
  refusal: RunRefusal | null;
  projects: readonly { id: string; name: string }[];
  bots: readonly BotOption[];
  models: readonly ModelOption[];
  onEdit: (change: (w: Workflow) => Workflow) => void;
  onPreview: (change: (w: Workflow) => Workflow) => void;
  onRun: () => Promise<WorkflowRun | null>;
  onRunStep: (nodeId: string) => Promise<WorkflowRun | null>;
  onRetry: (runId: string, nodeId: string) => Promise<WorkflowRun | null>;
  onCancel: (runId: string) => Promise<unknown>;
  onBack: () => void;
  onDelete: () => void;
  onReload: () => void;
  onDismissChanged: () => void;
  onDismissRefusal: () => void;
  /** For screenshots and tests: what is open at first. */
  initial?: { panel?: boolean; openStep?: string; selected?: string; now?: number };
};

export function WorkflowEditorView(props: EditorViewProps) {
  const { workflow, problems, runs, onEdit, onPreview } = props;
  const locale = activeLocale();
  const timeZone = useMemo(viewerTimeZone, []);
  const [now, setNow] = useState(() => props.initial?.now ?? Date.now());
  const [view, setView] = useState(DEFAULT_VIEW);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(props.initial?.selected ?? null);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(props.initial?.panel ?? false);
  const [openStep, setOpenStep] = useState<string | null>(props.initial?.openStep ?? null);
  const [shownRunId, setShownRunId] = useState<string | null>(null);
  const [wire, setWire] = useState<WireDraft | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const fitted = useRef(false);

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!hint) return; const timer = setTimeout(() => setHint(null), 3500); return () => clearTimeout(timer); }, [hint]);

  useEffect(() => () => observer.current?.disconnect(), []);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === "undefined") return;
    observer.current ??= new ResizeObserver((entries) => setSizes((prev) => {
      const next = { ...prev };
      for (const entry of entries) {
        const node = entry.target as HTMLElement;
        next[node.dataset.canvasNode!] = { w: node.offsetWidth, h: node.offsetHeight };
      }
      return next;
    }));
    observer.current.observe(el);
  }, []);

  const rects = useMemo(() => new Map(workflow.nodes.map((n) => [n.id, { x: n.x, y: n.y, w: NODE_WIDTH[n.kind], h: sizes[n.id]?.h ?? NODE_HEIGHT[n.kind] } satisfies Rect])), [workflow.nodes, sizes]);
  const anchors = useCallback((id: string) => {
    const node = workflow.nodes.find((n) => n.id === id);
    return node ? portAnchors(rects.get(id)!, portsFor(node.kind)) : {};
  }, [workflow.nodes, rects]);
  const annotations = useMemo(() => cleanAnnotations(workflow.annotations), [workflow.annotations]);
  const frame = useMemo(() => [...rects.values(), ...annotations.map(annotationBounds)], [rects, annotations]);
  const grouped = useMemo(() => problemsByTarget(problems), [problems]);

  const viewport = () => ({ w: box?.clientWidth ?? 0, h: box?.clientHeight ?? 0 });
  const measured = workflow.nodes.every((n) => sizes[n.id]);
  useEffect(() => {
    if (fitted.current || !box || !(box.clientWidth > 0) || !measured) return;
    fitted.current = true;
    setView(openingView(frame, viewport()));
  });

  const shown = (shownRunId ? runs.find((r) => r.id === shownRunId) : undefined) ?? runs[0] ?? null;
  const steps = stepsByNode(shown);
  const busy = runs.some(isRunning);
  const running = runs.find(isRunning);

  const edges: CanvasEdge[] = workflow.edges.flatMap((edge) => {
    const from = anchors(edge.from.node)[edge.from.port], to = anchors(edge.to.node).in;
    if (!from || !to) return [];
    const problem = grouped.edges[edge.id]?.[0];
    return [{ id: edge.id, from, to, label: problem ? problemText(problem, locale) : undefined }];
  });
  if (wire) edges.push({ id: "__wire", from: wire.start, to: { ...wire.at, side: wire.at.x >= wire.start.x ? "left" : "right" }, dashed: false });

  const worldAt = (clientX: number, clientY: number): Point => {
    const bounds = box?.getBoundingClientRect();
    return screenToWorld(view, { x: clientX - (bounds?.left ?? 0), y: clientY - (bounds?.top ?? 0) });
  };

  // Wiring: press an output port, drag, release over another block.
  const startWire = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || tool !== "select") return;
    const port = (event.target as Element).closest<HTMLElement>("[data-canvas-port]");
    const nodeId = port?.closest<HTMLElement>("[data-canvas-node]")?.dataset.canvasNode;
    const portId = port?.dataset.canvasPort;
    if (!port || !nodeId || !portId || !OUTPUTS.includes(portId)) return;
    const start = anchors(nodeId)[portId];
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    const from = { node: nodeId, port: portId as OutputPort };
    setWire({ from, start, at: worldAt(event.clientX, event.clientY) });
    const move = (e: PointerEvent) => setWire((w) => (w ? { ...w, at: worldAt(e.clientX, e.clientY) } : w));
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setWire(null);
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-canvas-node]")?.dataset.canvasNode;
      if (!target || target === nodeId) return;
      const id = newEditorId("e");
      const result = connect(workflow, from, { node: target }, id);
      if ("refused" in result) { setHint(t(REFUSED[result.refused])); return; }
      onEdit((w) => { const next = connect(w, from, { node: target }, id); return "refused" in next ? w : next; });
    };
    const cancel = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); setWire(null); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  const add = (kind: NodeKind) => {
    setAddOpen(false);
    const size = viewport();
    const centre = screenToWorld(view, { x: size.w / 2, y: size.h / 2 });
    let at = { x: Math.round(centre.x - NODE_WIDTH[kind] / 2), y: Math.round(centre.y - NODE_HEIGHT[kind] / 2) };
    const overlaps = (x: number, y: number) => [...rects.values()].some((r) => x < r.x + r.w + 24 && r.x < x + NODE_WIDTH[kind] + 24 && y < r.y + r.h + 24 && r.y < y + NODE_HEIGHT[kind] + 24);
    for (let tries = 0; tries < 30 && overlaps(at.x, at.y); tries++) at = { x: at.x + 60, y: at.y + (tries % 2 ? 60 : 0) };
    const id = newEditorId(kind[0]!);
    onEdit((w) => addNode(w, kind, at, id));
    setSelected(id);
  };

  const select = (id: string) => {
    setSelected(id);
    if (steps[id]) { setOpenStep(id); setPanelOpen(true); }
  };
  const run = async () => {
    setShownRunId(null);
    setOpenStep(null);
    await props.onRun();
  };
  const runStep = async (id: string) => {
    setShownRunId(null);
    const started = await props.onRunStep(id);
    if (started) { setOpenStep(id); setPanelOpen(true); }
  };
  const retry = async (runId: string, id: string) => {
    setShownRunId(null);
    const started = await props.onRetry(runId, id);
    if (started) setOpenStep(id);
  };

  const ctx = { bots: props.bots, models: props.models, now, timeZone, locale };
  const firstBot = workflow.nodes.find((n) => n.kind === "bot");
  const searchItems: CanvasSearchItem[] = [
    ...workflow.nodes.map((n) => ({ id: n.id, label: nodeSummary(n) || t(KIND_LABEL[n.kind]), rect: rects.get(n.id)!, kind: t(KIND_LABEL[n.kind]) })),
    ...annotations.flatMap((a) => { const text = annotationText(a)?.trim(); return text ? [{ id: a.id, label: text.split("\n")[0]!, rect: annotationBounds(a), kind: t("atelier.annotation.note") }] : []; }),
  ];
  const focus = (id: string) => {
    const r = rects.get(id) ?? searchItems.find((i) => i.id === id)?.rect;
    if (!r) return;
    setSelected(id);
    setView(centerOn(view, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, viewport()));
  };

  const refusalText = props.refusal && refusalMessage(props.refusal);
  const general = [...grouped.general.map((p) => problemText(p, locale))];

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-app" data-workflow-editor={workflow.id}>
    <EditorHeader workflow={workflow} projects={props.projects} saveState={props.saveState} running={running ?? null} lastRun={runs[0] ?? null}
      panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(!panelOpen)} onBack={props.onBack} onDelete={props.onDelete} onEdit={onEdit}
      onRun={() => void run()} onStop={() => running && void props.onCancel(running.id)} />
    {props.changedElsewhere && <Strip tone="warning" onClose={props.onDismissChanged}>
      {t("workflows.changed")}
      <button type="button" onClick={props.onReload} className="ml-2 rounded-md px-2 py-0.5 font-medium text-ink hover:bg-raised">{t("workflows.reload")}</button>
    </Strip>}
    {firstBot && <BotWarning hasApproval={hasBlockOfKind(workflow, "approval")}
      onAddApproval={() => { const id = newEditorId("p"); onEdit((w) => insertApprovalBefore(w, firstBot.id, id, newEditorId("e"))); setSelected(id); }} />}

    <div ref={setBox} className="relative flex min-h-0 min-w-0 flex-1" onPointerDownCapture={startWire}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && (e.target as Element).closest("[data-canvas]")) { e.preventDefault(); setSearchOpen(true); }
        if ((e.key === "Delete" || e.key === "Backspace") && selected && (e.target as Element).matches("[data-canvas]") && rects.has(selected)) { onEdit((w) => removeNode(w, selected)); setSelected(null); }
      }}>
      <Canvas view={view} onViewChange={setView} tool={tool} rects={frame} minimap label={workflow.name}
        onBackgroundClick={() => { setSelected(null); setAddOpen(false); }}
        toolbar={<div className="relative">
          {addOpen && <AddMenu onPick={add} onClose={() => setAddOpen(false)} />}
          <Toolbar tool={tool} onTool={setTool} search={() => setSearchOpen((open) => !open)} onAdd={() => setAddOpen((open) => !open)} />
        </div>}
        overlay={<AnnotationLayer items={annotations} tool={tool} selectedId={selected} onSelect={setSelected} onTool={setTool}
          onChange={(items: Annotation[]) => onEdit((w) => ({ ...w, annotations: items }))} />}
        underlay={<EdgeLayer edges={edges} onEdgeClick={(id) => { if (id !== "__wire") onEdit((w) => removeEdge(w, id)); }} />}>
        {workflow.nodes.map((node) => <WorkflowNodeCard key={node.id} node={node} rect={rects.get(node.id)!} selected={selected === node.id}
          step={steps[node.id]} problems={grouped.nodes[node.id] ?? []} ctx={ctx} busy={busy} nodeRef={measure}
          onSelect={select} onMove={(id, x, y) => onPreview((w) => moveNode(w, id, x, y))} onMoveEnd={(id, x, y) => onEdit((w) => moveNode(w, id, x, y))}
          onPatch={(id, patch) => onEdit((w) => updateNodeData(w, id, patch))}
          onDuplicate={(id) => { const copy = newEditorId(node.kind[0]!); onEdit((w) => duplicateNode(w, id, copy)); setSelected(copy); }}
          onDelete={(id) => { onEdit((w) => removeNode(w, id)); setSelected(null); }}
          onRunAll={() => void run()} onRunStep={(id) => void runStep(id)}
          onRetry={shown && shown.status !== "running" ? (id) => void retry(shown.id, id) : undefined}
          onDetails={(id) => { setOpenStep(id); setPanelOpen(true); }} />)}
      </Canvas>

      {(general.length > 0 || refusalText || hint) && <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col items-center gap-1.5">
        {general.map((text, i) => <Pill key={i} tone="danger">{text}</Pill>)}
        {refusalText && <Pill tone="danger" onClose={props.onDismissRefusal}>{refusalText}</Pill>}
        {hint && <Pill tone="ink">{hint}</Pill>}
      </div>}
      {searchOpen && <div className="absolute inset-x-0 top-3 z-30 flex justify-center px-3">
        <CanvasSearch items={searchItems} onPick={focus} onClose={() => setSearchOpen(false)} />
      </div>}
      {panelOpen && <RunPanel workflow={workflow} runs={runs} shown={shown} openStep={openStep} onOpenStep={setOpenStep}
        onShowRun={(id) => { setShownRunId(id); setOpenStep(null); }} onRetry={(runId, id) => void retry(runId, id)} onCancel={(id) => void props.onCancel(id)}
        onClose={() => setPanelOpen(false)} locale={locale} timeZone={timeZone} />}
    </div>
  </div>;
}

function refusalMessage(refusal: RunRefusal): string {
  switch (refusal.kind) {
    case "invalid": return t("workflows.runRefused");
    case "busy": return t("workflows.busy");
    case "unavailable": return t("workflows.unavailable");
    case "gone": return t("workflows.deleted");
    case "error": return t("workflows.runError", { message: refusal.message });
  }
}

function Pill({ tone, children, onClose }: { tone: "danger" | "ink"; children: ReactNode; onClose?: () => void }) {
  return <div role="status" className={cn("pointer-events-auto flex max-w-[560px] items-start gap-2 rounded-[12px] px-3 py-2 text-[12.5px] leading-snug",
    tone === "danger" ? "border border-danger/30 bg-card text-danger" : "bg-ink text-app")}>
    {tone === "danger" && <TriangleAlert size={14} className="mt-px shrink-0" />}
    <span className="min-w-0 flex-1">{children}</span>
    {onClose && <button type="button" onClick={onClose} aria-label={t("workflows.details.close")} className="-mr-1 grid size-5 shrink-0 place-items-center rounded text-ink-tertiary hover:text-ink"><X size={12} /></button>}
  </div>;
}

export function Strip({ tone, children, onClose }: { tone: "warning"; children: ReactNode; onClose?: () => void }) {
  return <div role="status" className="flex items-center gap-2 border-b border-hairline/40 bg-panel px-4 py-2 text-[12.5px] text-ink-secondary">
    <span className={cn("size-[7px] shrink-0 rounded-full", tone === "warning" && "bg-warning")} />
    <span className="flex min-w-0 flex-1 flex-wrap items-center">{children}</span>
    {onClose && <button type="button" className="ui-icon-button" aria-label={t("workflows.details.close")} onClick={onClose}><X size={14} /></button>}
  </div>;
}

export function BotWarning({ hasApproval, onAddApproval }: { hasApproval: boolean; onAddApproval: () => void }) {
  return <div role="note" data-bot-warning className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline/40 bg-warning/[0.07] px-4 py-2 text-[12.5px]">
    <ShieldAlert size={15} className="shrink-0 text-warning" />
    <span className="font-medium text-ink">{t("workflows.botsWarning")}</span>
    {!hasApproval && <>
      <span className="hidden text-ink-secondary sm:inline">{t("workflows.botsWarning.hint")}</span>
      <button type="button" onClick={onAddApproval} className="ml-auto flex h-7 items-center gap-1.5 rounded-full border border-hairline/80 bg-card px-3 text-[12.5px] font-medium text-ink hover:bg-raised">
        {t("workflows.botsWarning.add")}
      </button>
    </>}
  </div>;
}

function AddMenu({ onPick, onClose }: { onPick: (kind: NodeKind) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[role=toolbar]")) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", key); };
  }, [onClose]);
  return <div ref={ref} role="menu" aria-label={t("atelier.canvas.addBlock")}
    className="absolute bottom-full right-0 mb-2 w-[min(300px,calc(100vw-2rem))] rounded-[14px] border border-hairline/80 bg-panel p-1.5">
    {NODE_KINDS.map((kind) => {
      const Icon = KIND_ICON[kind];
      return <button key={kind} type="button" role="menuitem" onClick={() => onPick(kind)}
        className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left hover:bg-control">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-control text-ink-secondary"><Icon size={15} strokeWidth={1.75} /></span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-ink">{t(KIND_LABEL[kind])}</span>
          <span className="block truncate text-[12px] text-ink-tertiary">{t(KIND_HINT[kind])}</span>
        </span>
      </button>;
    })}
  </div>;
}

const headerButton = "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-ink-secondary hover:bg-raised-hover hover:text-ink";

function EditorHeader({ workflow, projects, saveState, running, lastRun, panelOpen, onTogglePanel, onBack, onDelete, onEdit, onRun, onStop }: {
  workflow: Workflow; projects: readonly { id: string; name: string }[]; saveState: SaveStatus; running: WorkflowRun | null; lastRun: WorkflowRun | null;
  panelOpen: boolean; onTogglePanel: () => void; onBack: () => void; onDelete: () => void; onEdit: (change: (w: Workflow) => Workflow) => void; onRun: () => void; onStop: () => void;
}) {
  const [name, setName] = useState(workflow.name);
  const [limitsOpen, setLimitsOpen] = useState(false);
  useEffect(() => setName(workflow.name), [workflow.name]);
  const commitName = () => {
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 120);
    if (clean && clean !== workflow.name) onEdit((w) => ({ ...w, name: clean }));
    else setName(workflow.name);
  };
  const saveLabel = { idle: "", saving: t("projects.saving"), saved: t("projects.saved"), error: t("projects.saveError") }[saveState];
  const projectKnown = !workflow.projectId || projects.some((p) => p.id === workflow.projectId);
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-hairline/40 px-3 py-2 sm:px-4">
    <nav aria-label={t("workflows.breadcrumb")} className="flex min-w-0 flex-1 items-center gap-1 text-[13px]">
      <button type="button" onClick={onBack} aria-label={t("projects.title")} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-ink-secondary hover:bg-raised-hover hover:text-ink">
        <ArrowLeft size={15} /><span className="hidden sm:inline">{t("projects.title")}</span>
      </button>
      <ChevronRight size={13} className="shrink-0 text-ink-tertiary" />
      <input value={name} aria-label={t("workflows.name")} maxLength={120} onChange={(e) => setName(e.target.value)} onBlur={commitName}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setName(workflow.name); (e.target as HTMLInputElement).blur(); } }}
        className="h-8 min-w-[6rem] max-w-[22rem] flex-1 truncate rounded-lg bg-transparent px-1.5 text-[14px] font-semibold text-ink outline-none hover:bg-raised focus:bg-raised" />
      {saveLabel && <span className={cn("hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] sm:flex", saveState === "error" ? "text-danger" : "text-ink-tertiary")}>
        <span className={cn("size-[7px] rounded-full", saveState === "error" ? "bg-danger" : saveState === "saving" ? "bg-warning" : "bg-success")} />{saveLabel}
      </span>}
    </nav>
    <div className="flex items-center gap-1">
      <span className="hidden items-center rounded-full border border-hairline/60 px-1 md:flex">
        <PillSelect value={workflow.projectId ?? ""} label={t("workflows.project")} strong={Boolean(workflow.projectId)}
          onChange={(id) => onEdit((w) => { const { projectId: _old, ...rest } = w; return id ? { ...rest, projectId: id } : rest; })}>
          <option value="">{t("workflows.project.none")}</option>
          {!projectKnown && <option value={workflow.projectId}>{t("workflows.project.gone")}</option>}
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </PillSelect>
      </span>
      <div className="relative">
        <button type="button" className={headerButton} aria-expanded={limitsOpen} onClick={() => setLimitsOpen(!limitsOpen)} title={t("workflows.limits.title")}>
          <Gauge size={15} /><span className="hidden tabular-nums lg:inline">{t("workflows.limits.summary", { steps: workflow.limits.maxSteps, cost: formatUsd(workflow.limits.maxCostUsd, activeLocale()) })}</span>
        </button>
        {limitsOpen && <LimitsPopover workflow={workflow} onEdit={onEdit} onClose={() => setLimitsOpen(false)} />}
      </div>
      <button type="button" className={cn(headerButton, panelOpen && "bg-raised text-ink")} aria-pressed={panelOpen} onClick={onTogglePanel} title={t("workflows.history")}>
        <span className="relative"><History size={15} />{lastRun && <span className={cn("absolute -right-0.5 -top-0.5 size-[7px] rounded-full ring-2 ring-app", RUN_DOT[lastRun.status])} />}</span>
        <span className="hidden lg:inline">{t("workflows.history")}</span>
      </button>
      <button type="button" className={cn(headerButton, "hover:text-danger")} onClick={onDelete} aria-label={t("workflows.delete")} title={t("workflows.delete")}><Trash2 size={15} /></button>
      {running
        ? <button type="button" onClick={onStop} className="ml-1 flex h-8 items-center gap-1.5 rounded-full border border-hairline/80 px-3.5 text-[13px] font-medium text-ink hover:bg-raised">
            <Square size={12} />{t("workflows.stop")}
          </button>
        : <button type="button" onClick={onRun} className="ml-1 flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-medium text-app hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {t("workflows.run")}<Play size={12} />
          </button>}
    </div>
  </div>;
}

function LimitsPopover({ workflow, onEdit, onClose }: { workflow: Workflow; onEdit: (change: (w: Workflow) => Workflow) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [steps, setSteps] = useState(String(workflow.limits.maxSteps));
  const [cost, setCost] = useState(String(workflow.limits.maxCostUsd));
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const id = setTimeout(() => window.addEventListener("pointerdown", away));
    return () => { clearTimeout(id); window.removeEventListener("pointerdown", away); };
  }, [onClose]);
  const save = (nextSteps: string, nextCost: string) => {
    const s = Math.round(Number(nextSteps)), c = Math.round(Number(nextCost.replace(",", ".")) * 100) / 100;
    const limits = {
      maxSteps: Number.isFinite(s) && s >= 1 && s <= 200 ? s : workflow.limits.maxSteps,
      maxCostUsd: Number.isFinite(c) && c >= 0 && c <= 100 ? c : workflow.limits.maxCostUsd,
    };
    if (limits.maxSteps !== workflow.limits.maxSteps || limits.maxCostUsd !== workflow.limits.maxCostUsd) onEdit((w) => ({ ...w, limits }));
  };
  const input = "h-8 w-20 rounded-[9px] border border-hairline/60 bg-inset px-2 text-right text-[13px] tabular-nums text-ink outline-none focus:border-accent-border";
  return <div ref={ref} className="absolute right-0 top-full z-40 mt-2 w-[280px] rounded-[14px] border border-hairline/80 bg-panel p-3">
    <div className="text-[13px] font-semibold text-ink">{t("workflows.limits.title")}</div>
    <p className="mt-0.5 text-[12px] leading-snug text-ink-tertiary">{t("workflows.limits.text")}</p>
    <label className="mt-3 flex items-center justify-between gap-3 text-[13px] text-ink-secondary">
      {t("workflows.limits.steps")}
      <input type="number" min={1} max={200} value={steps} className={input} onChange={(e) => setSteps(e.target.value)} onBlur={() => save(steps, cost)} />
    </label>
    <label className="mt-2 flex items-center justify-between gap-3 text-[13px] text-ink-secondary">
      {t("workflows.limits.cost")}
      <input type="number" min={0} max={100} step={0.1} value={cost} className={input} onChange={(e) => setCost(e.target.value)} onBlur={() => save(steps, cost)} />
    </label>
    {(workflow.limits.maxSteps !== DEFAULT_LIMITS.maxSteps || workflow.limits.maxCostUsd !== DEFAULT_LIMITS.maxCostUsd) &&
      <button type="button" className="mt-3 text-[12px] text-ink-tertiary underline-offset-2 hover:text-ink hover:underline"
        onClick={() => { setSteps(String(DEFAULT_LIMITS.maxSteps)); setCost(String(DEFAULT_LIMITS.maxCostUsd)); onEdit((w) => ({ ...w, limits: { ...DEFAULT_LIMITS } })); }}>
        {t("workflows.limits.reset")}
      </button>}
  </div>;
}
