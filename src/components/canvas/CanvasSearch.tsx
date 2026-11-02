import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Rect } from "@/lib/canvas/geometry";
import { t } from "@/lib/i18n";

export type CanvasSearchItem = { id: string; label: string; rect: Rect; kind?: string };

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Items whose label holds every word of `query`, accents and case aside; labels that start with the query come first. */
export function matchCanvasItems<T extends CanvasSearchItem>(items: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = items.filter((item) => { const label = fold(item.label); return words.every((word) => label.includes(word)); });
  const head = fold(query.trim());
  return hits.map((item, index) => ({ item, index, first: fold(item.label).startsWith(head) ? 0 : 1 }))
    .sort((a, b) => a.first - b.first || a.index - b.index).map((hit) => hit.item);
}

const MAX_SHOWN = 8;

/** "Find a block": a box over the canvas listing what matches; Enter or a click picks. */
export function CanvasSearch({ items, onPick, onClose, placeholder = t("atelier.search.placeholder") }: { items: CanvasSearchItem[]; onPick: (id: string) => void; onClose: () => void; placeholder?: string }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const hits = matchCanvasItems(items, query).slice(0, MAX_SHOWN);

  useEffect(() => {
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [onClose]);

  const pick = (id: string | undefined) => { if (id) { onPick(id); onClose(); } };
  return <div ref={box} role="search" data-canvas-chrome className="pointer-events-auto w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-[14px] border border-hairline/80 bg-panel">
    <label className="flex h-10 items-center gap-2 px-3 text-ink-tertiary">
      <Search size={15} className="shrink-0" />
      <input autoFocus value={query} placeholder={placeholder} aria-label={placeholder}
        onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
          if (event.key === "Enter") { event.preventDefault(); pick(hits[active]?.id); }
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
        }}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary" />
      <button type="button" onClick={onClose} aria-label={t("atelier.search.close")} title={t("atelier.search.close")}
        className="grid size-6 place-items-center rounded-md text-ink-tertiary hover:bg-control hover:text-ink"><X size={14} /></button>
    </label>
    {query.trim() && <ul role="listbox" aria-label={placeholder} className="border-t border-hairline/60 p-1">
      {hits.map((item, index) => <li key={item.id} role="option" aria-selected={index === active}>
        <button type="button" onClick={() => pick(item.id)} onPointerMove={() => setActive(index)}
          className={cn("flex h-8 w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-[13px]", index === active ? "bg-control text-ink" : "text-ink-secondary")}>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.kind && <span className="shrink-0 text-[12px] text-ink-tertiary">{item.kind}</span>}
        </button>
      </li>)}
      {!hits.length && <li className="px-2.5 py-2 text-[13px] text-ink-tertiary">{t("atelier.search.none")}</li>}
    </ul>}
  </div>;
}
