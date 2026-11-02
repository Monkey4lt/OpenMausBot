import { Fragment } from "react";
import { Hand, MousePointer2, NotebookPen, Pencil, Plus, Search, Square, Type, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Tool } from "@/lib/canvas/gestures";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

const TOOLS: { tool: Tool; icon: LucideIcon; label: LocaleKey }[] = [
  { tool: "select", icon: MousePointer2, label: "atelier.canvas.tool.select" },
  { tool: "hand", icon: Hand, label: "atelier.canvas.tool.hand" },
  { tool: "pencil", icon: Pencil, label: "atelier.canvas.tool.pencil" },
  { tool: "sticky", icon: NotebookPen, label: "atelier.canvas.tool.sticky" },
  { tool: "shape", icon: Square, label: "atelier.canvas.tool.shape" },
  { tool: "text", icon: Type, label: "atelier.canvas.tool.text" },
];
const NAVIGATE: Tool[] = ["select", "hand"];

const button = "grid size-8 place-items-center rounded-[9px] focus-visible:outline-2 focus-visible:outline-focus";
const divider = <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-hairline" />;

/** Bottom-centre pill: navigation tools | drawing tools | search, then the light add button. */
export function Toolbar({ tool, onTool, tools, search, onAdd, addLabel }: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** The tools offered; all of them by default (a read-only canvas passes only select and hand). */
  tools?: Tool[];
  search?: () => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  const shown = TOOLS.filter((item) => !tools || tools.includes(item.tool));
  const groups = [shown.filter((item) => NAVIGATE.includes(item.tool)), shown.filter((item) => !NAVIGATE.includes(item.tool))].filter((group) => group.length > 0);
  return <div role="toolbar" aria-label={t("atelier.canvas.toolbar")}
    className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[14px] border border-hairline/70 bg-panel p-1 [scrollbar-width:none]">
    {groups.map((group, index) => <Fragment key={index}>
      {index > 0 && divider}
      {group.map(({ tool: item, icon: Icon, label }) => <button key={item} type="button" aria-pressed={tool === item} aria-label={t(label)} title={t(label)}
        className={cn(button, tool === item ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/60 hover:text-ink")}
        onClick={() => onTool(item)}><Icon size={16} strokeWidth={1.75} /></button>)}
    </Fragment>)}
    {search && <>
      {groups.length > 0 && divider}
      <button type="button" aria-label={t("atelier.canvas.search")} title={t("atelier.canvas.search")}
        className={cn(button, "text-ink-secondary hover:bg-control/60 hover:text-ink")} onClick={search}><Search size={16} strokeWidth={1.75} /></button>
    </>}
    {onAdd && <button type="button" onClick={onAdd}
      className="ml-1 flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-ink px-3 text-[13px] font-medium text-app hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
      <Plus size={14} strokeWidth={2} />{addLabel ?? t("atelier.canvas.addBlock")}
    </button>}
  </div>;
}
