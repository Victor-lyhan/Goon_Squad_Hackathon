import { useEffect, useRef, useState } from 'react';
import type { Clock, Graph, Snapshot } from '../../../../shared/types';
import { pointProjector } from './mapGeometry';
import { REDUCED_MOTION_QUERY, shouldSnap, shouldTween, tweenMarkers, tweenPackages } from './markerTween';
import './MapMarkers.css';

export type MapMarkersProps = {
  graph: Graph;
  snapshot: Pick<Snapshot, 'runId' | 'timeMin' | 'markers' | 'packagePositions'>;
  clock: Pick<Clock, 'speed'>;
  /** Real ms between polls; the tween runs over this span. */
  pollMs?: number;
  /** Friendly names for tooltips and screen readers; ids are never shown. */
  shipmentLabels?: Record<string, string>;
  employeeNames?: Record<string, string>;
};

type Frame = Pick<Snapshot, 'runId' | 'timeMin' | 'markers' | 'packagePositions'>;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia(REDUCED_MOTION_QUERY).matches;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

export function MapMarkers({ graph, snapshot, clock, pollMs = 1000, shipmentLabels = {}, employeeNames = {} }: MapMarkersProps) {
  const pkgName = (id: string) => shipmentLabels[id] ?? 'package';
  const reducedMotion = useReducedMotion();
  const [alpha, setAlpha] = useState(1);
  const prevRef = useRef<Frame>(snapshot);
  const nextRef = useRef<Frame>(snapshot);

  // New snapshot arrived: the displayed frame becomes the previous one (unless snapping).
  useEffect(() => {
    if (nextRef.current === snapshot) return;
    const last = nextRef.current;
    nextRef.current = snapshot;
    prevRef.current = last;
    if (!shouldTween(reducedMotion) || shouldSnap(last, snapshot, clock)) {
      prevRef.current = snapshot;
      setAlpha(1);
      return;
    }
    setAlpha(0);
    if (typeof requestAnimationFrame !== 'function') { setAlpha(1); return; }
    const start = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      const a = Math.min(1, (now - start) / pollMs);
      setAlpha(a);
      if (a < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [snapshot, clock, pollMs, reducedMotion]);

  const project = pointProjector(graph.nodes);
  const prev = prevRef.current;
  const next = snapshot;
  const markers = tweenMarkers(prev.markers, next.markers, alpha, reducedMotion);
  const packages = tweenPackages(prev.packagePositions, next.packagePositions, alpha, reducedMotion);

  return (
    <g className="map-markers">
      {Object.entries(packages).map(([id, raw]) => {
        const p = project(raw);
        return (
          <rect
            key={id}
            className="marker-package"
            x={p.x - 7} y={p.y - 7} width={14} height={14} rx={2}
            aria-label={`Package: ${pkgName(id)}`}
          >
            <title>{`Package: ${pkgName(id)}`}</title>
          </rect>
        );
      })}
      {markers.map((m) => {
        const p = project(m);
        const label = `Carrier ${employeeNames[m.employeeId] ?? ''}`.trim() + `${m.carryingShipmentId ? `, carrying ${pkgName(m.carryingShipmentId)}` : ''}${m.servicing ? ', servicing' : ''}`;
        return (
          <g key={m.employeeId} role="img" aria-label={label}>
            {m.servicing && <circle className="marker-ring" cx={p.x} cy={p.y} r={22} />}
            <circle className={`marker-vehicle${m.carryingShipmentId ? ' carrying' : ''}`} cx={p.x} cy={p.y} r={13} />
            <title>{label}</title>
          </g>
        );
      })}
    </g>
  );
}

export default MapMarkers;
