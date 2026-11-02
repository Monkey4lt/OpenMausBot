import {
  ArrowLeft, BookOpen, ChevronRight, Database, File, FlaskConical, Folder, FolderInput, Globe, Image as ImageIcon, Loader2, MessageSquare, Monitor,
  Pencil, Plug, Rocket, Server, SlidersHorizontal, Sparkles, Terminal, Timer, X, Zap, type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import {
  FAMILY_COLORS, FAMILY_ORDER, PIECE_COLORS, edgeWidth, evidenceWords, flowLayout, layoutLevel, levelOf, mergeTwoWay, plainModuleLabel,
  withFamilyName, withModuleFamily,
  type Architecture, type ArchitectureWithPieces, type ArchOverrides, type Family, type FlowBox, type FlowColumn, type FlowEdge, type LevelNode, type Piece, type PieceKind, type PieceLink,
} from "@/lib/projects-architecture-view";
import { facingAnchors, fitRects, type View } from "@/lib/canvas/geometry";
import type { Tool } from "@/lib/canvas/gestures";
import { api } from "@/state/api";
import type { LocaleKey } from "@/locales";
import { Canvas } from "../canvas/Canvas";
import { EdgeLayer, type CanvasEdge } from "../canvas/EdgeLayer";
import { NodeFrame } from "../canvas/NodeFrame";
import { Toolbar } from "../canvas/Toolbar";

type Focus = { family?: Family; module?: string };
type SavedState = { overrides?: Record<string, ArchOverrides> };

const NODE = { perRow: 4, w: 240, h: 96, gapX: 96, gapY: 72, x0: 40, y0: 48 };

const FAMILY_ICONS: Readonly<Record<Family, LucideIcon>> = {
  ui: Monitor, server: Server, data: Database, tests: FlaskConical, docs: BookOpen,
  config: SlidersHorizontal, scripts: Terminal, assets: ImageIcon, i18n: Globe, other: Folder,
};

export const PIECE_ICONS: Readonly<Record<PieceKind, LucideIcon>> = {
  ui: Monitor, api: Server, database: Database, cache: Zap, jobs: Timer, external: Plug, chatbot: MessageSquare, tests: FlaskConical, deploy: Rocket,
};

const BRIEF_OPEN_KEY = "projects.map.briefOpen";

function readBriefOpen(): boolean {
  try {
    return window.localStorage.getItem(BRIEF_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeBriefOpen(open: boolean) {
  try {
    window.localStorage.setItem(BRIEF_OPEN_KEY, open ? "1" : "0");
  } catch {
    // The choice is only remembered where the browser allows it.
  }
}

export function familyLabel(arch: Architecture, family: Family): string {
  const name = arch.families.find((f) => f.id === family)?.name;
  return name && name !== family ? name : t(`projects.map.family.${family}` as LocaleKey);
}

const locale = (): "fr" | "en" => (activeLocale().startsWith("fr") ? "fr" : "en");

type Why = { box: string } | { edge: string };
type Mode = "simple" | "detail";

export function ArchitectureView<S extends SavedState>({ project, onBack, state, onSave, initial, initialFocus = {}, initialFile = null, initialMode, initialWhy = null, onAskCartographe, onPieces }: {
  project: { id: string; name: string };
  onBack: () => void;
  /** The page's current saved layout; a move or rename is applied to it and handed to onSave, which writes it at once. */
  state?: S | null;
  onSave?: (next: S) => Promise<void>;
  initial?: Architecture | ArchitectureWithPieces;
  initialFocus?: Focus;
  initialFile?: string | null;
  /** The view opens simple, unless a family is focused; nothing remembers the detailed view. */
  initialMode?: Mode;
  initialWhy?: Why | null;
  /** Opens the Cartographe with this project in mind; without it the invitations to ask it are not shown. */
  onAskCartographe?: () => void;
  /** The kinds of pieces found once the project is read, for its card on the overview. */
  onPieces?: (kinds: PieceKind[]) => void;
}) {
  const [arch, setArch] = useState<MapArch | null>(initial ?? null);
  const own = state?.overrides && Object.hasOwn(state.overrides, project.id) ? state.overrides[project.id] : undefined;
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode ?? (initialFocus.family ? "detail" : "simple"));
  const [why, setWhy] = useState<Why | null>(initialWhy);
  const [focus, setFocus] = useState<Focus>(initialFocus);
  const [file, setFile] = useState<string | null>(initialFile);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Family | null>(null);
  const piecesSeen = useRef(onPieces);
  piecesSeen.current = onPieces;

  const load = useCallback(async () => {
    setError(null);
    try {
      const read = await api<ArchitectureWithPieces>(`/api/projects/architecture?id=${encodeURIComponent(project.id)}`, { timeoutMs: 180_000 });
      setArch(read);
      piecesSeen.current?.(read.pieces.map((p) => p.kind));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project.id]);
  useEffect(() => { if (!initial) void load(); }, [initial, load]);

  const saveOverrides = async (change: (current: S) => S) => {
    if (!state || !onSave) return;
    await onSave(change(state));
    await load();
  };
  const moveModule = (moduleId: string, family: Family) => {
    setMenu(null);
    void saveOverrides((s) => withModuleFamily(s, project.id, moduleId, family)).catch((e: Error) => setError(e.message));
  };
  const renameFamily = (family: Family, name: string) => {
    setRenaming(null);
    void saveOverrides((s) => withFamilyName(s, project.id, family, name)).catch((e: Error) => setError(e.message));
  };
  const toSimple = () => { setMode("simple"); setFocus({}); setFile(null); };
  const toDetail = (to: Focus = {}) => { setMode("detail"); setFocus(to); setFile(null); setWhy(null); };

  const detail = mode === "detail";
  const crumbs: { label: string; onClick?: () => void }[] = [{ label: project.name, onClick: detail ? toSimple : undefined }];
  if (detail) crumbs.push({ label: t("projects.flow.detail"), onClick: focus.family ? () => { setFocus({}); setFile(null); } : undefined });
  if (detail && arch && focus.family) crumbs.push({ label: familyLabel(arch, focus.family), onClick: focus.module ? () => { setFocus({ family: focus.family }); setFile(null); } : undefined });
  if (detail && focus.module) crumbs.push({ label: plainModule(focus.module) });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline/40 px-4 py-2">
        <button type="button" onClick={onBack} aria-label={t("projects.map.back")} title={t("projects.map.back")}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-ink-secondary hover:bg-raised-hover hover:text-ink">
          <ArrowLeft size={15} /><span className="hidden sm:inline">{t("projects.map.back")}</span>
        </button>
        <nav className="flex min-w-0 items-center gap-1 text-[13px]">
          {crumbs.map((c, i) => (
            <span key={i} className={cn("flex min-w-0 items-center gap-1", i > 0 && i < crumbs.length - 1 && "hidden sm:flex")}>
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-ink-tertiary" />}
              {c.onClick
                ? <button type="button" onClick={c.onClick} className="truncate rounded-md px-1.5 py-0.5 text-ink-secondary hover:bg-raised hover:text-ink">{c.label}</button>
                : <span className={cn("truncate px-1.5 py-0.5 text-ink", i === 0 ? "text-[14px] font-semibold" : "font-medium")}>{c.label}</span>}
            </span>
          ))}
        </nav>
        {arch && detail && focus.family && !focus.module && (
          <button type="button" onClick={() => setRenaming(focus.family!)} title={t("projects.map.rename")} aria-label={t("projects.map.rename")}
            className="ml-1 grid size-7 shrink-0 place-items-center rounded-lg text-ink-tertiary hover:bg-raised-hover hover:text-ink"><Pencil size={14} /></button>
        )}
        <button type="button" data-mode-toggle onClick={() => (detail ? toSimple() : toDetail())}
          className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] text-ink-secondary hover:bg-raised-hover hover:text-ink">
          {detail ? <><ArrowLeft size={14} />{t("projects.flow.simple")}</> : t("projects.flow.detail")}
        </button>
      </div>

      {arch?.truncated && (
        <p data-truncated className="border-b border-hairline/40 px-4 py-1.5 text-[12.5px] text-ink-tertiary">{t("projects.map.truncated")}</p>
      )}
      {error && (
        <div className="flex items-center gap-3 border-b border-danger/30 px-4 py-2 text-[13px] text-danger">
          {t("projects.map.error", { message: error })}
          <button type="button" onClick={() => void load()} className="rounded-md px-2 py-1 text-ink-secondary hover:bg-raised hover:text-ink">{t("projects.map.retry")}</button>
        </div>
      )}

      {!arch && !error && (
        <div className="flex flex-1 items-center justify-center gap-2 px-6 text-center text-[13px] text-ink-secondary">
          <Loader2 size={16} className="shrink-0 animate-spin" />{t("projects.map.loading")}
        </div>
      )}

      {arch && !focus.family && <ProjectSummary summary={own?.summary} onAsk={onAskCartographe} />}

      {arch && !detail && (
        <SimpleView arch={arch} texts={own?.pieceText} why={why} onWhy={setWhy} onAsk={onAskCartographe} onDetail={toDetail} />
      )}

      {arch && detail && (
        <div className="flex min-h-0 flex-1">
          <MapCanvas arch={arch} focus={focus} menu={menu} setMenu={setMenu} onMove={moveModule} texts={own}
            onOpen={(id) => { setFile(null); setFocus(focus.family ? { family: focus.family, module: id } : { family: id as Family }); }} />
          {focus.module && <FilePanel arch={arch} module={focus.module} file={file} onPick={setFile} />}
        </div>
      )}

      {renaming && arch && <RenameDialog current={familyLabel(arch, renaming)} onDone={(name) => (name === null ? setRenaming(null) : renameFamily(renaming, name))} />}
    </div>
  );
}

function ProjectSummary({ summary, onAsk }: { summary: string | undefined; onAsk?: () => void }) {
  const [open, setOpen] = useState(readBriefOpen);
  if (!summary && !onAsk) return null;
  return (
    <details open={open} onToggle={(e) => { const next = e.currentTarget.open; setOpen(next); writeBriefOpen(next); }} data-brief
      className="group/brief shrink-0 border-b border-hairline/40">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium text-ink-secondary hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="shrink-0 text-ink-tertiary transition-transform group-open/brief:rotate-90" />
        {t("projects.map.brief")}
      </summary>
      <div className="max-h-[30dvh] overflow-y-auto px-4 pb-3.5 pl-[38px]">
        {summary ? (
          <p className="max-w-[72ch] whitespace-pre-line text-[13.5px] leading-relaxed text-ink">{summary}</p>
        ) : onAsk && (
          <AskButton onClick={onAsk} label={t("projects.map.briefAsk")} />
        )}
      </div>
    </details>
  );
}

function AskButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full bg-accent/12 px-3 text-[12.5px] font-medium text-accent-text hover:bg-accent/20">
      <Sparkles size={14} className="shrink-0" />{label}
    </button>
  );
}

