// Pure helpers for GoogleBaseMap (no DOM, no Google, no deck.gl), tested in Node.
import { roleOf } from './layers';
import { MAP_STYLE, NYC_CENTER, NYC_ZOOM } from './mapStyle';
import type { LatLngBounds, MapMover, MapPanTarget, MapPlace, MapStop } from './types';

export type MapStatus = 'missing-key' | 'loading' | 'ready' | 'error';

export const KEY_MISSING_TEXT = 'Google Maps key missing.';
export const LOAD_ERROR_TEXT = 'Google Maps could not be loaded';

/** The browser key from Vite env, or null. Never log or render the returned value. */
export function readBrowserKey(env: Record<string, unknown> | undefined): string | null {
  const raw = env?.VITE_GOOGLE_MAPS_BROWSER_KEY;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/** First status before any effect runs: no key ⇒ missing-key (and no network request). */
export function initialStatus(key: string | null): MapStatus {
  return key ? 'loading' : 'missing-key';
}

/** Options for the one google.maps.Map: light JSON style, reduced UI, no mapId. */
export function mapOptions() {
  return {
    center: NYC_CENTER,
    zoom: NYC_ZOOM,
    styles: MAP_STYLE,
    disableDefaultUI: true,
    zoomControl: true,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
    rotateControl: false,
    clickableIcons: false,
    gestureHandling: 'greedy',
    backgroundColor: '#F7F8FA',
  };
}

/** Bounds around the places, padded slightly; null when there are none. */
export function placesBounds(places: MapPlace[], pad = 0.005): LatLngBounds | null {
  const ok = places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (ok.length === 0) return null;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const p of ok) {
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);
  }
  return { north: north + pad, south: south - pad, east: east + pad, west: west - pad };
}

/**
 * Identity of a fit request. The map re-fits only when this changes, so a 1 s poll that delivers
 * new objects with the same places never moves the camera the user has panned.
 */
export function fitKey(fitTo: 'places' | LatLngBounds | undefined, places: MapPlace[]): string | null {
  if (!fitTo) return null;
  if (fitTo === 'places') {
    return places.length ? `places:${places.map((p) => p.id).sort().join(',')}` : null;
  }
  return `bounds:${fitTo.north},${fitTo.south},${fitTo.east},${fitTo.west}`;
}

export function resolveFit(fitTo: 'places' | LatLngBounds | undefined, places: MapPlace[]): LatLngBounds | null {
  if (!fitTo) return null;
  return fitTo === 'places' ? placesBounds(places) : fitTo;
}

/**
 * Whether to pan now. Pans once per new `panTo.key` (a re-render or poll with the same key does
 * nothing; neither does `panTo` being undefined, which also keeps the last key). `key` is the key to
 * remember afterwards; `target` is the point to pan to, or null. A non-finite point is consumed
 * without panning.
 */
export function panDecision(
  lastKey: string | null,
  panTo: MapPanTarget | undefined,
): { key: string | null; target: { lat: number; lng: number } | null } {
  if (!panTo || panTo.key === lastKey) return { key: lastKey, target: null };
  const ok = Number.isFinite(panTo.lat) && Number.isFinite(panTo.lng);
  return { key: panTo.key, target: ok ? { lat: panTo.lat, lng: panTo.lng } : null };
}

/**
 * The hover tooltip's text (name and role) for the selected item, so it is reachable without a
 * mouse: GoogleBaseMap puts it in a visually hidden live region. The first selected ID that is a
 * place, mover or stop wins (route IDs have no name of their own). Empty when nothing resolves.
 */
export function selectedItemText(
  selectedIds: readonly string[],
  places: MapPlace[],
  movers: MapMover[],
  stops: MapStop[] = [],
): string {
  for (const id of selectedIds) {
    const place = places.find((p) => p.id === id);
    if (place) {
      const role = place.sublabel ? `${roleOf(place.kind)} · ${place.sublabel}` : roleOf(place.kind);
      return `${place.label}, ${role}`;
    }
    const mover = movers.find((m) => m.id === id);
    if (mover) return `${mover.label}, ${roleOf(mover.kind)}`;
    const stop = stops.find((s) => s.id === id);
    if (stop) return `${stop.label}, Stop ${stop.n}`;
  }
  return '';
}
