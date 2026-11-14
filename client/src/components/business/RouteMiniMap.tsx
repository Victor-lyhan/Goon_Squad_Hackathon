import { useEffect, useState } from 'react';
import type { MapResponse } from '../../../../shared/api';
import { getMap } from '../../api';
import { CityMap } from '../CityMap';
import { miniMapProps, type MiniMapInput } from './routeMapModel';

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
  return (
    <div className={['route-mini-map', className].filter(Boolean).join(' ')}>
      <CityMap {...miniMapProps(map, input)} className="route-mini-map__svg" />
    </div>
  );
}