const FEW_FILES = 3;

/** « Comment ça marche »: the project's big pieces in four columns, or a plain fallback for a tiny project or one with none recognised. */
function SimpleView({ arch, texts, why, onWhy, onAsk, onDetail }: {
  arch: MapArch; texts: Record<string, string> | undefined; why: Why | null; onWhy: (why: Why | null) => void; onAsk?: () => void; onDetail: (focus?: Focus) => void;
}) {
  if (arch.files.length <= FEW_FILES) {
    return (
      <div data-few-files className="flex flex-1 flex-col gap-2 px-6 py-6">
        <p className="text-[13.5px] text-ink">{t(arch.files.length === 1 ? "projects.flow.fewFiles.one" : "projects.flow.fewFiles", { count: arch.files.length })}</p>
        <ul className="flex flex-col gap-1">
          {arch.files.map((f) => <li key={f.path} className="flex items-center gap-2 text-[13px] text-ink-secondary"><File size={14} className="shrink-0 text-ink-tertiary" /><span className="font-mono text-[12.5px]">{f.path}</span></li>)}
        </ul>
        {onAsk && <div className="mt-2"><AskButton onClick={onAsk} label={t("projects.flow.explain")} /></div>}
      </div>
    );
  }
  const flow = flowLayout(arch.pieces ?? [], arch.pieceLinks ?? [], texts, locale());
  if (!flow.boxes.length && !flow.build.length) {
    return (
      <div data-no-pieces className="flex flex-1 flex-col items-start gap-3 px-6 py-6">
        <p className="max-w-[60ch] text-[13.5px] text-ink">{t("projects.flow.none")}</p>
        {onAsk && <AskButton onClick={onAsk} label={t("projects.flow.explain")} />}
        <button type="button" onClick={() => onDetail()} className="text-[13px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline">{t("projects.flow.detail")}</button>
      </div>
    );
  }
  return <FlowCanvas arch={arch} flow={flow} why={why} onWhy={onWhy} onDetail={onDetail} />;
}

