// #479: the map's hover tooltip text (name and role) is reachable without a mouse, and the map's
// load-error message is an alert; the missing-key message is a polite status (#767). Static renders in
// Node (no Google, no WebGL).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoogleBaseMap, MapKeyMissing, MapLoadError } from '../../client/src/components/map/GoogleBaseMap';
import { KEY_MISSING_TEXT, LOAD_ERROR_TEXT, selectedItemText } from '../../client/src/components/map/mapModel';
import type { LayerVisibility, MapMover, MapPlace, MapStop } from '../../client/src/components/map/types';
import { RULES } from './sim-v2-qa-css-rules';

const visible: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };
const places: MapPlace[] = [
  { id: 'biz-a', kind: 'business', lat: 40.70, lng: -73.99, label: 'DUMBO Café', sublabel: 'DUMBO' },
  { id: 'home-1', kind: 'home', lat: 40.68, lng: -73.97, label: 'Home of Maya' },
];
const movers: MapMover[] = [
  { id: 'emp-1', kind: 'vehicle', lat: 40.69, lng: -73.98, label: 'Maya Chen' },
  { id: 'shp-1', kind: 'package', lat: 40.69, lng: -73.98, label: 'Brand proofs' },
];
const stops: MapStop[] = [{ id: 'stop-1', n: 1, lat: 40.7, lng: -73.99, label: 'Pickup at DUMBO Café' }];

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const liveRegion = (html: string) =>
  unescape(html.match(/<div class="map-v2__sr" role="status" aria-live="polite"[^>]*>([^<]*)<\/div>/)?.[1] ?? '<none>');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('selectedItemText: the tooltip text of the selected item', () => {
  it('uses the same name and role as the hover tooltip', () => {
    expect(selectedItemText(['biz-a'], places, movers)).toBe('DUMBO Café, Network business · DUMBO');
    expect(selectedItemText(['home-1'], places, movers)).toBe('Home of Maya, Home');
    expect(selectedItemText(['emp-1'], places, movers)).toBe('Maya Chen, Carrier');
    expect(selectedItemText(['shp-1'], places, movers)).toBe('Brand proofs, Package');
    expect(selectedItemText(['stop-1'], places, movers, stops)).toBe('Pickup at DUMBO Café, Stop 1');
  });

  it('takes the first selected ID that has a name; empty when none does', () => {
    expect(selectedItemText(['route-9', 'shp-1', 'biz-a'], places, movers)).toBe('Brand proofs, Package');
    expect(selectedItemText([], places, movers)).toBe('');
    expect(selectedItemText(['nope'], places, movers)).toBe('');
  });
});

describe('GoogleBaseMap: the selected item in a visually hidden live region', () => {
  it('with a key: announces the selection, and nothing when nothing is selected', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', 'TEST-ONLY-NOT-A-REAL-KEY');
    const sel = renderToStaticMarkup(
      <GoogleBaseMap places={places} routes={[]} movers={movers} visible={visible} selectedIds={['emp-1']} />,
    );
    expect(liveRegion(sel)).toBe('Selected on map: Maya Chen, Carrier');
    const none = renderToStaticMarkup(<GoogleBaseMap places={places} routes={[]} movers={movers} visible={visible} />);
    expect(liveRegion(none)).toBe('');
  });

  it('without a key: the no-key notice (a status, not an alert) and the announcement are both there', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
    const html = renderToStaticMarkup(
      <GoogleBaseMap places={places} routes={[]} movers={movers} visible={visible} selectedIds={['biz-a']} />,
    );
    expect(liveRegion(html)).toBe('Selected on map: DUMBO Café, Network business · DUMBO');
    expect(html).toMatch(/<div class="map-v2__panel" role="status">/);
    expect(html).not.toContain('role="alert"');
  });

  it('the live region is visually hidden, not display:none (screen readers still read it)', () => {
    const sr = RULES.find((r) => r.file.endsWith('map.css') && r.selectors.includes('.map-v2__sr'));
    expect(sr).toBeDefined();
    const decls = Object.fromEntries(sr!.decls);
    expect(decls).toMatchObject({ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden' });
    expect(decls.display).toBeUndefined();
    expect(decls.visibility).toBeUndefined();
  });
});

describe('GoogleBaseMap: the missing-key message is a status, the load-error message an alert', () => {
  it('missing key: role="status", so it does not interrupt on every load without a key (#767)', () => {
    const html = renderToStaticMarkup(<MapKeyMissing />);
    expect(html.startsWith('<div class="map-v2__panel" role="status">')).toBe(true);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-live="assertive"');
    expect(html).toContain(KEY_MISSING_TEXT);
  });

  it('load error, with a Retry button: still an alert', () => {
    const html = renderToStaticMarkup(<MapLoadError onRetry={() => {}} />);
    expect(html.startsWith('<div class="map-v2__panel" role="alert">')).toBe(true);
    expect(html).toContain(LOAD_ERROR_TEXT);
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
  });
});
