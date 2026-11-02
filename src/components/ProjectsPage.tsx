// Projects map: each project folder (local or on an SSH host) is a block with
// its full file tree. Blocks are grouped by "pôle" (group) and joined by links.
// Shown in place of the chat, like Team map. Layout is saved on the server.
import {
  ChevronDown, ChevronRight, CircleHelp, File, Folder, FolderTree, Github, HardDrive, LayoutGrid, Link2, Loader2,
  Minus, Network, Pencil, Plus, RefreshCw, Search, Server, Sparkles, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { prependComposerDraft } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { listenLiveFrames } from "@/lib/live-events";
import type { ArchOverrides } from "@/lib/projects-architecture-view";
import { arrangeByGroup, edgePoint, groupZone } from "@/lib/projects-map";
import { createMapSync } from "@/lib/projects-map-sync";
import { useShowThreads } from "@/lib/thread-preferences";
import { api } from "@/state/api";
import { GROUP_PALETTE as PALETTE } from "../../shared/project-groups";
import { openBot, useStore } from "@/state/store";

import { ArchitectureView } from "./projects/ArchitectureView";

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
  rev?: number;
}
interface ProjectsResponse { state: MapState; projects: Project[]; errors: { sourceId: string; message: string }[]; cartographeBotId?: string | null }

