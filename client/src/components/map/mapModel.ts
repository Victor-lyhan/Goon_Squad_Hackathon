// Pure helpers for GoogleBaseMap (no DOM, no Google, no deck.gl), tested in Node.
import { MAP_STYLE, NYC_CENTER, NYC_ZOOM } from './mapStyle';
import type { LatLngBounds, MapPlace } from './types';

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
