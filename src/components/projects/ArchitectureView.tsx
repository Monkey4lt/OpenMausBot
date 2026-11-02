import { ArrowLeft, ChevronRight, File, Loader2, Pencil, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  FAMILY_COLORS, FAMILY_ORDER, MAX_READ_FILES, edgeCurve, edgeWidth, layoutLevel, levelOf, moduleLabel, withFamilyName, withModuleFamily,
  type Architecture, type ArchOverrides, type Family, type LevelNode,
} from "@/lib/projects-architecture-view";
import { api } from "@/state/api";
import type { LocaleKey } from "@/locales";

type Focus = { family?: Family; module?: string };
type SavedState = { overrides?: Record<string, ArchOverrides> };

const NODE = { perRow: 4, w: 220, h: 88, gapX: 90, gapY: 80, x0: 40, y0: 40 };

export function familyLabel(arch: Architecture, family: Family): string {
  const name = arch.families.find((f) => f.id === family)?.name;
  return name && name !== family ? name : t(`projects.map.family.${family}` as LocaleKey);
}

export function ArchitectureView<S extends SavedState>({ project, onBack, state, onSave, initial, initialFocus = {}, initialFile = null }: {
  project: { id: string; name: string };
  onBack: () => void;
  /** The page's current saved layout; a move or rename is applied to it and handed to onSave, which writes it at once. */
  state?: S | null;
  onSave?: (next: S) => Promise<void>;
  initial?: Architecture;
  initialFocus?: Focus;
  initialFile?: string | null;
}) {
  const [arch, setArch] = useState<Architecture | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(initialFocus);
  const [file, setFile] = useState<string | null>(initialFile);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Family | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setArch(await api<Architecture>(`/api/projects/architecture?id=${encodeURIComponent(project.id)}`, { timeoutMs: 180_000 }));
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

  const crumbs: { label: string; onClick?: () => void }[] = [{ label: project.name, onClick: focus.family ? () => { setFocus({}); setFile(null); } : undefined }];
  if (arch && focus.family) crumbs.push({ label: familyLabel(arch, focus.family), onClick: focus.module ? () => { setFocus({ family: focus.family }); setFile(null); } : undefined });
  if (focus.module) crumbs.push({ label: moduleLabel(focus.module) });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline/40 px-4 py-2">
        <button type="button" onClick={onBack} className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-ink-secondary hover:bg-raised-hover hover:text-ink">
          <ArrowLeft size={15} />{t("projects.map.back")}
        </button>
        <nav className="flex min-w-0 items-center gap-1 text-[13px]">
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-ink-tertiary" />}
              {c.onClick
                ? <button type="button" onClick={c.onClick} className="truncate rounded-md px-1.5 py-0.5 text-ink-secondary hover:bg-raised hover:text-ink">{c.label}</button>
                : <span className="truncate px-1.5 py-0.5 font-medium text-ink">{c.label}</span>}
            </span>
          ))}
        </nav>
        {arch && focus.family && !focus.module && (
          <button type="button" onClick={() => setRenaming(focus.family!)} title={t("projects.map.rename")} aria-label={t("projects.map.rename")}
            className="ml-1 grid size-7 place-items-center rounded-lg text-ink-tertiary hover:bg-raised-hover hover:text-ink"><Pencil size={14} /></button>
        )}
      </div>

      {arch?.truncated && (
        <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[13px] text-ink">
          <TriangleAlert size={15} className="shrink-0 text-warning" />{t("projects.map.truncated", { limit: MAX_READ_FILES })}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 border-b border-danger/30 px-4 py-2 text-[13px] text-danger">
          {t("projects.map.error", { message: error })}
          <button type="button" onClick={() => void load()} className="rounded-md px-2 py-1 text-ink-secondary hover:bg-raised hover:text-ink">{t("projects.map.retry")}</button>
        </div>
      )}

      {!arch && !error && (
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-secondary">
          <Loader2 size={16} className="animate-spin" />{t("projects.map.loading")}
        </div>
      )}

      {arch && (
        <div className="flex min-h-0 flex-1">
          <MapCanvas arch={arch} focus={focus} menu={menu} setMenu={setMenu} onMove={moveModule}
            onOpen={(id) => { setFile(null); setFocus(focus.family ? { family: focus.family, module: id } : { family: id as Family }); }} />
          {focus.module && <FilePanel arch={arch} module={focus.module} file={file} onPick={setFile} />}
        </div>
      )}

      {renaming && arch && <RenameDialog current={familyLabel(arch, renaming)} onDone={(name) => (name === null ? setRenaming(null) : renameFamily(renaming, name))} />}
    </div>
  );
}

