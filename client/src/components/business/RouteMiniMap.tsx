import { useEffect, useState } from 'react';
import type { MapResponse } from '../../../../shared/api';
import { getMap } from '../../api';
import { buildRouteMap, type MiniMapInput, type RouteMapModel } from './routeMapModel';

// One fetch per runId: later mounts reuse the cached map (a new run replaces it).
let cache: MapResponse | null = null;
let inflight: Promise<MapResponse> | null = null;

function loadMap(runId?: string): Promise<MapResponse> {
  if (cache && (!runId || cache.runId === runId)) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getMap().then((m) => { cache = m; return m; }).finally(() => { inflight = null; });
  }
  return inflight;
}

/** Test hook: forget the cached map. */
export function resetRouteMapCache() { cache = null; inflight = null; }

export type RouteMiniMapProps = MiniMapInput & {
  runId?: string;
  /** Pre-loaded map (skips fetching). */
  map?: MapResponse | null;
  className?: string;
};

export function RouteMiniMap({ runId, map: given, className, ...input }: RouteMiniMapProps) {
  const [fetched, setFetched] = useState<MapResponse | null>(cache);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (given) return;
    let live = true;
    loadMap(runId).then((m) => { if (live) { setFetched(m); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [given, runId]);
  const map = given ?? fetched;
  if (!map) return <p className="route-mini-map__note">{failed ? 'Map unavailable.' : 'Loading map…'}</p>;
  const built = buildRouteMap(map, input);
  const cls = ['route-mini-map', className].filter(Boolean).join(' ');
  if (!built.ok) return <p className={`${cls} route-mini-map__note`} role="status">{built.reason}</p>;
  return (
    <div className={cls}>
      <RouteSvg model={built.model} />
      <p className="route-mini-map__caption">{built.model.caption}</p>
    </div>
  );
}

const MARK = 48; // business marker size, viewBox units (>= 11 px at 390 px wide)
const HUB_R = 30;

function anchorFor(x: number, vb: RouteMapModel['viewBox']): 'start' | 'middle' | 'end' {
  if (x - vb.x < 190) return 'start';
  if (vb.x + vb.width - x < 190) return 'end';
  return 'middle';
}

function RouteSvg({ model }: { model: RouteMapModel }) {
  const { viewBox: vb } = model;
  const pts = (ps: { x: number; y: number }[]) => ps.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <svg
      className="route-map route-mini-map__svg"
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={model.summary}
    >
      <title>{model.summary}</title>
      <g>{model.roads.map((r, i) => <line key={i} className="road" x1={r.a.x} y1={r.a.y} x2={r.b.x} y2={r.b.y} />)}</g>
      {model.legs.map((l) => (
        <polyline key={l.index} className={`route-hi route-hi-leg${l.dashed ? ' route-hi-alt' : ''}`} points={pts(l.points)}>
          <title>{`Leg ${l.index + 1}: ${l.names}`}</title>
        </polyline>
      ))}
      {model.markers.map((m) => (
        <g key={m.id}>
          {m.kind === 'hub'
            ? <circle className="hub" cx={m.at.x} cy={m.at.y} r={HUB_R}><title>{m.name}</title></circle>
            : <rect className="biz" x={m.at.x - MARK / 2} y={m.at.y - MARK / 2} width={MARK} height={MARK} rx={6}><title>{m.name}</title></rect>}
          <text x={m.at.x} y={m.kind === 'hub' ? m.at.y - HUB_R - 14 : m.at.y + MARK / 2 + 40} textAnchor={anchorFor(m.at.x, vb)}>{m.name}</text>
        </g>
      ))}
      {model.legs.length > 1 && model.legs.map((l) => (
        <g key={`n${l.index}`} aria-hidden="true">
          <circle className="leg-badge" cx={l.label.x} cy={l.label.y} r={24} />
          <text className="leg-badge-text" x={l.label.x} y={l.label.y + 12} textAnchor="middle">{l.index + 1}</text>
        </g>
      ))}
    </svg>
  );
}
