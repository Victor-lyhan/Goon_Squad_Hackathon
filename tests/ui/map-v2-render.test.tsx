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
      'Google Maps key missing. Add VITE_GOOGLE_MAPS_BROWSER_KEY to .env and restart npm run dev.',
    );
    expect(html).toContain('role="alert"');
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
