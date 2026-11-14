import type { ReactNode } from 'react';
import type { Business, Graph, Hub } from '../../../shared/types';
import { computeViewBox, pointsAttr, placeLabels, projectNodes, roadSegments, routePoints } from './sim/mapGeometry';
import './sim/CityMap.css';

export type CityMapProps = {
  graph: Graph;
  businesses: Business[];
  hubs: Hub[];
  homes?: { employeeId: string; nodeId: string }[];
  highlightRoute?: string[];
  baselineRoute?: string[];
  /** One polyline per route; legs are never joined. Odd-indexed (relay second) legs get a dashed style. */
  highlightRoutes?: string[][];
  baselineRoutes?: string[][];
  selectedNodeId?: string;
  onNodeClick?: (nodeId: string) => void;
  children?: ReactNode; // extra SVG layer (markers etc.)
  className?: string;
  /** Accessible title for the whole map (default "City map"). */
  title?: string;
};

const PAD = 90;

export function CityMap({
  graph, businesses, hubs, homes = [], highlightRoute, baselineRoute, highlightRoutes, baselineRoutes,
  selectedNodeId, onNodeClick, children, className, title = 'City map',
}: CityMapProps) {
  const pos = projectNodes(graph.nodes);
  const vb = computeViewBox(graph.nodes, PAD);
  const segs = roadSegments(graph);
  const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? 'Intersection';
  const bizNodes = new Set(businesses.map((b) => b.nodeId));
  const hubNodes = new Set(hubs.map((h) => h.nodeId));
  const safeRoute = (r?: string[]) => {
    if (!r || r.length < 2) return null;
    try { return pointsAttr(routePoints(graph, r)); } catch { return null; }
  };
  const base = safeRoute(baselineRoute);
  const hi = safeRoute(highlightRoute);
  const baseMany = (baselineRoutes ?? []).map(safeRoute);
  const hiMany = (highlightRoutes ?? []).map(safeRoute);
  const clickable = !!onNodeClick;
  const routedNodes = new Set([...(highlightRoute ?? []), ...(highlightRoutes ?? []).flat()]);
  const labelItems = [
    ...hubs.flatMap((h) => { const p = pos.get(h.nodeId); return p ? [{ id: h.id, x: p.x, y: p.y, text: h.name }] : []; }),
    ...businesses.flatMap((b) => { const p = pos.get(b.nodeId); return p ? [{ id: b.id, x: p.x, y: p.y, text: b.name }] : []; }),
  ];
  const placed = new Map(placeLabels(labelItems).map((l) => [l.id, l]));
  const hasRoute = !!hi || hiMany.some(Boolean);
  const lw = 300;
  const lh = 232;
  const lx = vb.x + 12;
  const ly = vb.y + vb.height - lh - 12;

  return (
    <svg
      className={['city-map', className].filter(Boolean).join(' ')}
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <g>
        {segs.map((s) => (
          <line key={`${s.from}-${s.to}`} className="road" x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} />
        ))}
      </g>
      {base && <polyline className="route-base" points={base} />}
      {baseMany.map((pts, i) => pts && <polyline key={`bm${i}`} className="route-base route-base-leg" points={pts} />)}
      {hi && <polyline className="route-hi" points={hi} />}
      {hiMany.map((pts, i) => pts && (
        <polyline key={`hm${i}`} className={`route-hi route-hi-leg${i % 2 ? ' route-hi-alt' : ''}`} points={pts} />
      ))}

      {clickable && (
        <g>
          {graph.nodes.map((n) => {
            const p = pos.get(n.id)!;
            const sel = n.id === selectedNodeId;
            return (
              <circle
                key={n.id}
                className={`node node-click${sel ? ' node-selected' : ''}`}
                cx={p.x} cy={p.y} r={sel ? 14 : 11}
                tabIndex={0}
                role="button"
                aria-label={labelOf(n.id)}
                aria-pressed={sel}
                onClick={() => onNodeClick(n.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNodeClick(n.id); }
                }}
              >
                <title>{labelOf(n.id)}</title>
              </circle>
            );
          })}
        </g>
      )}

      <g>
        {hubs.map((h) => {
          const p = pos.get(h.nodeId);
          if (!p) return null;
          return (
            <g key={h.id}>
              {routedNodes.has(h.nodeId) && <circle className="hub-ring" cx={p.x} cy={p.y} r={34} />}
              <circle className="hub" cx={p.x} cy={p.y} r={20}><title>{h.name}</title></circle>
              <text className={routedNodes.has(h.nodeId) ? 'label-hub label-strong' : 'label-hub'} x={placed.get(h.id)?.x ?? p.x} y={placed.get(h.id)?.y ?? p.y + 44} textAnchor={placed.get(h.id)?.anchor ?? 'middle'}>{h.name}</text>
            </g>
          );
        })}
        {businesses.map((b) => {
          const p = pos.get(b.nodeId);
          if (!p) return null;
          return (
            <g key={b.id}>
              <g transform={`translate(${p.x - 16} ${p.y - 16})`}>
                <rect className="biz" width={32} height={32} rx={4} />
                <rect x={7} y={7} width={6} height={6} fill="#f8fafc" />
                <rect x={19} y={7} width={6} height={6} fill="#f8fafc" />
                <rect x={7} y={19} width={6} height={6} fill="#f8fafc" />
                <rect x={19} y={19} width={6} height={6} fill="#f8fafc" />
                <title>{b.name}</title>
              </g>
              <text className="label-biz" x={placed.get(b.id)?.x ?? p.x} y={placed.get(b.id)?.y ?? p.y + 44} textAnchor={placed.get(b.id)?.anchor ?? 'middle'}>{b.name}</text>
            </g>
          );
        })}
        {homes.map((h) => {
          const p = pos.get(h.nodeId);
          if (!p || bizNodes.has(h.nodeId) || hubNodes.has(h.nodeId)) return null;
          return (
            <polygon
              key={h.employeeId}
              className="home"
              points={`${p.x},${p.y - 11} ${p.x + 11},${p.y} ${p.x + 8},${p.y + 9} ${p.x - 8},${p.y + 9} ${p.x - 11},${p.y}`}
            >
              <title>{`Home: ${labelOf(h.nodeId)}`}</title>
            </polygon>
          );
        })}
      </g>

      {children}

      <g role="group" aria-label="Legend" className="legend">
        <rect className="legend-bg" x={lx} y={ly} width={lw} height={lh} rx={8} />
        <line className="road" x1={lx + 12} x2={lx + 40} y1={ly + 22} y2={ly + 22} />
        <text x={lx + 52} y={ly + 29}>Road</text>
        <rect className="biz" x={lx + 16} y={ly + 46} width={20} height={20} rx={3} />
        <text x={lx + 52} y={ly + 63}>Business</text>
        {hubs.length > 0 ? (
          <>
            <circle className="hub" cx={lx + 26} cy={ly + 92} r={10} />
            <text x={lx + 52} y={ly + 99}>Hub</text>
          </>
        ) : (
          <text className="legend-muted" x={lx + 12} y={ly + 99}>No hubs in this city</text>
        )}
        <polygon className="home" points={`${lx + 26},${ly + 114} ${lx + 36},${ly + 124} ${lx + 33},${ly + 134} ${lx + 19},${ly + 134} ${lx + 16},${ly + 124}`} />
        <text x={lx + 52} y={ly + 134}>Home</text>
        <circle className="legend-vehicle" cx={lx + 26} cy={ly + 158} r={10} />
        <text x={lx + 52} y={ly + 165}>Vehicle</text>
        <line className="legend-route" x1={lx + 12} x2={lx + 40} y1={ly + 188} y2={ly + 188} />
        <text x={lx + 52} y={ly + 195}>{hasRoute ? 'Selected route' : 'Selected route (leg 1)'}</text>
        <line className="legend-route legend-route-alt" x1={lx + 12} x2={lx + 40} y1={ly + 212} y2={ly + 212} />
        <text x={lx + 52} y={ly + 219}>Relay leg 2 (dashed)</text>
      </g>
    </svg>
  );
}

export default CityMap;
