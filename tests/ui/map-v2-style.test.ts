import { describe, expect, it } from 'vitest';
import { MAP_STYLE, NYC_CENTER, NYC_ZOOM } from '../../client/src/components/map/mapStyle';
import {
  fitKey,
  initialStatus,
  mapOptions,
  placesBounds,
  readBrowserKey,
  resolveFit,
} from '../../client/src/components/map/mapModel';
import type { MapPlace } from '../../client/src/components/map/types';

const isOff = (featureType: string, elementType?: string) =>
  MAP_STYLE.some(
    (s) =>
      s.featureType === featureType &&
      (s.elementType === undefined || s.elementType === elementType || (elementType && elementType.startsWith(`${s.elementType}.`)) || s.elementType === 'labels') &&
      s.stylers.some((st) => st.visibility === 'off'),
  );

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

describe('MAP_STYLE', () => {
  it('turns off poi and transit labels', () => {
    expect(isOff('poi', 'labels')).toBe(true);
    expect(isOff('transit', 'labels')).toBe(true);
    expect(isOff('road', 'labels')).toBe(true);
  });

  it('contains no dark colors (light basemap)', () => {
    const colors = MAP_STYLE.flatMap((s) => s.stylers.map((st) => st.color)).filter((c): c is string => typeof c === 'string');
    expect(colors.length).toBeGreaterThan(5);
    for (const c of colors) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(luminance(c), c).toBeGreaterThan(0.45);
    }
    // Geometry fills (land, roads, water, parks) are very light.
    const geometry = MAP_STYLE.filter((s) => s.elementType === 'geometry').flatMap((s) => s.stylers.map((st) => st.color));
    for (const c of geometry) expect(luminance(String(c)), String(c)).toBeGreaterThan(0.8);
  });
});

describe('mapOptions', () => {
  it('centers on NYC with reduced UI, JSON styles and no mapId', () => {
    const o = mapOptions();
    expect(o.center).toEqual(NYC_CENTER);
    expect(NYC_CENTER.lat).toBeCloseTo(40.73, 2);
    expect(NYC_CENTER.lng).toBeCloseTo(-73.94, 2);
    expect(o.zoom).toBe(NYC_ZOOM);
    expect(o.streetViewControl).toBe(false);
    expect(o.mapTypeControl).toBe(false);
    expect(o.styles).toBe(MAP_STYLE);
    expect(o).not.toHaveProperty('mapId');
  });
});

describe('key handling', () => {
  it('treats missing or blank keys as missing', () => {
    expect(readBrowserKey(undefined)).toBeNull();
    expect(readBrowserKey({})).toBeNull();
    expect(readBrowserKey({ VITE_GOOGLE_MAPS_BROWSER_KEY: '  ' })).toBeNull();
    expect(readBrowserKey({ VITE_GOOGLE_MAPS_BROWSER_KEY: 'abc' })).toBe('abc');
    expect(initialStatus(null)).toBe('missing-key');
    expect(initialStatus('abc')).toBe('loading');
  });
});

describe('fitting', () => {
  const places: MapPlace[] = [
    { id: 'b', kind: 'business', lat: 40.75, lng: -73.98, label: 'B' },
    { id: 'a', kind: 'business', lat: 40.70, lng: -73.92, label: 'A' },
  ];

  it('computes padded bounds around places', () => {
    expect(placesBounds(places, 0)).toEqual({ north: 40.75, south: 40.7, east: -73.92, west: -73.98 });
    expect(placesBounds([])).toBeNull();
  });

  it('keeps the fit key stable across polls with equal places', () => {
    const copy = places.map((p) => ({ ...p, lat: p.lat + 0.0001 })).reverse();
    expect(fitKey('places', places)).toBe(fitKey('places', copy));
    expect(fitKey('places', places)).not.toBe(fitKey('places', places.slice(1)));
    expect(fitKey(undefined, places)).toBeNull();
    const box = { north: 1, south: 0, east: 1, west: 0 };
    expect(fitKey(box, places)).toBe('bounds:1,0,1,0');
    expect(resolveFit(box, places)).toBe(box);
  });
});