function MapCanvas({ arch, focus, menu, setMenu, onMove, onOpen }: {
  arch: Architecture; focus: Focus; menu: string | null; setMenu: (id: string | null) => void;
  onMove: (moduleId: string, family: Family) => void; onOpen: (id: string) => void;
}) {
  const level = levelOf(arch, focus.module ? { family: focus.family } : focus);
  const rects = layoutLevel(level, NODE);
  const twoWay = new Set(level.edges.map((e) => `${e.from}->${e.to}`));
  const all = Object.values(rects);
  const width = Math.max(...all.map((r) => r.x + r.w), 0) + 80;
  const height = Math.max(...all.map((r) => r.y + r.h), 0) + 80;
  const colorOf = (node: LevelNode) => FAMILY_COLORS[focus.family ?? (node.id as Family)] ?? FAMILY_COLORS.other;
  const atTop = !focus.family;
  return (
    <div className="relative min-w-0 flex-1 overflow-auto"
      style={{ backgroundImage: "linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px)", backgroundSize: "28px 28px" }}>
      {!level.nodes.length && <p className="p-8 text-[13px] text-ink-tertiary">{t("projects.map.empty")}</p>}
      <div className="relative" style={{ width, height }}>
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height}>
          <defs>
            <marker id="pa-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="#8a8a8a" /></marker>
          </defs>
          {level.edges.map((e) => {
            const A = rects[e.from], B = rects[e.to];
            if (!A || !B) return null;
            const { d, label } = edgeCurve(A, B, twoWay.has(`${e.to}->${e.from}`) || A.x === B.x ? 36 : 0);
            return (
              <g key={`${e.from}->${e.to}`} data-edge={`${e.from}->${e.to}`}>
                <path d={d} fill="none" stroke="#5a5a5a" strokeWidth={edgeWidth(e.weight)} strokeDasharray="6 4" markerEnd="url(#pa-arrow)" className="animate-link-flow" />
                <text x={label[0]} y={label[1] - 6} textAnchor="middle" className="fill-ink-tertiary font-mono text-[11px]">{e.weight}</text>
              </g>
            );
          })}
        </svg>
        {level.nodes.map((node) => {
          const r = rects[node.id];
          const color = colorOf(node);
          const label = atTop ? familyLabel(arch, node.id as Family) : node.label;
          return (
            <div key={node.id} data-node={node.id} className="absolute rounded-[14px] border border-hairline bg-card shadow-xl shadow-black/30"
              style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
              <button type="button" onClick={() => onOpen(node.id)} title={atTop ? label : node.id}
                className={cn("flex h-full w-full items-center gap-3 rounded-[14px] px-3.5 text-left hover:bg-raised-hover", focus.family && !focus.module && "pb-6")}>
                <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] text-[13px] font-semibold" style={{ background: `${color}26`, color }}>
                  {label.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "·"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold text-ink">{label}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-tertiary">{t("projects.map.files", { count: node.files })}</span>
                </span>
              </button>
              {focus.family && !focus.module && (
                <div className="absolute bottom-2 left-[58px]">
                  <button type="button" onClick={() => setMenu(menu === node.id ? null : node.id)}
                    className="rounded-full border border-hairline px-2 py-0.5 text-[11.5px] text-ink-secondary hover:bg-raised hover:text-ink">{t("projects.map.moveTo")}</button>
                  {menu === node.id && (
                    <div className="animate-pop-in absolute left-0 top-7 z-20 min-w-[180px] rounded-[14px] border border-hairline bg-card p-1.5 shadow-xl shadow-black/40">
                      {FAMILY_ORDER.filter((f) => f !== focus.family).map((f) => (
                        <button key={f} type="button" onClick={() => onMove(node.id, f)}
                          className="flex h-8 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13px] text-ink hover:bg-menu-hover">
                          <span className="size-2 rounded-full" style={{ background: FAMILY_COLORS[f] }} />{familyLabel(arch, f)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {atTop && arch.external.length > 0 && (
        <section className="sticky bottom-0 left-0 border-t border-hairline/40 bg-panel/95 px-4 py-3">
          <h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">{t("projects.map.external")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {arch.external.map((e) => (
              <span key={e.name} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-hairline bg-card px-2.5 font-mono text-[12px] text-ink-secondary">
                {e.name}<span className="text-ink-tertiary">{e.count}</span>
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
      <h3 className="px-4 pb-2 pt-4 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">{t("projects.map.fileList", { name: moduleLabel(module) })}</h3>
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
