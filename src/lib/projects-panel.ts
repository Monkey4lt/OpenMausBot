import { t } from "@/lib/i18n";

/** localStorage key holding whether this viewer keeps the Cartographe panel open on the Projects page. */
export const PANEL_KEY = "projects.cartographe.panel";
/** Below this window width the panel covers the map instead of sitting beside it. */
export const NARROW_PANEL_WIDTH = 900;

type PanelStorage = Pick<Storage, "getItem" | "setItem">;

export function readPanelOpen(storage: PanelStorage | null | undefined): boolean {
  try {
    return storage?.getItem(PANEL_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePanelOpen(storage: PanelStorage | null | undefined, open: boolean): void {
  try {
    storage?.setItem(PANEL_KEY, open ? "1" : "0");
  } catch {
    // A blocked storage only forgets the choice.
  }
}

/** The request put ahead of the Cartographe's draft: about the project open, or about all of them. */
export function panelDraft(context: { projectName?: string }): string {
  return context.projectName ? t("projects.cartographe.projectDraft", { name: context.projectName }) : t("projects.cartographe.draft");
}

export function panelLayout(windowWidth: number): { narrow: boolean; className: string } {
  const narrow = windowWidth < NARROW_PANEL_WIDTH;
  return {
    narrow,
    className: narrow
      ? "absolute inset-y-0 right-0 z-30 flex w-full max-w-[420px] flex-col border-l border-hairline/40 bg-panel shadow-2xl shadow-black/50"
      : "flex w-[420px] shrink-0 flex-col border-l border-hairline/40 bg-panel",
  };
}
