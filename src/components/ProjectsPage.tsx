// The Atelier: each project folder (local, on an SSH host or on GitHub) is a block with
// its full file tree, on the shared canvas. Blocks are grouped by "pôle" (group) and joined by links.
// Shown in place of the chat, like Team map. Layout is saved on the server; the view is kept per device.
import {
  Bot as BotIcon, ChevronDown, ChevronRight, CircleHelp, File, Folder, FolderTree, Github, HardDrive, LayoutGrid, Link2, Loader2,
  Network, Pencil, Plus, RefreshCw, Search, Server, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { leadComposerDraft } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { listenLiveFrames } from "@/lib/live-events";
import { summaryPreview, type ArchOverrides } from "@/lib/projects-architecture-view";
import { centerOn, clampScale, DEFAULT_VIEW } from "@/lib/canvas/geometry";
import type { Tool } from "@/lib/canvas/gestures";
import { annotationBounds, annotationText, type Annotation } from "@/lib/canvas/model";
import { BLOCK_W, arrangeByGroup, blockRect, groupZone, linkEdges, openingView, placeBlock } from "@/lib/projects-map";
import { createMapSync } from "@/lib/projects-map-sync";
import { panelDraft, panelLayout, readPanelOpen, writePanelOpen } from "@/lib/projects-panel";
import { useShowThreads } from "@/lib/thread-preferences";
import { api } from "@/state/api";
import { GROUP_PALETTE as PALETTE } from "../../shared/project-groups";
import { openBot, useStore } from "@/state/store";

import { AnnotationLayer } from "./canvas/AnnotationLayer";
import { Canvas } from "./canvas/Canvas";
import { CanvasSearch, type CanvasSearchItem } from "./canvas/CanvasSearch";
import { EdgeLayer } from "./canvas/EdgeLayer";
import { NodeFrame } from "./canvas/NodeFrame";
import { Toolbar } from "./canvas/Toolbar";
import { readStoredView, useCanvasView } from "./canvas/useCanvasView";
import { ArchitectureView } from "./projects/ArchitectureView";
import { BotAvatar, type BotAvatarProps } from "./Avatar";
import { ChatView } from "./ChatView";

// ---------- types (mirror server/projects.ts) ----------
interface ProjectNode { n: string; t: "d" | "f" | "more"; c?: ProjectNode[] }
interface Project { id: string; name: string; sourceId: string; files: number; dirs: number; truncated: boolean; tree: ProjectNode[] }
interface Source { id: string; label: string; kind: "local" | "ssh" | "github"; host?: string; path: string }
interface Group { id: string; name: string; color: string }
interface Link { a: string; b: string; label: string }
interface MapState {
  sources: Source[];
  pos: Record<string, { x: number; y: number }>;
  groups: Group[];
  member: Record<string, string>;
  links: Link[];
  collapsed: Record<string, 1>;
  zoom: number;
  help: boolean;
  overrides?: Record<string, ArchOverrides>;
  annotations?: Annotation[];
  rev?: number;
}
interface ProjectsResponse { state: MapState; projects: Project[]; errors: { sourceId: string; message: string }[]; cartographeBotId?: string | null }

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const contains = (nodes: ProjectNode[], q: string): boolean => nodes.some((n) => n.n.toLowerCase().includes(q) || (n.c ? contains(n.c, q) : false));

// ---------- small dialog (name / confirm) ----------
interface AskOptions { title: string; text?: string; value?: string; placeholder?: string; ok: string; danger?: boolean; input?: boolean }
function useAsk() {
  const [ask, setAsk] = useState<(AskOptions & { resolve: (v: string | null) => void }) | null>(null);
  const open = useCallback((o: AskOptions) => new Promise<string | null>((resolve) => setAsk({ input: true, ...o, resolve })), []);
  const node = ask && <AskDialog {...ask} onDone={(v) => { ask.resolve(v); setAsk(null); }} />;
  return [open, node] as const;
}
function AskDialog({ title, text, value = "", placeholder, ok, danger, input, onDone }: AskOptions & { onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);
  const submit = () => onDone(input ? v.trim() : "ok");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <form className="animate-pop-in w-full max-w-[400px] rounded-2xl border border-hairline/50 bg-card p-5 shadow-2xl shadow-black/50" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
        {text && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{text}</p>}
        {input && (
          <input autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
            className="mt-4 h-10 w-full rounded-xl border border-hairline/60 bg-inset px-3 text-[14px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent-border" />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => onDone(null)} className="rounded-lg px-3.5 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">{t("projects.cancel")}</button>
          <button type="submit" autoFocus={!input} className={cn("rounded-lg px-4 py-2 text-[13px] font-medium text-white hover:brightness-110", danger ? "bg-danger" : "bg-accent")}>{ok}</button>
        </div>
      </form>
    </div>
  );
}

// ---------- sources dialog ----------
function SourcesDialog({ sources, errors, onSave, onClose }: { sources: Source[]; errors: ProjectsResponse["errors"]; onSave: (s: Source[]) => void; onClose: () => void }) {
  const [list, setList] = useState(sources);
  const [kind, setKind] = useState<Source["kind"]>("ssh");
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [path, setPath] = useState("~/projets");
  const githubTarget = (value: string) => value.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
  const cleanPath = kind === "github" ? githubTarget(path) : path.trim();
  const valid = cleanPath && (kind === "github" ? /^[A-Za-z0-9-]{1,39}(\/(?!\.\.?$)[\w.-]{1,100})?$/.test(cleanPath) : kind === "local" || /^[\w.@-]+$/.test(host.trim()));
  const pick = (k: Source["kind"]) => {
    setKind(k);
    if (k === "github" && path.startsWith("~")) setPath("");
    if (k !== "github" && !path) setPath("~/projets");
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const pending = (): Source => ({
    id: newId("s"),
    label: (label.trim() || (kind === "github" ? cleanPath : kind === "ssh" ? host.trim() : cleanPath)).slice(0, 60),
    kind,
    host: kind === "ssh" ? host.trim() : undefined,
    path: cleanPath,
  });
  const typed = Boolean(kind === "ssh" ? host.trim() : kind === "github" ? cleanPath : path.trim() && path.trim() !== "~/projets");
  const add = () => {
    if (!valid) return;
    setList([...list, pending()]);
    setLabel(""); setHost("");
  };
  const field = "h-9 w-full rounded-lg border border-hairline/60 bg-inset px-3 text-[13px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent-border";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="animate-pop-in flex max-h-[min(640px,calc(100dvh-2rem))] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-hairline/50 bg-panel shadow-2xl shadow-black/50">
        <header className="flex items-start justify-between gap-4 border-b border-hairline/40 px-6 pb-4 pt-5">
          <div>
            <h2 className="text-[18px] font-semibold text-ink">{t("projects.sources.title")}</h2>
            <p className="mt-1 text-[13px] text-ink-secondary">{t("projects.sources.intro")}</p>
          </div>
          <button onClick={onClose} className="ui-icon-button" aria-label={t("projects.close")}><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {list.length === 0 && <p className="text-[13px] text-ink-tertiary">{t("projects.sources.none")}</p>}
          <ul className="flex flex-col gap-2">
            {list.map((s) => {
              const err = errors.find((e) => e.sourceId === s.id);
              return (
                <li key={s.id} className="flex items-center gap-3 rounded-xl border border-hairline/40 bg-card px-3 py-2.5">
                  <SourceIcon kind={s.kind} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{s.label}</div>
                    <div className="truncate font-mono text-[11.5px] text-ink-tertiary">{s.kind === "ssh" ? `${s.host}:${s.path}` : s.kind === "github" ? `github.com/${s.path}` : s.path}</div>
                    {err && <div className="mt-1 truncate text-[12px] text-danger" title={err.message}>{err.message}</div>}
                  </div>
                  <button className="ui-icon-button" aria-label={t("projects.sources.remove")} onClick={() => setList(list.filter((o) => o !== s))}><Trash2 size={15} /></button>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 rounded-xl border border-hairline/40 bg-card p-3">
            <div className="mb-3 flex gap-1 rounded-lg bg-inset p-1">
              {(["ssh", "github", "local"] as const).map((k) => (
                <button key={k} onClick={() => pick(k)} className={cn("flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-[13px]", kind === k ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink")}>
                  <SourceIcon kind={k} size={14} />{t(k === "ssh" ? "projects.sources.ssh" : k === "github" ? "projects.sources.github" : "projects.sources.local")}
                </button>
              ))}
            </div>
            {kind === "github" && (
              <GithubAccount onUseAccount={(login) => onSave(list.some((o) => o.kind === "github" && o.path.toLowerCase() === login.toLowerCase())
                ? list : [...list, { id: newId("s"), label: `GitHub ${login}`.slice(0, 60), kind: "github", path: login }])} />
            )}
            {kind === "github" && <p className="mb-2 text-[12px] text-ink-tertiary">{t("projects.github.orOne")}</p>}
            <div className="grid gap-2">
              <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("projects.sources.labelPlaceholder")} />
              {kind === "ssh" && <input className={cn(field, "font-mono")} value={host} onChange={(e) => setHost(e.target.value)} placeholder={t("projects.sources.hostPlaceholder")} />}
              <input className={cn(field, "font-mono")} value={path} onChange={(e) => setPath(e.target.value)} placeholder={t(kind === "github" ? "projects.sources.githubPlaceholder" : "projects.sources.pathPlaceholder")} />
            </div>
            {kind !== "local" && <p className="mt-2 text-[12px] leading-relaxed text-ink-tertiary">{t(kind === "ssh" ? "projects.sources.sshHint" : "projects.sources.githubHint")}</p>}
            <button disabled={!valid} onClick={add} className="mt-3 flex items-center gap-2 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40"><Plus size={14} />{t("projects.sources.add")}</button>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-hairline/40 px-6 py-4">
          <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">{t("projects.cancel")}</button>
          <button onClick={() => onSave(valid && typed ? [...list, pending()] : list)} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110">{t("projects.save")}</button>
        </footer>
      </div>
    </div>
  );
}

// ---------- file tree ----------
function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded-[3px] bg-[#ffd23f] px-px text-black">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}
const rowCls = "flex h-[26px] items-center gap-[7px] whitespace-nowrap rounded-[7px] px-1.5 hover:bg-raised-hover";
function TreeList({ nodes, q, depth = 0 }: { nodes: ProjectNode[]; q: string; depth?: number }) {
  return <>{nodes.map((n, i) => <TreeItem key={`${n.t}${n.n}${i}`} node={n} q={q} depth={depth} />)}</>;
}
function TreeItem({ node, q, depth }: { node: ProjectNode; q: string; depth: number }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const pad = { paddingLeft: depth * 14 + 6 };
  if (node.t === "more") return <div className={cn(rowCls, "italic text-ink-tertiary")} style={pad}>{t("projects.truncated")}</div>;
  if (node.t === "f") return (
    <div className={cn(rowCls, "text-ink-secondary")} style={{ paddingLeft: depth * 14 + 27 }}>
      <File size={14} className="shrink-0 text-ink-tertiary" /><span><Highlight text={node.n} q={q} /></span>
    </div>
  );
  const isOpen = open ?? Boolean(q && contains(node.c ?? [], q));
  return (
    <>
      <button type="button" className={cn(rowCls, "w-full text-left text-ink")} style={pad} onClick={() => setOpen(!isOpen)}>
        <ChevronRight size={14} className={cn("shrink-0 text-ink-tertiary transition-transform", isOpen && "rotate-90")} />
        <Folder size={14} className="shrink-0 text-[#e8b35a]" /><span><Highlight text={node.n} q={q} /></span>
      </button>
      {isOpen && <TreeList nodes={node.c ?? []} q={q} depth={depth + 1} />}
    </>
  );
}

// ---------- page ----------
const VIEW_KEY = "atelier.view";

export function AtelierTitle() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <FolderTree size={16} className="text-ink-secondary" />
      <h1 className="text-[14px] font-semibold text-ink">{t("projects.title")}</h1>
    </div>
  );
}

export function ProjectsPage() {
  const [data, setData] = useState<ProjectsResponse | null>(null);
  const [S, setS] = useState<MapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [query, setQuery] = useState("");
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [poleMenu, setPoleMenu] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [mapOf, setMapOf] = useState<Project | null>(null);
  const [mapChanged, setMapChanged] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [searchOpen, setSearchOpen] = useState(false);
  const [view, setView] = useCanvasView(DEFAULT_VIEW, VIEW_KEY);
  const [stored] = useState(() => readStoredView(VIEW_KEY));
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const viewport = useElementSize(box);
  const [ask, askNode] = useAsk();
  const { state: appState, dispatch } = useStore();
  const showThreads = useShowThreads();
  const observer = useRef<ResizeObserver | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const opened = useRef(false);

  const [sync] = useState(() => createMapSync<MapState>({
    put: (body) => api<{ rev: number }>("/api/projects/state", { method: "PUT", body: JSON.stringify(body) }),
    reload: () => { void loadRef.current(); },
    changedElsewhere: () => setMapChanged(true),
    status: setSaveState,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    delayMs: 400,
  }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<ProjectsResponse>("/api/projects");
      sync.loaded(res.state);
      setData(res); setS(res.state);
      if (!opened.current && !stored) setView({ x: 0, y: 0, scale: clampScale(res.state.zoom) });
      if (!res.state.sources.length) setSourcesOpen(true);
    } catch {
      setSaveState("error");
    } finally {
      setLoading(false);
    }
  }, [sync, stored, setView]);
  loadRef.current = load;
  useEffect(() => { void load(); }, [load]);
  useEffect(() => listenLiveFrames({ onFrame: (frame) => sync.frame(frame), onMissedFrames: () => { void loadRef.current(); } }), [sync]);

  // Every change goes through here and is saved shortly after.
  const update = useCallback((fn: (s: MapState) => MapState) => {
    setS((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      sync.later(next);
      return next;
    });
  }, [sync]);

  // Replaces any save still waiting, so a layout change made just before cannot overwrite this one.
  const saveNow = useCallback(async (next: MapState) => {
    setS(next);
    await sync.now(next);
  }, [sync]);

  const cartographe = data?.cartographeBotId ? appState.bots.find((bot) => bot.id === data.cartographeBotId) ?? null : null;
  const [panelOpen, setPanelOpen] = useState(() => readPanelOpen(browserStorage()));
  const [making, setMaking] = useState(false);
  const [cartoError, setCartoError] = useState(false);
  // The draft to put in once a Cartographe being made shows up in the app.
  const pendingDraft = useRef<{ projectName?: string } | null>(null);
  const width = useWindowWidth();
  const togglePanel = useCallback((open: boolean, projectName?: string) => {
    if (open && cartographe) leadComposerDraft(`bot:${cartographe.id}:${cartographe.threadId}`, panelDraft({ projectName }));
    setPanelOpen(open);
    writePanelOpen(browserStorage(), open);
  }, [cartographe]);
  useEffect(() => {
    if (!cartographe || !pendingDraft.current) return;
    leadComposerDraft(`bot:${cartographe.id}:${cartographe.threadId}`, panelDraft(pendingDraft.current));
    pendingDraft.current = null;
  }, [cartographe]);
  /** Opens the Cartographe's chat, making it again first when it was deleted. */
  const askCartographe = useCallback(async (projectName?: string) => {
    setCartoError(false);
    if (cartographe) { togglePanel(true, projectName); return; }
    if (making) return;
    setMaking(true);
    try {
      const { cartographeBotId } = await api<{ cartographeBotId: string }>("/api/projects/cartographe", { method: "POST" });
      pendingDraft.current = { projectName };
      setData((prev) => (prev ? { ...prev, cartographeBotId } : prev));
      togglePanel(true);
    } catch {
      setCartoError(true);
    } finally {
      setMaking(false);
    }
  }, [cartographe, making, togglePanel]);
  const panelShown = panelOpen && Boolean(data?.cartographeBotId);
  const openInChat = useCallback(() => {
    if (cartographe) openBot(dispatch, cartographe, showThreads);
  }, [cartographe, dispatch, showThreads]);

  const projects = useMemo(() => data?.projects ?? [], [data]);
  const sourceLabel = useCallback((id: string) => S?.sources.find((s) => s.id === id)?.label ?? "", [S?.sources]);
  const multiSource = (S?.sources.length ?? 0) > 1;
  const q = query.trim().toLowerCase();

  // Block sizes, for drawing group zones and links. Layout sizes, so the canvas scale does not change them.
  useLayoutEffect(() => {
    observer.current = new ResizeObserver((entries) => {
      setSizes((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          next[el.dataset.canvasNode!] = { w: el.offsetWidth, h: el.offsetHeight };
        }
        return next;
      });
    });
    return () => observer.current?.disconnect();
  }, []);
  const measure = useCallback((el: HTMLDivElement | null) => { if (el) observer.current?.observe(el); }, []);

  const rects = useMemo(() => new Map(projects.map((p, i) => [p.id, blockRect(S?.pos ?? {}, p.id, i, sizes[p.id])])), [projects, S?.pos, sizes]);
  const zones = useMemo(() => (S?.groups ?? []).flatMap((g) => {
    const zone = groupZone(projects.filter((p) => S?.member[p.id] === g.id).map((p) => rects.get(p.id)!));
    return zone ? [{ group: g, zone }] : [];
  }), [S?.groups, S?.member, projects, rects]);
  const annotations = useMemo(() => S?.annotations ?? [], [S?.annotations]);
  const frame = useMemo(() => [...rects.values(), ...zones.map((z) => z.zone), ...annotations.map(annotationBounds)], [rects, zones, annotations]);

  const measured = projects.length > 0 && projects.every((p) => sizes[p.id]);
  useEffect(() => {
    if (!S || opened.current || !measured || !(viewport.w > 0)) return;
    opened.current = true;
    setView(openingView(stored, S.zoom, frame, viewport));
  }, [S, measured, viewport, frame, stored, setView]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setLinkFrom(null); setPoleMenu(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!S) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center bg-app text-ink-secondary">
        {loading ? <Loader2 size={20} className="animate-spin" /> : t("projects.loadFailed")}
      </main>
    );
  }

  const groupOf = (id: string) => S.groups.find((g) => g.id === S.member[id]);

  // ----- actions -----
  const newPole = async () => {
    const name = await ask({ title: t("projects.pole.newTitle"), text: t("projects.pole.newText"), placeholder: t("projects.pole.placeholder"), ok: t("projects.pole.create") });
    if (!name) return null;
    const used = S.groups.map((g) => g.color);
    const g: Group = { id: newId("g"), name: name.slice(0, 60), color: PALETTE.find((c) => !used.includes(c)) ?? PALETTE[S.groups.length % PALETTE.length] };
    update((s) => ({ ...s, groups: [...s.groups, g] }));
    return g;
  };
  const setPole = (id: string, gid: string | null) => update((s) => {
    const member = { ...s.member };
    if (gid) member[id] = gid; else delete member[id];
    return { ...s, member };
  });
  const renamePole = async (g: Group) => {
    const name = await ask({ title: t("projects.pole.renameTitle"), value: g.name, ok: t("projects.pole.rename") });
    if (name) update((s) => ({ ...s, groups: s.groups.map((o) => (o.id === g.id ? { ...o, name: name.slice(0, 60) } : o)) }));
  };
  const deletePole = async (g: Group) => {
    if (!await ask({ title: t("projects.pole.deleteTitle", { name: g.name }), text: t("projects.pole.deleteText"), ok: t("projects.delete"), danger: true, input: false })) return;
    update((s) => ({ ...s, groups: s.groups.filter((o) => o.id !== g.id), member: Object.fromEntries(Object.entries(s.member).filter(([, v]) => v !== g.id)) }));
  };
  const onLink = async (id: string) => {
    if (!linkFrom) { setLinkFrom(id); return; }
    const from = linkFrom; setLinkFrom(null);
    if (from === id || S.links.some((l) => (l.a === from && l.b === id) || (l.a === id && l.b === from))) return;
    const nameOf = (x: string) => projects.find((p) => p.id === x)?.name ?? x;
    const label = await ask({ title: t("projects.link.title", { from: nameOf(from), to: nameOf(id) }), text: t("projects.link.text"), placeholder: t("projects.link.placeholder"), ok: t("projects.link.create") });
    if (label === null) return;
    update((s) => ({ ...s, links: [...s.links, { a: from, b: id, label: label.slice(0, 60) }] }));
  };
  const deleteLink = async (l: Link | undefined) => {
    if (!l) return;
    if (await ask({ title: t("projects.link.deleteTitle"), ok: t("projects.delete"), danger: true, input: false })) update((s) => ({ ...s, links: s.links.filter((o) => o !== l) }));
  };
  const arrange = () => {
    const buckets = [...S.groups.map((g) => projects.filter((p) => S.member[p.id] === g.id)), projects.filter((p) => !groupOf(p.id))];
    const next: MapState["pos"] = { ...S.pos, ...arrangeByGroup(buckets.map((list) => list.map((p) => ({ id: p.id, h: sizes[p.id]?.h ?? 200 })))) };
    update((s) => ({ ...s, pos: next }));
  };
  const searchItems: CanvasSearchItem[] = [
    ...projects.map((p) => ({ id: p.id, label: p.name, rect: rects.get(p.id)! })),
    ...annotations.flatMap((a) => {
      const text = annotationText(a)?.trim();
      return text ? [{ id: a.id, label: text.split("\n")[0]!, rect: annotationBounds(a), kind: t(a.kind === "sticky" ? "atelier.annotation.note" : "atelier.annotation.text") }] : [];
    }),
  ];
  const focus = (id: string) => {
    const r = rects.get(id) ?? searchItems.find((item) => item.id === id)?.rect; if (!r) return;
    setSelected(id);
    setView(centerOn(view, { x: r.x + r.w / 2, y: r.y + Math.min(r.h, 300) / 2 }, viewport));
  };

  const sidebarGroups: { group: Group | null; list: Project[] }[] = [
    ...S.groups.map((g) => ({ group: g, list: projects.filter((p) => S.member[p.id] === g.id) })),
    { group: null, list: projects.filter((p) => !groupOf(p.id)) },
  ];
  const saveLabel = { idle: "", saving: t("projects.saving"), saved: t("projects.saved"), error: t("projects.saveError") }[saveState];

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app" aria-label={t("projects.title")}>
      <header className="flex items-center gap-3 border-b border-hairline/40 px-4 py-2.5">
        <AtelierTitle />
        <label className="flex h-8 min-w-0 max-w-[320px] flex-1 items-center gap-2 rounded-full bg-control px-3 text-ink-tertiary focus-within:ring-1 focus-within:ring-accent-border">
          <Search size={14} className="shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("projects.search")} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary" />
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className={cn("hidden items-center gap-1.5 whitespace-nowrap text-[12px] sm:flex", saveState === "error" ? "text-danger" : "text-ink-tertiary")}>
            {saveLabel && <span className={cn("size-[7px] rounded-full", saveState === "error" ? "bg-danger" : saveState === "saving" ? "bg-warning" : "bg-success")} />}{saveLabel}
          </span>
          <ToolGroup>
            <ToolButton onClick={() => setSourcesOpen(true)} label={t("projects.sources.button")}><Server size={15} /><span className="hidden lg:inline">{t("projects.sources.button")}</span></ToolButton>
            <ToolButton onClick={arrange} label={t("projects.arrange")}><LayoutGrid size={15} /><span className="hidden lg:inline">{t("projects.arrange")}</span></ToolButton>
          </ToolGroup>
          <ToolGroup className="hidden sm:flex">
            <ToolButton onClick={() => void load()} label={t("projects.refresh")}><RefreshCw size={15} className={cn(loading && "animate-spin")} /></ToolButton>
            <ToolButton onClick={() => update((s) => ({ ...s, help: !s.help }))} label={t("projects.help.button")}><CircleHelp size={15} /></ToolButton>
          </ToolGroup>
        </div>
      </header>
      {mapChanged && <MapChangedNotice onClose={() => setMapChanged(false)} />}

      <div className="relative flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-hairline/40 bg-panel md:flex">
          <div className="flex items-center justify-between pb-2 pl-4 pr-2 pt-3 text-[13px] font-medium text-ink-tertiary">
            {t("projects.poles")}
            <button className="ui-icon-button" aria-label={t("projects.pole.newTitle")} title={t("projects.pole.newTitle")} onClick={() => void newPole()}><Plus size={15} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {sidebarGroups.map(({ group, list }) => (
              <div key={group?.id ?? "none"} className="mb-1">
                <div className="group/pole flex h-8 items-center gap-2 rounded-lg px-2 hover:bg-raised">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: group?.color ?? "var(--color-hairline)" }} />
                  <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", group ? "text-ink" : "text-ink-secondary")}>{group?.name ?? t("projects.noPole")}</span>
                  <span className="text-[12px] tabular-nums text-ink-tertiary group-hover/pole:hidden">{list.length}</span>
                  {group && <span className="hidden gap-0.5 group-hover/pole:flex">
                    <button className="rounded p-0.5 text-ink-tertiary hover:text-ink" aria-label={t("projects.pole.rename")} onClick={() => void renamePole(group)}><Pencil size={13} /></button>
                    <button className="rounded p-0.5 text-ink-tertiary hover:text-danger" aria-label={t("projects.delete")} onClick={() => void deletePole(group)}><Trash2 size={13} /></button>
                  </span>}
                </div>
                <ul className="pl-6">
                  {list.map((p) => (
                    <li key={p.id}><button onClick={() => focus(p.id)} className="flex h-7 w-full items-center truncate rounded-md px-2 text-left text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink">{p.name}</button></li>
                  ))}
                  {!list.length && <li className="px-2 py-1 text-[12px] italic text-ink-tertiary">{t("projects.poleEmpty")}</li>}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        {mapOf && <ArchitectureView project={mapOf} onBack={() => setMapOf(null)} state={S} onSave={saveNow}
          onAskCartographe={() => void askCartographe(mapOf.name)} />}
        <div ref={setBox} className={cn("relative flex min-w-0 flex-1", mapOf && "hidden")}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && (e.target as Element).closest("[data-canvas]")) { e.preventDefault(); setSearchOpen(true); }
          }}>
          <Canvas view={view} onViewChange={setView} tool={tool} rects={frame} minimap onBackgroundClick={() => setSelected(null)}
            toolbar={<Toolbar tool={tool} onTool={setTool} search={() => setSearchOpen((open) => !open)} />}
            bottomRight={<CartographeFab bot={cartographe} busy={making} open={panelShown} onAsk={() => void askCartographe()} />}
            overlay={<AnnotationLayer items={annotations} tool={tool} selectedId={selected} onSelect={setSelected} onTool={setTool}
              onChange={(items) => update((s) => ({ ...s, annotations: items }))} />}
            underlay={<>
              <PoleZones zones={zones} />
              <EdgeLayer edges={linkEdges(S.links, rects)} onEdgeClick={(id) => void deleteLink(S.links[Number(id)])} />
            </>}>
            {projects.map((p) => {
              const r = rects.get(p.id)!;
              const g = groupOf(p.id);
              const collapsed = Boolean(S.collapsed[p.id]);
              const hit = !q || p.name.toLowerCase().includes(q) || contains(p.tree, q);
              const summary = S.overrides && Object.hasOwn(S.overrides, p.id) ? S.overrides[p.id]!.summary : undefined;
              return (
                <NodeFrame key={p.id} id={p.id} nodeRef={measure} rect={{ ...r, w: BLOCK_W }} autoHeight selected={selected === p.id} locked={false}
                  onSelect={setSelected} onMove={(id, x, y) => setS((s) => (s ? placeBlock(s, id, x, y) : s))} onMoveEnd={(id, x, y) => update((s) => placeBlock(s, id, x, y))}
                  className={cn("transition-opacity", !hit && "opacity-25")}
                  cardClassName={cn("block overflow-visible p-0", linkFrom === p.id && "border-accent-border ring-[3px] ring-accent/25")}>
                  <div className="relative flex items-start gap-3 px-3.5 pb-2 pt-3">
                    <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-control text-ink-secondary"
                      style={g ? { background: `${g.color}22`, color: g.color } : undefined}>
                      <SourceIcon kind={S.sources.find((o) => o.id === p.sourceId)?.kind ?? "local"} size={15} tinted={false} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-semibold leading-[20px] text-ink" title={p.name}><Highlight text={p.name} q={q} /></div>
                      <ProjectBlockMeta dirs={p.dirs} files={p.files} truncated={p.truncated} source={multiSource ? sourceLabel(p.sourceId) : undefined} />
                    </div>
                    <div className="-mr-1.5 -mt-0.5 flex shrink-0 items-center">
                      {g && <ProjectBlockPole group={g} onClick={() => setPoleMenu(poleMenu === p.id ? null : p.id)} />}
                      <ProjectBlockHeaderActions name={p.name} linking={linkFrom === p.id} collapsed={collapsed}
                        onMap={() => setMapOf(p)} onLink={() => void onLink(p.id)}
                        onFold={() => update((s) => { const c = { ...s.collapsed }; if (c[p.id]) delete c[p.id]; else c[p.id] = 1; return { ...s, collapsed: c }; })} />
                    </div>
                  </div>
                  <div className={cn("relative pl-[56px] pr-3.5", (!g || summary) && "pb-3")}>
                    <ProjectBlockSummary summary={summary} />
                    {!g && (
                      <button onClick={() => setPoleMenu(poleMenu === p.id ? null : p.id)}
                        className="mt-2 inline-flex h-6 items-center gap-1.5 rounded-full border border-dashed border-hairline px-2.5 text-[12px] text-ink-tertiary hover:text-ink">
                        <Plus size={12} />{t("projects.pole.choose")}
                      </button>
                    )}
                    {poleMenu === p.id && (
                      <Menu onClose={() => setPoleMenu(null)} className={g ? "right-3 top-0" : undefined}>
                        {S.groups.map((o) => <MenuRow key={o.id} onClick={() => { setPole(p.id, o.id); setPoleMenu(null); }}><span className="size-2 rounded-full" style={{ background: o.color }} />{o.name}</MenuRow>)}
                        {S.groups.length > 0 && <hr className="mx-1 my-1 border-hairline/40" />}
                        <MenuRow onClick={async () => { setPoleMenu(null); const ng = await newPole(); if (ng) setPole(p.id, ng.id); }}><Plus size={14} />{t("projects.pole.new")}</MenuRow>
                        {g && <MenuRow muted onClick={() => { setPole(p.id, null); setPoleMenu(null); }}><X size={14} />{t("projects.pole.remove")}</MenuRow>}
                      </Menu>
                    )}
                  </div>
                  {!collapsed && (
                    <div data-canvas-scroll className="max-h-[330px] overflow-auto rounded-b-[13px] border-t border-hairline/50 bg-inset px-2 py-1.5 font-mono text-[12.5px]">
                      {p.tree.length ? <TreeList nodes={p.tree} q={q} /> : <div className={cn(rowCls, "italic text-ink-tertiary")}>{t("projects.emptyFolder")}</div>}
                    </div>
                  )}
                </NodeFrame>
              );
            })}
          </Canvas>

          {searchOpen && (
            <div className="absolute inset-x-0 top-3 z-30 flex justify-center px-3">
              <CanvasSearch items={searchItems} onPick={focus} onClose={() => setSearchOpen(false)} />
            </div>
          )}
          {((data?.errors.length ?? 0) > 0 || linkFrom || cartoError) && (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col items-center gap-1.5">
              {(data?.errors ?? []).map((e) => (
                <button key={e.sourceId} onClick={() => setSourcesOpen(true)}
                  className="pointer-events-auto flex w-full max-w-[640px] items-start gap-2 rounded-xl border border-danger/30 bg-card px-3 py-2 text-left text-[13px] text-danger hover:border-danger/60">
                  <span className="font-medium">{t("projects.sourceError", { name: sourceLabel(e.sourceId) })}</span>
                  <span className="min-w-0 flex-1 text-ink-secondary">{e.message}</span>
                </button>
              ))}
              {cartoError && (
                <div role="alert" className="animate-pop-in pointer-events-auto flex items-center gap-2 rounded-xl border border-danger/30 bg-card py-1.5 pl-3 pr-1.5 text-[13px] text-danger">
                  {t("projects.cartographe.unavailable")}
                  <button type="button" className="ui-icon-button" aria-label={t("projects.close")} onClick={() => setCartoError(false)}><X size={14} /></button>
                </div>
              )}
              {linkFrom && (
                <div className="animate-pop-in pointer-events-auto flex items-center gap-3 rounded-full bg-ink py-2 pl-4 pr-2 text-[13px] font-medium text-app">
                  {t("projects.link.pick", { name: projects.find((p) => p.id === linkFrom)?.name ?? "" })}
                  <button onClick={() => setLinkFrom(null)} className="rounded-full bg-black/10 px-2.5 py-1 text-[12px]">{t("projects.cancel")}</button>
                </div>
              )}
            </div>
          )}
          {!projects.length && !loading && (
            <div className="absolute left-1/2 top-32 w-[min(340px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-hairline/50 bg-card p-6 text-center">
              <FolderTree size={22} className="mx-auto text-ink-secondary" />
              <p className="mt-3 text-[14px] font-medium text-ink">{t("projects.empty.title")}</p>
              <p className="mt-1 text-[13px] text-ink-secondary">{t("projects.empty.text")}</p>
              <button onClick={() => setSourcesOpen(true)} className="mt-4 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110">{t("projects.sources.add")}</button>
            </div>
          )}
          {S.help && projects.length > 0 && (
            <div className="animate-pop-in absolute right-4 top-4 z-20 w-[min(300px,calc(100%-2rem))] rounded-2xl border border-hairline bg-card p-4">
              <button className="ui-icon-button absolute right-2 top-2" aria-label={t("projects.close")} onClick={() => update((s) => ({ ...s, help: false }))}><X size={15} /></button>
              <h3 className="mb-3 text-[14px] font-semibold text-ink">{t("projects.help.title")}</h3>
              <ol className="flex flex-col gap-2.5">
                {(["projects.help.step1", "projects.help.step2", "projects.help.step3", "projects.help.step4"] as const).map((key, i) => (
                  <li key={key} className="flex gap-2.5 text-[13px] leading-snug text-ink-secondary">
                    <span className="grid size-[22px] shrink-0 place-items-center rounded-[7px] bg-control text-[12px] tabular-nums text-ink">{i + 1}</span>{t(key)}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
        {panelShown && (
          <CartographePanel botId={data?.cartographeBotId ?? null} bot={cartographe} width={width}
            chat={cartographe ? <ChatView bot={cartographe} /> : null} onClose={() => togglePanel(false)} onOpenInChat={openInChat} />
        )}
      </div>

      {sourcesOpen && (
        <SourcesDialog sources={S.sources} errors={data?.errors ?? []} onClose={() => setSourcesOpen(false)}
          onSave={(sources) => {
            setSourcesOpen(false);
            const next = { ...S, sources };
            setS(next);
            sync.now(next).then(() => load(), () => {});
          }} />
      )}
      {askNode}
    </main>
  );
}

/** The pôles' zones behind their blocks, each with its name in a pill. */
function PoleZones({ zones }: { zones: { group: Group; zone: { x: number; y: number; w: number; h: number } }[] }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
      {zones.map(({ group: g, zone }) => (
        <g key={g.id}>
          <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx={22} fill={g.color} fillOpacity={0.05} stroke={g.color} strokeOpacity={0.35} strokeWidth={1.2} />
          <rect x={zone.x + 14} y={zone.y + 14} width={g.name.length * 7.6 + 30} height={24} rx={12} fill={g.color} fillOpacity={0.16} />
          <circle cx={zone.x + 27} cy={zone.y + 26} r={3.5} fill={g.color} />
          <text x={zone.x + 37} y={zone.y + 30.5} fill={g.color} className="text-[13px] font-semibold">{g.name}</text>
        </g>
      ))}
    </svg>
  );
}

function useElementSize(element: HTMLElement | null): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!element) return;
    const read = () => setSize((prev) => (prev.w === element.clientWidth && prev.h === element.clientHeight ? prev : { w: element.clientWidth, h: element.clientHeight }));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

type CartographeBot = { id: string; threadId: string; mainThreadId?: string; tasks?: { threadId: string }[] };

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** The Cartographe's real chat beside the map, or over it on a narrow window; null without a Cartographe. */
export function CartographePanel({ botId, bot, width, chat, onClose, onOpenInChat }: {
  botId: string | null; bot: CartographeBot | null; width: number; chat: ReactNode; onClose: () => void; onOpenInChat: () => void;
}) {
  if (!botId) return null;
  const layout = panelLayout(width);
  return (
    <aside className={layout.className} data-cartographe-panel={layout.narrow ? "overlay" : "side"} aria-label={t("projects.cartographe.fab")}>
      <div className="flex items-center gap-2 border-b border-hairline/40 px-3 py-2">
        <CartographeHead bot={bot} size={26} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-medium text-ink">{t("projects.cartographe.title")}</span>
          <span className="truncate text-[11.5px] text-ink-tertiary">{t("projects.cartographe.subtitle")}</span>
        </span>
        <button type="button" onClick={onOpenInChat} className="rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink">{t("projects.cartographe.openInChat")}</button>
        <button type="button" onClick={onClose} aria-label={t("projects.cartographe.close")} title={t("projects.cartographe.close")}
          className="grid size-7 place-items-center rounded-lg text-ink-tertiary hover:bg-raised-hover hover:text-ink"><X size={15} /></button>
      </div>
      {bot
        ? <div className="flex min-h-0 flex-1 flex-col">{chat}</div>
        : <p className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={15} className="animate-spin" />{t("projects.cartographe.loading")}</p>}
    </aside>
  );
}


type HeadBot = Partial<CartographeBot> & Partial<BotAvatarProps["bot"]>;

/** The Cartographe's own avatar, as in the sidebar; a plain bot head while it does not exist. */
function CartographeHead({ bot, size }: { bot: HeadBot | null; size: number }) {
  return bot?.color
    ? <BotAvatar bot={bot as BotAvatarProps["bot"]} size={size} label="" />
    : <BotIcon size={Math.round(size * 0.7)} strokeWidth={1.75} className="shrink-0 text-ink-secondary" />;
}

/** Round button in the canvas' bottom-right corner: opens the Cartographe's chat, making it again if it was deleted. */
export function CartographeFab({ bot, busy, open, onAsk }: { bot: HeadBot | null; busy: boolean; open: boolean; onAsk: () => void }) {
  if (open) return null;
  const label = t("projects.cartographe.fab");
  return (
    <button type="button" data-cartographe-fab onClick={onAsk} disabled={busy} aria-busy={busy || undefined} title={label} aria-label={label}
      className="pointer-events-auto grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border border-black/10 bg-[#f7f7f5] text-[#1c1c1e] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-progress">
      {busy ? <Loader2 size={20} className="animate-spin" /> : bot?.color ? <CartographeHead bot={bot} size={34} /> : <BotIcon size={22} strokeWidth={1.75} />}
    </button>
  );
}

export function MapChangedNotice({ onClose }: { onClose: () => void }) {
  return (
    <div role="status" className="flex items-center gap-2 border-b border-hairline/40 bg-panel px-4 py-2 text-[12.5px] text-ink-secondary">
      <span className="size-[7px] shrink-0 rounded-full bg-warning" />
      <span className="min-w-0 flex-1">{t("projects.mapChanged")}</span>
      <button type="button" className="ui-icon-button" aria-label={t("projects.mapChanged.close")} title={t("projects.mapChanged.close")} onClick={onClose}><X size={14} /></button>
    </div>
  );
}

/** The first line of the project's En bref card, under its name in the overview. */
export function ProjectBlockSummary({ summary }: { summary: string | undefined }) {
  const line = summaryPreview(summary);
  if (!line) return null;
  return <p className="line-clamp-2 text-[12.5px] leading-[18px] text-ink-secondary" title={summary}>{line}</p>;
}

/** One count that always fits; the folders and the source are in its tooltip. */
export function ProjectBlockMeta({ dirs, files, truncated, source }: { dirs: number; files: number; truncated: boolean; source?: string }) {
  const shown = truncated ? `${files}+` : files;
  const title = source ? t("projects.countsIn", { dirs, files: shown, source }) : t("projects.counts", { dirs, files: shown });
  return <div className="whitespace-nowrap text-[12px] leading-[18px] tabular-nums text-ink-tertiary" title={title}>{t(shown === 1 ? "projects.files.one" : "projects.files", { files: shown })}</div>;
}

/** The block's pole, shown as its color only: the pole's name is already on the zone around the block. */
export function ProjectBlockPole({ group, onClick }: { group: { name: string; color: string }; onClick: () => void }) {
  const label = t("projects.pole.change", { name: group.name });
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="grid size-7 place-items-center rounded-lg hover:bg-raised-hover">
      <span className="size-2.5 rounded-full" style={{ background: group.color }} />
    </button>
  );
}

export function ProjectBlockHeaderActions({ name, linking, collapsed, onMap, onLink, onFold }: {
  name: string; linking: boolean; collapsed: boolean; onMap: () => void; onLink: () => void; onFold: () => void;
}) {
  const icon = "grid size-7 place-items-center rounded-lg text-ink-tertiary hover:bg-raised-hover hover:text-ink";
  return (
    <>
      <button type="button" className={icon} title={t("projects.map.openTitle", { name })} aria-label={t("projects.map.openTitle", { name })} onClick={onMap}>
        <Network size={15} />
      </button>
      <button type="button" className={cn("grid size-7 place-items-center rounded-lg", linking ? "bg-accent/15 text-accent-text" : "text-ink-tertiary hover:bg-raised-hover hover:text-ink")}
        title={t("projects.link.button")} aria-label={t("projects.link.button")} onClick={onLink}><Link2 size={15} /></button>
      <button type="button" className={icon} title={t("projects.fold")} aria-label={t("projects.fold")} onClick={onFold}>
        <ChevronDown size={15} className={cn("transition-transform", collapsed && "-rotate-90")} />
      </button>
    </>
  );
}

function GithubAccount({ onUseAccount }: { onUseAccount: (login: string) => void }) {
  const [login, setLogin] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ login: string | null }>("/api/projects/github").then((r) => setLogin(r.login), () => setLogin(null));
  }, []);
  const signIn = (switchAccount: boolean) => {
    setBusy(true);
    api<{ login: string | null }>("/api/projects/github/signin", { method: "POST", body: JSON.stringify({ switch: switchAccount }), timeoutMs: 200_000 })
      .then((r) => setLogin(r.login), () => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <div className="mb-3 rounded-lg bg-inset p-3 text-[13px]">
      <div className="flex items-center gap-2">
        <Github size={15} className="shrink-0 text-ink-secondary" />
        <span className="min-w-0 flex-1 leading-snug text-ink-secondary">
          {busy ? t("projects.github.waiting") : login === undefined ? "…" : login ? t("projects.github.signedIn", { login }) : t("projects.github.signedOut")}
        </span>
        {busy && <Loader2 size={14} className="shrink-0 animate-spin text-ink-tertiary" />}
        {!busy && login && (
          <button onClick={() => signIn(true)} className="shrink-0 rounded-md px-2 py-1 text-[12.5px] text-ink-tertiary hover:bg-raised hover:text-ink">{t("projects.github.switch")}</button>
        )}
      </div>
      {!busy && login !== undefined && (
        <button onClick={() => (login ? onUseAccount(login) : signIn(false))}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[13px] font-medium text-white hover:brightness-110">
          {login ? t("projects.github.useAccount") : t("projects.github.signIn")}
        </button>
      )}
    </div>
  );
}

function SourceIcon({ kind, size, tinted = true }: { kind: Source["kind"]; size: number; tinted?: boolean }) {
  const Icon = kind === "ssh" ? Server : kind === "github" ? Github : HardDrive;
  return <Icon size={size} className={cn("shrink-0", tinted && "text-ink-secondary")} />;
}

function ToolGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-0.5 rounded-full border border-hairline/60 p-0.5", className)}>{children}</div>;
}

function ToolButton({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-ink-secondary hover:bg-raised-hover hover:text-ink">
      {children}
    </button>
  );
}

function Menu({ onClose, className = "left-3 top-8", children }: { onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const id = setTimeout(() => window.addEventListener("pointerdown", onDown));
    return () => { clearTimeout(id); window.removeEventListener("pointerdown", onDown); };
  }, [onClose]);
  return <div ref={ref} className={cn("animate-pop-in absolute z-20 min-w-[200px] rounded-[14px] border border-hairline bg-card p-1.5 shadow-xl shadow-black/40", className)}>{children}</div>;
}

function MenuRow({ onClick, muted, children }: { onClick: () => void; muted?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex h-8 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13px] hover:bg-menu-hover", muted ? "text-ink-secondary" : "text-ink")}>
      {children}
    </button>
  );
}