const COLUMN_TITLES: Readonly<Record<FlowColumn["id"], LocaleKey>> = {
  see: "projects.flow.col.see", work: "projects.flow.col.work", store: "projects.flow.col.store", outside: "projects.flow.col.outside",
};

const BUILD_KIND_SET: ReadonlySet<PieceKind> = new Set(["tests", "deploy"]);

function FlowCanvas({ arch, flow, why, onWhy, onDetail }: {
  arch: MapArch; flow: ReturnType<typeof flowLayout>; why: Why | null; onWhy: (why: Why | null) => void; onDetail: (focus?: Focus) => void;
}) {
  const [tool, setTool] = useState<Tool>("select");
  const [view, setView] = useState<View | undefined>(undefined);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const shown = [...flow.boxes, ...flow.build];
  const frame = [...shown.map((b) => b.rect), ...flow.columns.map((c) => ({ x: c.x, y: c.y, w: c.w, h: 24 }))];
  const fitted = useRef(false);
  useEffect(() => {
    if (!box || fitted.current) return;
    const viewport = { w: box.clientWidth, h: box.clientHeight };
    if (!(viewport.w > 0)) return;
    fitted.current = true;
    setView(fitRects(frame, viewport));
  });
  const chosenBox = why && "box" in why ? shown.find((b) => b.key === why.box) : undefined;
  const chosenEdge = why && "edge" in why ? flow.edges.find((e) => e.id === why.edge) : undefined;
  const familyOfModule = new Map(arch.modules.map((m) => [m.id, m.family]));
  const toFiles = (modules: string[]) => {
    const family = modules.map((m) => familyOfModule.get(m)).find(Boolean);
    onDetail(family ? { family } : {});
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={setBox} className="relative flex min-h-[260px] flex-1">
        <Canvas readOnly view={view} onViewChange={setView} tool={tool} rects={frame} label={t("projects.map.canvas")} onBackgroundClick={() => onWhy(null)}
          toolbar={<Toolbar tool={tool} onTool={setTool} tools={["select", "hand"]} />}
          underlay={<EdgeLayer edges={flow.edges.map((e) => (chosenEdge?.id === e.id ? { ...e, tone: "accent" as const, width: 2 } : e))} onEdgeClick={(id) => onWhy({ edge: id })} />}>
          {flow.columns.map((c) => (
            <span key={c.id} data-flow-column={c.id} className="pointer-events-none absolute whitespace-nowrap text-[12.5px] text-ink-tertiary" style={{ left: c.x + 2, top: c.y }}>{t(COLUMN_TITLES[c.id])}</span>
          ))}
          {flow.buildRow && (
            <span className="pointer-events-none absolute whitespace-nowrap text-[12.5px] text-ink-tertiary" style={{ left: flow.buildRow.x + 2, top: flow.buildRow.y }}>{t("projects.flow.col.build")}</span>
          )}
          {shown.map((b) => {
            const Icon = PIECE_ICONS[b.kind];
            const color = PIECE_COLORS[b.kind];
            const quiet = BUILD_KIND_SET.has(b.kind);
            const chosen = chosenBox?.key === b.key;
            return (
              <NodeFrame key={b.key} id={b.key} rect={b.rect} selected={chosen} locked onMove={() => {}} onSelect={() => {}} cardClassName={cn("block overflow-visible p-0", quiet && "bg-transparent")}>
                <button type="button" data-flow-box={b.key} aria-pressed={chosen} onClick={() => onWhy(chosen ? null : { box: b.key })}
                  className={cn("flex h-full w-full flex-col justify-center rounded-[13px] px-3 text-left hover:bg-raised-hover", quiet ? "gap-0 py-1" : "gap-1 py-2.5")}>
                  <span className="flex w-full items-center gap-2.5">
                    <span className={cn("grid shrink-0 place-items-center rounded-[8px]", quiet ? "size-6" : "size-7")} style={{ background: `${color}22`, color }}><Icon size={quiet ? 13 : 15} /></span>
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className={cn("truncate", quiet ? "text-[13px] font-medium text-ink-secondary" : "text-[14px] font-semibold text-ink")}>{b.label}</span>
                      {b.subtitle && <span className="truncate text-[11.5px] text-ink-tertiary">{b.subtitle}</span>}
                    </span>
                  </span>
                  {!quiet && <span className={cn("line-clamp-2 text-[12.5px] leading-[17px]", b.described ? "text-ink-secondary" : "text-ink-tertiary")} title={b.text}>{b.text}</span>}
                </button>
              </NodeFrame>
            );
          })}
        </Canvas>
      </div>
      <div className="shrink-0 border-t border-hairline/40 bg-panel px-4 py-2.5">
        {chosenBox ? <BoxWhy box={chosenBox} onClose={() => onWhy(null)} onFiles={() => toFiles(chosenBox.pieces.flatMap((p) => p.modules))} />
          : chosenEdge ? <EdgeWhy edge={chosenEdge} from={shown.find((b) => b.key === chosenEdge.fromKey)!} to={shown.find((b) => b.key === chosenEdge.toKey)!} onClose={() => onWhy(null)} />
          : <p className="text-[12.5px] text-ink-tertiary">{t("projects.flow.hint")}</p>}
      </div>
    </div>
  );
}

