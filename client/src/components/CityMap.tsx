import type { ReactNode } from 'react';
import type { Business, Graph, Hub } from '../../../shared/types';
import { computeViewBox, pointsAttr, projectNodes, roadSegments, routePoints } from './sim/mapGeometry';
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
};

const PAD = 90;

export function CityMap({
  graph, businesses, hubs, homes = [], highlightRoute, baselineRoute, highlightRoutes, baselineRoutes,
  selectedNodeId, onNodeClick, children, className,
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
  const lx = vb.x + 12;
  const ly = vb.y + vb.height - 100;

  return (
    <svg
      className={['city-map', className].filter(Boolean).join(' ')}
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="City map"
    >
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
              <circle className="hub" cx={p.x} cy={p.y} r={20}><title>{h.name}</title></circle>
              <text x={p.x} y={p.y - 28} textAnchor="middle">{h.name}</text>
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
              <text x={p.x} y={p.y + 38} textAnchor="middle">{b.name}</text>
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

      <g aria-label="Legend">
        <rect className="legend-bg" x={lx} y={ly} width={260} height={88} rx={6} />
        <rect className="biz" x={lx + 12} y={ly + 10} width={14} height={14} rx={2} />
        <text x={lx + 36} y={ly + 23}>Business</text>
        {hubs.length > 0 ? (
          <>
            <circle className="hub" cx={lx + 19} cy={ly + 45} r={8} />
            <text x={lx + 36} y={ly + 52}>Hub</text>
          </>
        ) : (
          <text className="legend-muted" x={lx + 12} y={ly + 52}>No hubs in this city</text>
        )}
        <circle className="home" cx={lx + 19} cy={ly + 72} r={7} />
        <text x={lx + 36} y={ly + 79}>Home</text>
        <line className="legend-route" x1={lx + 130} x2={lx + 160} y1={ly + 20} y2={ly + 20} />
        <text x={lx + 168} y={ly + 26}>Route</text>
      </g>
    </svg>
  );
}

export default CityMap;
