import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_VIEW, type View } from "@/lib/canvas/geometry";
import { parseStoredView } from "@/lib/canvas/gestures";

/** The view remembered under `key`, or null. */
export function readStoredView(key: string | undefined): View | null {
  if (!key) return null;
  try { return parseStoredView(globalThis.localStorage?.getItem(key)); } catch { return null; }
}

/** The view of a canvas, optionally remembered per viewer under `persistKey` (best effort: storage may be missing). */
export function useCanvasView(initial: View = DEFAULT_VIEW, persistKey?: string): [View, (view: View) => void] {
  const [view, setView] = useState<View>(() => readStoredView(persistKey) ?? initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!persistKey) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try { globalThis.localStorage?.setItem(persistKey, JSON.stringify(view)); } catch { /* private window, quota */ }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [persistKey, view]);
  const set = useCallback((next: View) => setView(next), []);
  return [view, set];
}
