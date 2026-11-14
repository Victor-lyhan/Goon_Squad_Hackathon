import { useEffect, useState } from 'react';
import type { Clock, Graph, Snapshot } from '../../../../shared/types';
import { pointProjector } from './mapGeometry';
import {
  REDUCED_MOTION_QUERY, advanceFrames, clampAlpha, framePositions, initialFrames, type FrameState,
} from './markerTween';
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
  const [stored, setFrames] = useState<FrameState<Frame>>(() => initialFrames(snapshot));

  // Pick the frames during render (React's "adjust state while rendering" pattern), so the first
  // paint with a new snapshot already shows the old positions. advanceFrames is pure and returns
  // the same state for the same snapshot object, so this runs once per poll.
  let frames = stored;
  if (stored.next !== snapshot) {
    frames = advanceFrames(stored, snapshot, clock, reducedMotion);
    setFrames(frames);
  }

  // Drive alpha 0 → 1 for the snapshot being tweened to. Cancelled on unmount and when a newer
  // snapshot replaces frames.next.
  const target = frames.next;
  const tweening = frames.tween;
  useEffect(() => {
    if (!tweening) return;
    const setAlpha = (a: number) => setFrames((f) => (f.next === target && f.alpha !== a ? { ...f, alpha: a } : f));
    if (typeof requestAnimationFrame !== 'function') { setAlpha(1); return; }
    const start = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      const a = clampAlpha((now - start) / pollMs);
      setAlpha(a);
      if (a < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, tweening, pollMs]);

  const project = pointProjector(graph.nodes);
  const { markers, packagePositions: packages } = framePositions(frames, reducedMotion);

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