function WhyCard({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div data-why className="relative max-w-[760px] rounded-[14px] border border-hairline bg-card px-3.5 py-2.5 text-[12.5px] text-ink-secondary">
      <button type="button" onClick={onClose} aria-label={t("projects.close")} className="ui-icon-button absolute right-1.5 top-1.5"><X size={14} /></button>
      <p className="mb-1.5 pr-8 font-medium text-ink">{title}</p>
      {children}
    </div>
  );
}

function BoxWhy({ box, onClose, onFiles }: { box: FlowBox; onClose: () => void; onFiles: () => void }) {
  const evidence = box.pieces.flatMap((p) => p.evidence).filter((e, i, list) => list.findIndex((o) => o.path === e.path) === i).slice(0, 6);
  const modules = [...new Set(box.pieces.flatMap((p) => p.modules).map(plainModule))];
  return (
    <WhyCard title={t("projects.map.pieceEvidence", { name: box.label })} onClose={onClose}>
      <ul className="flex flex-col gap-1">
        {evidence.map((e) => (
          <li key={e.path} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-ink">{evidenceWords(e, locale())}</span>
            <span className="break-all font-mono text-[11.5px] text-ink-tertiary">{e.path}</span>
          </li>
        ))}
      </ul>
      {box.techs.length > 0 && <p className="mt-1.5 text-ink-tertiary">{t("projects.flow.techs", { techs: box.techs.join(", ") })}</p>}
      {modules.length > 0 && <p className="mt-0.5 text-ink-tertiary">{t("projects.map.pieceModules", { modules: modules.join(", ") })}</p>}
      <button type="button" onClick={onFiles} className="mt-2 text-[12.5px] text-accent-text hover:underline">{t("projects.flow.seeFiles")}</button>
    </WhyCard>
  );
}

