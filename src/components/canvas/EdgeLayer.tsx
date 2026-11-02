import { bezierPath, edgeLabelPoint, type PortAnchor } from "@/lib/canvas/geometry";

export type CanvasEdge = {
  id: string;
  from: PortAnchor;
  to: PortAnchor;
  label?: string;
  /** Dashed unless false: the canvas draws its links as thin dashed curves. */
  dashed?: boolean;
  /** "accent" is kept for links between pieces of a project. */
  tone?: "default" | "accent";
};

const STROKE = { default: "color-mix(in srgb, var(--color-ink-secondary) 55%, transparent)", accent: "var(--color-accent)" };

/** Curved links in world coordinates; put it in the canvas `underlay` so blocks sit on top of it. */
export function EdgeLayer({ edges, onEdgeClick }: { edges: CanvasEdge[]; onEdgeClick?: (id: string) => void }) {
  return <>
    <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
      {edges.map((edge) => {
        const d = bezierPath(edge.from, edge.to);
        return <g key={edge.id} data-canvas-edge={edge.id}>
          <path data-edge-line d={d} fill="none" strokeWidth={1.25} strokeLinecap="round"
            strokeDasharray={edge.dashed === false ? undefined : "4 4"} style={{ stroke: STROKE[edge.tone ?? "default"] }} />
          {onEdgeClick && <path data-edge-hit d={d} fill="none" stroke="transparent" strokeWidth={14}
            className="cursor-pointer" style={{ pointerEvents: "stroke" }} onClick={() => onEdgeClick(edge.id)} />}
        </g>;
      })}
    </svg>
    {edges.map((edge) => {
      if (!edge.label) return null;
      const at = edgeLabelPoint(edge.from, edge.to);
      return <span key={edge.id} className="pointer-events-none absolute max-w-48 -translate-x-1/2 -translate-y-1/2 truncate whitespace-nowrap rounded-full border border-hairline bg-app px-2 py-0.5 text-[11px] text-ink-secondary"
        style={{ left: at.x, top: at.y }}>{edge.label}</span>;
    })}
  </>;
}
