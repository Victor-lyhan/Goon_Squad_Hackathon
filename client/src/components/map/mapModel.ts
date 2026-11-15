// Pure helpers for GoogleBaseMap (no DOM, no Google, no deck.gl), tested in Node.
import { roleOf } from './layers';
import { MAP_STYLE, NYC_CENTER, NYC_ZOOM } from './mapStyle';
import type { LatLngBounds, MapMover, MapPanTarget, MapPlace, MapStop } from './types';

export type MapStatus = 'missing-key' | 'loading' | 'ready' | 'error' | 'auth-error';

export const KEY_MISSING_TEXT = 'Google Maps key missing.';
export const LOAD_ERROR_TEXT = 'Google Maps could not be loaded';
export const AUTH_ERROR_TEXT = 'Google rejected the browser key.';

/** Anything with Google's global auth-failure hook: `window` in the app, a plain object in tests. */
export type AuthFailureTarget = { gm_authFailure?: unknown };

/**
 * Sets `target.gm_authFailure`, which Google calls (with no arguments) when it rejects the key:
 * API not enabled, referrer not allowed, billing off, invalid key. The script still loads in that
 * case, so this is the only signal. A handler that was already there is still called. The returned
 * function puts the old value back (deleting the property if there was none) when ours is still the
 * one installed, and stops `onFailure` from firing again either way.
 */
export function watchAuthFailure(target: AuthFailureTarget, onFailure: () => void): () => void {
  const hadOwn = Object.prototype.hasOwnProperty.call(target, 'gm_authFailure');
  const previous = target.gm_authFailure;
  let active = true;
  const handler = () => {
    if (active) onFailure();
    if (typeof previous === 'function') (previous as () => void)();
  };
  target.gm_authFailure = handler;
  return () => {
    active = false;
    if (target.gm_authFailure !== handler) return; // someone installed theirs after us: leave it
    if (hadOwn) target.gm_authFailure = previous;
    else delete target.gm_authFailure;
  };
}

/** What happens to the map's load: the loader starts (mount or Retry), resolves, throws, or Google rejects the key. */
export type MapEvent = 'load-start' | 'loaded' | 'load-failed' | 'auth-failed';

/**
 * The map status after an event. `auth-error` is final for the page: a load that resolves after
 * Google's auth callback (or a Retry) does not switch it back, because Google will not accept the
 * key until the page is reloaded. Without a key nothing loads, so `missing-key` is final too.
 */
export function nextMapStatus(status: MapStatus, event: MapEvent): MapStatus {
  if (status === 'auth-error' || status === 'missing-key') return status;
  switch (event) {
    case 'auth-failed':
      return 'auth-error';
    case 'load-start':
      return 'loading';
    case 'loaded':
      return 'ready';
    case 'load-failed':
      return 'error';
  }
}

/** The browser key from Vite env, or null. Never log or render the returned value. */
export function readBrowserKey(env: Record<string, unknown> | undefined): string | null {
  const raw = env?.VITE_GOOGLE_MAPS_BROWSER_KEY;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/** First status before any effect runs: no key ⇒ missing-key (and no network request). */
export function initialStatus(key: string | null, authFailed = false): MapStatus {
  if (!key) return 'missing-key';
  return authFailed ? 'auth-error' : 'loading';
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

/** Padding of every camera fit, in pixels. */
export const FIT_PADDING_PX = 48;
/** Google's highest zoom for the roadmap: a fit to one point stops here. */
export const MAX_FIT_ZOOM = 21;

/** Web Mercator y of a latitude, as a fraction of the world height (0 = north edge). */
function mercatorY(lat: number): number {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return 0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI);
}

/**
 * The zoom `map.fitBounds(bounds, padding)` picks for a map of this size: the largest whole zoom at
 * which the bounds fit inside the padded viewport (256 px world tiles). Lets tests draw the names
 * "at the zoom that fits them all" without a browser.
 */
export function fitZoom(
  bounds: LatLngBounds,
  size: { width: number; height: number },
  padding = FIT_PADDING_PX,
): number {
  const w = Math.max(1, size.width - 2 * padding);
  const h = Math.max(1, size.height - 2 * padding);
  const dx = Math.abs(bounds.east - bounds.west) / 360;
  const dy = Math.abs(mercatorY(bounds.south) - mercatorY(bounds.north));
  const zx = dx > 0 ? Math.log2(w / (256 * dx)) : MAX_FIT_ZOOM;
  const zy = dy > 0 ? Math.log2(h / (256 * dy)) : MAX_FIT_ZOOM;
  return Math.max(0, Math.min(MAX_FIT_ZOOM, Math.floor(Math.min(zx, zy))));
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
 * place, mover or stop wins (route IDs have no name of their own). A carried package names its carrier.
 * Empty when nothing resolves.
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
    if (mover) {
      // A carried package names its carrier, as its badge's tooltip does.
      const carrier = mover.carrierId ? movers.find((m) => m.id === mover.carrierId && m.kind === 'vehicle') : undefined;
      return carrier ? `${mover.label}, ${roleOf(mover.kind)} · with ${carrier.label}` : `${mover.label}, ${roleOf(mover.kind)}`;
    }
    const stop = stops.find((s) => s.id === id);
    if (stop) return `${stop.label}, Stop ${stop.n}`;
  }
  return '';
}