const BLOCK_W = 300;
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
  const [ask, askNode] = useAsk();
  const { state: appState, dispatch } = useStore();
  const showThreads = useShowThreads();
  const wrapRef = useRef<HTMLDivElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

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
      if (!res.state.sources.length) setSourcesOpen(true);
    } catch {
      setSaveState("error");
    } finally {
      setLoading(false);
    }
  }, [sync]);
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

  const projects = useMemo(() => data?.projects ?? [], [data]);
  const sourceLabel = useCallback((id: string) => S?.sources.find((s) => s.id === id)?.label ?? "", [S?.sources]);
  const multiSource = (S?.sources.length ?? 0) > 1;
  const q = query.trim().toLowerCase();

  // Projects without a saved position get a spot in a grid.
  const pos = useCallback((p: Project, i: number) => S?.pos[p.id] ?? { x: 50 + (i % 4) * 360, y: 50 + Math.floor(i / 4) * 400 }, [S?.pos]);

  // Block sizes, for drawing group zones and links.
  useLayoutEffect(() => {
    observer.current = new ResizeObserver((entries) => {
      setSizes((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.id!;
          next[id] = { w: (entry.target as HTMLElement).offsetWidth, h: (entry.target as HTMLElement).offsetHeight };
        }
        return next;
      });
    });
    return () => observer.current?.disconnect();
  }, []);
  const measure = useCallback((el: HTMLDivElement | null) => { if (el) observer.current?.observe(el); }, []);

  // Ctrl + wheel zooms the map; React's wheel listener is passive, so this one is added by hand.
  const zoomRef = useRef(1);
  zoomRef.current = S?.zoom || 1;
  const ready = Boolean(S);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const z = Math.min(1.6, Math.max(0.3, +(zoomRef.current - Math.sign(e.deltaY) * 0.05).toFixed(2)));
      update((s) => ({ ...s, zoom: z }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ready, update]);

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

  const zoom = S.zoom || 1;
  const groupOf = (id: string) => S.groups.find((g) => g.id === S.member[id]);
  const rect = (p: Project, i: number) => ({ ...pos(p, i), w: sizes[p.id]?.w ?? BLOCK_W, h: sizes[p.id]?.h ?? 120 });
  const rects = new Map(projects.map((p, i) => [p.id, rect(p, i)]));

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
  const deleteLink = async (l: Link) => {
    if (await ask({ title: t("projects.link.deleteTitle"), ok: t("projects.delete"), danger: true, input: false })) update((s) => ({ ...s, links: s.links.filter((o) => o !== l) }));
  };
  const arrange = () => {
    const buckets = [...S.groups.map((g) => projects.filter((p) => S.member[p.id] === g.id)), projects.filter((p) => !groupOf(p.id))];
    const next: MapState["pos"] = { ...S.pos, ...arrangeByGroup(buckets.map((list) => list.map((p) => ({ id: p.id, h: sizes[p.id]?.h ?? 200 })))) };
    update((s) => ({ ...s, pos: next }));
  };
  const setZoom = (z: number) => update((s) => ({ ...s, zoom: Math.min(1.6, Math.max(0.3, +z.toFixed(2))) }));
  const focus = (id: string) => {
    const r = rects.get(id); if (!r) return;
    wrapRef.current?.scrollTo({ left: r.x * zoom - 120, top: r.y * zoom - 100, behavior: "smooth" });
  };
  const startDrag = (e: ReactPointerEvent, p: Project, i: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = pos(p, i), sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const x = Math.max(0, Math.round(start.x + (ev.clientX - sx) / zoom)), y = Math.max(0, Math.round(start.y + (ev.clientY - sy) / zoom));
      setS((s) => (s ? { ...s, pos: { ...s.pos, [p.id]: { x, y } } } : s));
    };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up);
      update((s) => s); // save the final position
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
  };

  const all = [...rects.values()];
  const boardW = Math.max(...all.map((r) => r.x + r.w), 0) + 600;
  const boardH = Math.max(...all.map((r) => r.y + r.h), 0) + 500;

  const sidebarGroups: { group: Group | null; list: Project[] }[] = [
    ...S.groups.map((g) => ({ group: g, list: projects.filter((p) => S.member[p.id] === g.id) })),
    { group: null, list: projects.filter((p) => !groupOf(p.id)) },
  ];
  const saveLabel = { idle: "", saving: t("projects.saving"), saved: t("projects.saved"), error: t("projects.saveError") }[saveState];

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app" aria-label={t("projects.title")}>
      {/* barre du haut */}
      <header className="flex items-center gap-2 border-b border-hairline/40 px-4 py-2.5">
        <FolderTree size={16} className="shrink-0 text-ink-secondary" />
        <h1 className="mr-2 text-[14px] font-semibold text-ink">{t("projects.title")}</h1>
        <label className="flex h-8 max-w-[360px] flex-1 items-center gap-2 rounded-full bg-control px-3 text-ink-tertiary focus-within:ring-1 focus-within:ring-accent-border">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("projects.search")} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary" />
        </label>
        <div className="ml-auto flex items-center gap-1">
          <ToolButton onClick={() => setSourcesOpen(true)} label={t("projects.sources.button")}><Server size={15} /><span className="hidden md:inline">{t("projects.sources.button")}</span></ToolButton>
          <ToolButton onClick={arrange} label={t("projects.arrange")}><LayoutGrid size={15} /><span className="hidden md:inline">{t("projects.arrange")}</span></ToolButton>
          <ToolButton onClick={() => setZoom(zoom - 0.1)} label={t("projects.zoomOut")}><Minus size={15} /></ToolButton>
          <span className="w-10 text-center font-mono text-[12px] text-ink-tertiary">{Math.round(zoom * 100)}%</span>
          <ToolButton onClick={() => setZoom(zoom + 0.1)} label={t("projects.zoomIn")}><Plus size={15} /></ToolButton>
          <ToolButton onClick={() => void load()} label={t("projects.refresh")}><RefreshCw size={15} className={cn(loading && "animate-spin")} /></ToolButton>
          <ToolButton onClick={() => update((s) => ({ ...s, help: !s.help }))} label={t("projects.help.button")}><CircleHelp size={15} /></ToolButton>
          <CartographeButton bot={cartographe} onAsk={(bot) => askCartographe(bot, { prependDraft: prependComposerDraft, showChat: () => dispatch({ type: "showChat" }), openBot: (opened) => openBot(dispatch, opened, showThreads) })} />
          <span className={cn("ml-1 flex min-w-[90px] items-center justify-end gap-1.5 text-[12px]", saveState === "error" ? "text-danger" : "text-ink-tertiary")}>
            {saveLabel && <span className={cn("size-[7px] rounded-full", saveState === "error" ? "bg-danger" : saveState === "saving" ? "bg-warning" : "bg-success")} />}{saveLabel}
          </span>
        </div>
      </header>
      {mapChanged && <MapChangedNotice onClose={() => setMapChanged(false)} />}

      <div className="flex min-h-0 flex-1">
        {/* pôles */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-hairline/40 bg-panel">
          <div className="flex items-center justify-between px-4 pb-2 pt-4 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">
            {t("projects.poles")}
            <button className="ui-icon-button" aria-label={t("projects.pole.newTitle")} title={t("projects.pole.newTitle")} onClick={() => void newPole()}><Plus size={15} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {sidebarGroups.map(({ group, list }) => (
              <div key={group?.id ?? "none"} className="mb-1">
                <div className="group/pole flex h-8 items-center gap-2 rounded-lg px-2 hover:bg-raised">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: group?.color ?? "var(--color-hairline)" }} />
                  <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", group ? "text-ink" : "text-ink-secondary")}>{group?.name ?? t("projects.noPole")}</span>
                  <span className="font-mono text-[11.5px] text-ink-tertiary group-hover/pole:hidden">{list.length}</span>
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

        {mapOf && <ArchitectureView project={mapOf} onBack={() => setMapOf(null)} state={S} onSave={saveNow} />}
        {/* toile */}
        <div ref={wrapRef} className={cn("relative min-w-0 flex-1 overflow-auto", mapOf && "hidden")}
          style={{ backgroundImage: "linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px)", backgroundSize: "28px 28px" }}>
          {(data?.errors.length ?? 0) > 0 && (
            <div className="sticky left-0 top-0 z-10 flex flex-col gap-1.5 p-3">
              {data!.errors.map((e) => (
                <button key={e.sourceId} onClick={() => setSourcesOpen(true)}
                  className="flex max-w-[640px] items-start gap-2 rounded-xl border border-danger/30 bg-card px-3 py-2 text-left text-[13px] text-danger shadow-lg shadow-black/30 hover:border-danger/60">
                  <span className="font-medium">{t("projects.sourceError", { name: sourceLabel(e.sourceId) })}</span>
                  <span className="min-w-0 flex-1 text-ink-secondary">{e.message}</span>
                </button>
              ))}
            </div>
          )}
          {!projects.length && !loading && (
            <div className="absolute left-1/2 top-32 w-[340px] -translate-x-1/2 rounded-2xl border border-hairline/50 bg-card p-6 text-center">
              <FolderTree size={22} className="mx-auto text-ink-secondary" />
              <p className="mt-3 text-[14px] font-medium text-ink">{t("projects.empty.title")}</p>
              <p className="mt-1 text-[13px] text-ink-secondary">{t("projects.empty.text")}</p>
              <button onClick={() => setSourcesOpen(true)} className="mt-4 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110">{t("projects.sources.add")}</button>
            </div>
          )}
          <div className="relative" style={{ width: boardW, height: boardH, zoom }}>
            <svg className="pointer-events-none absolute inset-0 overflow-visible" width={boardW} height={boardH}>
              <defs>
                <marker id="pm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="#8a8a8a" /></marker>
              </defs>
              {S.groups.map((g) => {
                const zone = groupZone(projects.filter((p) => S.member[p.id] === g.id).map((p) => rects.get(p.id)!));
                if (!zone) return null;
                const { x, y } = zone;
                return (
                  <g key={g.id}>
                    <rect x={x} y={y} width={zone.w} height={zone.h} rx={22} fill={g.color} fillOpacity={0.05} stroke={g.color} strokeOpacity={0.35} strokeWidth={1.2} />
                    <rect x={x + 14} y={y + 14} width={g.name.length * 7.6 + 30} height={24} rx={12} fill={g.color} fillOpacity={0.16} />
                    <circle cx={x + 27} cy={y + 26} r={3.5} fill={g.color} />
                    <text x={x + 37} y={y + 30.5} fill={g.color} className="text-[13px] font-semibold">{g.name}</text>
                  </g>
                );
              })}
              {S.links.map((l, i) => {
                const A = rects.get(l.a), B = rects.get(l.b);
                if (!A || !B) return null;
                const [x1, y1] = edgePoint(A, B), [x2, y2] = edgePoint(B, A), mx = (x1 + x2) / 2, my = (y1 + y2) / 2, w = l.label.length * 6.6 + 20;
                return (
                  <g key={`${l.a}-${l.b}-${i}`}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5a5a5a" strokeWidth={1.6} strokeDasharray="6 4" markerEnd="url(#pm-arrow)" className="animate-link-flow" />
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} className="cursor-pointer" style={{ pointerEvents: "stroke" }} onClick={() => void deleteLink(l)}>
                      <title>{t("projects.link.hover")}</title>
                    </line>
                    {l.label && <>
                      <rect x={mx - w / 2} y={my - 11} width={w} height={22} rx={11} fill="var(--color-card)" stroke="var(--color-hairline)" />
                      <text x={mx} y={my + 4} textAnchor="middle" className="fill-ink-secondary text-[11.5px] font-medium">{l.label}</text>
                    </>}
                  </g>
                );
              })}
            </svg>

            {projects.map((p, i) => {
              const r = rects.get(p.id)!;
              const g = groupOf(p.id);
              const collapsed = Boolean(S.collapsed[p.id]);
              const hit = !q || p.name.toLowerCase().includes(q) || contains(p.tree, q);
              return (
                <div key={p.id} ref={measure} data-id={p.id}
                  className={cn("absolute rounded-[14px] border bg-card shadow-xl shadow-black/30 transition-[opacity,box-shadow]",
                    linkFrom === p.id ? "border-accent-border ring-[3px] ring-accent/25" : "border-hairline", !hit && "opacity-25")}
                  style={{ left: r.x, top: r.y, width: BLOCK_W }}>
                  <div className="flex cursor-grab touch-none select-none items-center gap-2.5 px-3.5 pb-2.5 pt-3 active:cursor-grabbing"
                    onPointerDown={(e) => startDrag(e, p, i)}>
                    <div className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-control text-[13px] font-semibold text-ink-secondary"
                      style={g ? { background: `${g.color}26`, color: g.color } : undefined}>
                      {p.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "·"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-semibold text-ink" title={p.name}><Highlight text={p.name} q={q} /></div>
                      <div className="truncate font-mono text-[11px] text-ink-tertiary">
                        {multiSource && `${sourceLabel(p.sourceId)} · `}{t("projects.counts", { dirs: p.dirs, files: p.files })}{p.truncated && "+"}
                      </div>
                    </div>
                    <ProjectBlockHeaderActions name={p.name} linking={linkFrom === p.id} collapsed={collapsed}
                      onMap={() => setMapOf(p)} onLink={() => void onLink(p.id)}
                      onFold={() => update((s) => { const c = { ...s.collapsed }; if (c[p.id]) delete c[p.id]; else c[p.id] = 1; return { ...s, collapsed: c }; })} />
                  </div>
                  <div className="relative px-3.5 pb-2.5">
                    <button onClick={() => setPoleMenu(poleMenu === p.id ? null : p.id)}
                      className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12px]", g ? "border-hairline text-ink" : "border-dashed border-hairline text-ink-tertiary hover:text-ink")}>
                      {g ? <span className="size-[7px] rounded-full" style={{ background: g.color }} /> : <Plus size={12} />}
                      {g ? g.name : t("projects.pole.choose")}
                    </button>
                    {poleMenu === p.id && (
                      <Menu onClose={() => setPoleMenu(null)}>
                        {S.groups.map((o) => <MenuRow key={o.id} onClick={() => { setPole(p.id, o.id); setPoleMenu(null); }}><span className="size-2 rounded-full" style={{ background: o.color }} />{o.name}</MenuRow>)}
                        {S.groups.length > 0 && <hr className="mx-1 my-1 border-hairline/40" />}
                        <MenuRow onClick={async () => { setPoleMenu(null); const ng = await newPole(); if (ng) setPole(p.id, ng.id); }}><Plus size={14} />{t("projects.pole.new")}</MenuRow>
                        {g && <MenuRow muted onClick={() => { setPole(p.id, null); setPoleMenu(null); }}><X size={14} />{t("projects.pole.remove")}</MenuRow>}
                      </Menu>
                    )}
                  </div>
                  {!collapsed && (
                    <div className="max-h-[330px] overflow-auto rounded-b-[13px] border-t border-hairline/40 bg-inset px-2 py-1.5 font-mono text-[12.5px]">
                      {p.tree.length ? <TreeList nodes={p.tree} q={q} /> : <div className={cn(rowCls, "italic text-ink-tertiary")}>{t("projects.emptyFolder")}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {linkFrom && (
        <div className="animate-pop-in fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink py-2 pl-4 pr-2 text-[13px] font-medium text-app shadow-xl">
          {t("projects.link.pick", { name: projects.find((p) => p.id === linkFrom)?.name ?? "" })}
          <button onClick={() => setLinkFrom(null)} className="rounded-full bg-black/10 px-2.5 py-1 text-[12px]">{t("projects.cancel")}</button>
        </div>
      )}

      {S.help && projects.length > 0 && (
        <div className="animate-pop-in fixed bottom-5 right-5 z-30 w-[300px] rounded-2xl border border-hairline bg-card p-4 shadow-xl shadow-black/40">
          <button className="ui-icon-button absolute right-2 top-2" aria-label={t("projects.close")} onClick={() => update((s) => ({ ...s, help: false }))}><X size={15} /></button>
          <h3 className="mb-3 text-[14px] font-semibold text-ink">{t("projects.help.title")}</h3>
          <ol className="flex flex-col gap-2.5">
            {(["projects.help.step1", "projects.help.step2", "projects.help.step3", "projects.help.step4"] as const).map((key, i) => (
              <li key={key} className="flex gap-2.5 text-[13px] leading-snug text-ink-secondary">
                <span className="grid size-[22px] shrink-0 place-items-center rounded-[7px] bg-control font-mono text-[12px] text-ink">{i + 1}</span>{t(key)}
              </li>
            ))}
          </ol>
        </div>
      )}

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

type CartographeBot = { id: string; threadId: string; mainThreadId?: string; tasks?: { threadId: string }[] };

/** Opens the Cartographe's chat with a request ready in its composer, ahead of anything typed there. Never sends it. */
export function askCartographe<B extends CartographeBot>(bot: B, deps: { prependDraft: (id: string, text: string) => void; showChat: () => void; openBot: (bot: B) => void }): void {
  deps.prependDraft(`bot:${bot.id}:${bot.threadId}`, t("projects.cartographe.draft"));
  deps.showChat();
  deps.openBot(bot);
}

export function CartographeButton<B extends CartographeBot>({ bot, onAsk }: { bot: B | null; onAsk: (bot: B) => void }) {
  if (!bot) return null;
  return <ToolButton onClick={() => onAsk(bot)} label={t("projects.cartographe.ask")}><Sparkles size={15} /><span className="hidden md:inline">{t("projects.cartographe.ask")}</span></ToolButton>;
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

function SourceIcon({ kind, size }: { kind: Source["kind"]; size: number }) {
  const Icon = kind === "ssh" ? Server : kind === "github" ? Github : HardDrive;
  return <Icon size={size} className="shrink-0 text-ink-secondary" />;
}

function ToolButton({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-ink-secondary hover:bg-raised-hover hover:text-ink">
      {children}
    </button>
  );
}

function Menu({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const id = setTimeout(() => window.addEventListener("pointerdown", onDown));
    return () => { clearTimeout(id); window.removeEventListener("pointerdown", onDown); };
  }, [onClose]);
  return <div ref={ref} className="animate-pop-in absolute left-3 top-8 z-20 min-w-[200px] rounded-[14px] border border-hairline bg-card p-1.5 shadow-xl shadow-black/40">{children}</div>;
}

function MenuRow({ onClick, muted, children }: { onClick: () => void; muted?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex h-8 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13px] hover:bg-menu-hover", muted ? "text-ink-secondary" : "text-ink")}>
      {children}
    </button>
  );
}
