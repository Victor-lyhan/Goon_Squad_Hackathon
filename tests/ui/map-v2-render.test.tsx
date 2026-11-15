import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoogleBaseMap } from '../../client/src/components/map/GoogleBaseMap';
import type { LayerVisibility, MapPlace } from '../../client/src/components/map/types';

const visible: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };
const places: MapPlace[] = [{ id: 'biz-a', kind: 'business', lat: 40.70, lng: -73.99, label: 'DUMBO Café' }];

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GoogleBaseMap static render', () => {
  it('shows the key-missing panel without a key', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
    const html = renderToStaticMarkup(
      <GoogleBaseMap places={places} routes={[]} movers={[]} visible={visible} />,
    );
    expect(text(html)).toContain(
      'Google Maps key missing. Add VITE_GOOGLE_MAPS_BROWSER_KEY to .env, then restart npm run dev, or run npm run build again before npm start (the key is read at build time).',
    );
    expect(html).toContain('class="map-v2__panel" role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('map-v2__canvas');
  });

  it('shows the key-missing panel with journey stops and panTo set, without throwing', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
    const html = renderToStaticMarkup(
      <GoogleBaseMap
        places={places}
        routes={[{ id: 'leg-2', kind: 'leg', tone: 'leg2', path: [[-73.99, 40.7], [-73.98, 40.74]], ownerIds: ['shp-1'] }]}
        movers={[]}
        visible={visible}
        stops={[
          { id: 'stop-1', n: 1, lat: 40.7, lng: -73.99, label: 'Pickup at DUMBO Café' },
          { id: 'stop-2', n: 2, lat: 40.74, lng: -73.98, label: 'Delivered' },
        ]}
        panTo={{ lat: 40.74, lng: -73.98, key: 'step-2' }}
      />,
    );
    expect(text(html)).toContain('Google Maps key missing.');
    expect(html).toContain('class="map-v2__panel" role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('map-v2__canvas');
  });

  it('shows a spinner with a key and never renders the key', () => {
    const fakeKey = 'TEST-ONLY-NOT-A-REAL-KEY-123';
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', fakeKey);
    const html = renderToStaticMarkup(
      <GoogleBaseMap places={places} routes={[]} movers={[]} visible={visible} selectedIds={['biz-a']} fitTo="places" />,
    );
    expect(html).toContain('map-v2__canvas');
    expect(text(html)).toContain('Loading map');
    expect(text(html)).not.toContain('key missing');
    expect(html).not.toContain(fakeKey);
  });
});