function EdgeWhy({ edge, from, to, onClose }: { edge: FlowEdge; from: FlowBox; to: FlowBox; onClose: () => void }) {
  return (
    <WhyCard title={t("projects.map.pieceEvidence", { name: `${from.label} ${edge.label} ${to.label}` })} onClose={onClose}>
      <p className="text-ink">{t(edge.link.count === 1 ? "projects.flow.found.one" : "projects.flow.found", { count: edge.link.count })}</p>
      {edge.link.examples.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {edge.link.examples.slice(0, 5).map((x) => <li key={`${x.from}>${x.to}`} className="break-all font-mono text-[11.5px] text-ink-tertiary">{x.from} → {x.to}</li>)}
        </ul>
      )}
    </WhyCard>
  );
}

const plainModule = (id: string) => plainModuleLabel(id, t("projects.map.rootFolder"));

/** Families that only describe a project, never where a piece's code runs. */
const NOT_CODE: ReadonlySet<Family> = new Set(["config", "docs", "assets", "i18n", "scripts"]);

/** The two families a piece link is drawn between: the code families holding most of each piece's modules; null when they are the same. */
function pieceLinkEnds(arch: Architecture & { pieces?: Piece[] }, link: PieceLink): [Family, Family] | null {
  const familyOfModule = new Map(arch.modules.map((m) => [m.id, m.family]));
  const mainFamily = (kind: Piece["kind"]): Family | undefined => {
    const counts = new Map<Family, number>();
    for (const p of arch.pieces ?? []) {
      if (p.kind !== kind) continue;
      for (const m of p.modules) {
        const f = familyOfModule.get(m);
        if (f && !NOT_CODE.has(f)) counts.set(f, (counts.get(f) ?? 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1] || FAMILY_ORDER.indexOf(a[0]) - FAMILY_ORDER.indexOf(b[0]))[0]?.[0];
  };
  const from = mainFamily(link.from);
  const to = mainFamily(link.to);
  return from && to && from !== to ? [from, to] : null;
}

type MapArch = Architecture & Partial<Pick<ArchitectureWithPieces, "pieces" | "pieceLinks">>;

/** The blocks of one level of the map and the links between them, in world coordinates. */
export function mapLayout(arch: MapArch, focus: Focus, texts: ArchOverrides | undefined) {
  const level = levelOf(arch, focus.module ? { family: focus.family } : focus);
  const atTop = !focus.family;
  const describe = (id: string): string | undefined => {
    if (atTop) return texts?.familyText?.[id as Family];
    return texts?.moduleText && Object.hasOwn(texts.moduleText, id) ? texts.moduleText[id] : undefined;
  };
  const merged = mergeTwoWay(level.edges);
  const pieceArrows = atTop ? (arch.pieceLinks ?? []).flatMap((link) => {
    const ends = pieceLinkEnds(arch, link);
    return ends ? [{ link, from: ends[0], to: ends[1] }] : [];
  }) : [];
  const placed = { ...level, edges: [...level.edges, ...pieceArrows.map((p) => ({ from: p.from, to: p.to, weight: 1 }))] };
  const rects = layoutLevel(placed, level.nodes.some((n) => describe(n.id)) ? NODE : { ...NODE, h: 52 });
  const pieceOn = (from: string, to: string) => pieceArrows.find((p) => (p.from === from && p.to === to) || (p.from === to && p.to === from));
  const edges: CanvasEdge[] = [];
  for (const arrow of pieceArrows) {
    const { link, from, to } = arrow;
    if (merged.some((e) => pieceOn(e.from, e.to) === arrow) || !rects[from] || !rects[to]) continue;
    const [a, b] = facingAnchors(rects[from]!, rects[to]!);
    edges.push({ id: `piece:${link.from}->${link.to}`, from: a, to: b, tone: "accent", arrow: "end" });
  }
  for (const e of merged) {
    if (!rects[e.from] || !rects[e.to]) continue;
    const piece = pieceOn(e.from, e.to);
    const both = e.twoWay || (piece !== undefined && piece.from !== e.from);
    const [a, b] = facingAnchors(rects[e.from]!, rects[e.to]!);
    edges.push({
      id: both ? `${e.from}<->${e.to}` : `${e.from}->${e.to}`, from: a, to: b, label: String(e.weight),
      width: edgeWidth(e.weight), arrow: both ? "both" : "end", ...(piece ? { tone: "accent" as const } : { dashed: false }),
    });
  }
  return { level, rects, edges, describe };
}

function MapCanvas({ arch, focus, menu, setMenu, onMove, onOpen, texts }: {
  arch: MapArch; focus: Focus; menu: string | null; setMenu: (id: string | null) => void;
  onMove: (moduleId: string, family: Family) => void; onOpen: (id: string) => void; texts?: ArchOverrides;
}) {
  const { level, rects, edges, describe } = mapLayout(arch, focus, texts);
  const atTop = !focus.family;
  const all = Object.values(rects);
  const showExternal = atTop && arch.external.length > 0;
  const colorOf = (node: LevelNode) => FAMILY_COLORS[focus.family ?? (node.id as Family)] ?? FAMILY_COLORS.other;
  const iconOf = (node: LevelNode): LucideIcon => (atTop ? FAMILY_ICONS[node.id as Family] ?? Folder : focus.module ? File : Folder);
  const moving = Boolean(focus.family && !focus.module);
  const [tool, setTool] = useState<Tool>("select");
  const [view, setView] = useState<View | undefined>(undefined);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const levelKey = `${focus.family ?? ""}/${focus.module ?? ""}/${level.nodes.length}`;
  const fitted = useRef("");
  useEffect(() => {
    if (!box || fitted.current === levelKey) return;
    const viewport = { w: box.clientWidth, h: box.clientHeight };
    if (!(viewport.w > 0)) return;
    fitted.current = levelKey;
    setView(fitRects(all, viewport));
  });
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={setBox} className="relative flex min-h-[300px] flex-1">
        <Canvas readOnly view={view} onViewChange={setView} tool={tool} rects={all} minimap label={t("projects.map.canvas")}
          toolbar={<Toolbar tool={tool} onTool={setTool} tools={["select", "hand"]} />}
          underlay={<EdgeLayer edges={edges} />}>
          {level.nodes.map((node) => {
            const r = rects[node.id]!;
            const color = colorOf(node);
            const Icon = iconOf(node);
            const label = atTop ? familyLabel(arch, node.id as Family) : focus.module ? node.label : plainModule(node.id);
            const text = describe(node.id);
            return (
              <NodeFrame key={node.id} id={node.id} rect={r} selected={false} locked onMove={() => {}} onSelect={() => {}} cardClassName="block overflow-visible p-0">
                <div data-node={node.id} className="group/node relative h-full">
                  <button type="button" onClick={() => onOpen(node.id)} title={atTop ? label : node.id}
                    className={cn("flex h-full w-full flex-col gap-1.5 rounded-[13px] px-3 py-2.5 text-left hover:bg-raised-hover", !text && "justify-center")}>
                    <span className="flex w-full items-center gap-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded-[8px]" style={{ background: `${color}22`, color }}><Icon size={15} /></span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{label}</span>
                      <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-ink-tertiary">{t(node.files === 1 ? "projects.map.files.one" : "projects.map.files", { count: node.files })}</span>
                    </span>
                    {text && <span className="line-clamp-2 text-[12.5px] leading-[18px] text-ink-secondary" title={text}>{text}</span>}
                  </button>
                  {moving && (
                    <div data-node-toolbar className={cn("absolute bottom-full left-0 z-10 pb-1.5 opacity-0 transition-opacity group-hover/node:opacity-100 group-focus-within/node:opacity-100 touch:opacity-100", menu === node.id && "opacity-100")}>
                      <div className="relative flex items-center rounded-full border border-hairline bg-card p-0.5">
                        <button type="button" onClick={() => setMenu(menu === node.id ? null : node.id)} aria-expanded={menu === node.id}
                          className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-ink-secondary hover:bg-raised-hover hover:text-ink">
                          <FolderInput size={14} />{t("projects.map.moveTo")}
                        </button>
                        {menu === node.id && (
                          <div className="animate-pop-in absolute left-0 top-9 z-20 min-w-[200px] rounded-[14px] border border-hairline bg-card p-1.5 shadow-xl shadow-black/40">
                            {FAMILY_ORDER.filter((f) => f !== focus.family).map((f) => {
                              const FamilyIcon = FAMILY_ICONS[f];
                              return (
                                <button key={f} type="button" onClick={() => onMove(node.id, f)}
                                  className="flex h-8 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13px] text-ink hover:bg-menu-hover">
                                  <FamilyIcon size={14} className="shrink-0" style={{ color: FAMILY_COLORS[f] }} />{familyLabel(arch, f)}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </NodeFrame>
            );
          })}
        </Canvas>
        {!level.nodes.length && <p className="pointer-events-none absolute left-0 top-0 p-8 text-[13px] text-ink-tertiary">{t("projects.map.empty")}</p>}
      </div>
      {showExternal && (
        <section data-external className="shrink-0 border-t border-hairline/40 bg-panel px-4 py-3">
          <h3 className="mb-2 text-[12.5px] text-ink-tertiary">{t("projects.map.external")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {arch.external.map((e) => (
              <span key={e.name} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-hairline bg-card px-2.5 text-[12px] text-ink-secondary">
                {e.name}<span className="tabular-nums text-ink-tertiary">{e.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FilePanel({ arch, module, file, onPick }: { arch: Architecture; module: string; file: string | null; onPick: (path: string) => void }) {
  const files = arch.files.filter((f) => f.module === module);
  const selected = arch.files.find((f) => f.path === file);
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      <h3 className="px-4 pb-2 pt-4 text-[13px] font-medium text-ink-secondary">{t("projects.map.fileList", { name: plainModule(module) })}</h3>
      <ul className="max-h-[45%] overflow-y-auto px-2 font-mono text-[12.5px]">
        {files.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => onPick(f.path)} title={f.path}
              className={cn("flex h-[26px] w-full items-center gap-[7px] truncate rounded-[7px] px-1.5 text-left", f.path === file ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised-hover")}>
              <File size={14} className="shrink-0 text-ink-tertiary" />{f.path.slice(f.path.lastIndexOf("/") + 1)}
            </button>
          </li>
        ))}
      </ul>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-hairline/40 px-4 py-3">
        {selected ? (
          <>
            <p className="mb-3 break-all font-mono text-[12px] text-ink">{selected.path}</p>
            <PathList title={t("projects.map.uses")} paths={selected.uses} />
            <PathList title={t("projects.map.usedBy")} paths={selected.usedBy} />
          </>
        ) : <p className="text-[13px] text-ink-tertiary">{t("projects.map.pickFile")}</p>}
      </div>
    </aside>
  );
}

function PathList({ title, paths }: { title: string; paths: string[] }) {
  return (
    <div className="mb-4">
      <h4 className="mb-1 text-[12px] font-medium text-ink-secondary">{title}</h4>
      {paths.length
        ? <ul className="flex flex-col gap-0.5 font-mono text-[12px] text-ink-secondary">{paths.map((p) => <li key={p} className="break-all">{p}</li>)}</ul>
        : <p className="text-[12px] italic text-ink-tertiary">{t("projects.map.none")}</p>}
    </div>
  );
}

function RenameDialog({ current, onDone }: { current: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <form className="animate-pop-in w-full max-w-[400px] rounded-2xl border border-hairline/50 bg-card p-5 shadow-2xl shadow-black/50" onSubmit={(e) => { e.preventDefault(); onDone(value); }}>
        <h2 className="text-[16px] font-semibold text-ink">{t("projects.map.renameTitle", { name: current })}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{t("projects.map.renameText")}</p>
        <input autoFocus value={value} maxLength={60} onChange={(e) => setValue(e.target.value)}
          className="mt-4 h-10 w-full rounded-xl border border-hairline/60 bg-inset px-3 text-[14px] text-ink outline-none focus:border-accent-border" />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => onDone(null)} className="rounded-lg px-3.5 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">{t("projects.cancel")}</button>
          <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110">{t("projects.map.rename")}</button>
        </div>
      </form>
    </div>
  );
}
