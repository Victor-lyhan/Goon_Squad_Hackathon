// The auth-error view (#510): Google rejected the browser key. Static render pins the sentences and
// that neither the key, the script URL nor Google's error text is shown. Since #890 it is the shared
// map placeholder: one plain line and one short hint, in a status region.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoogleBaseMap, MapPlaceholder } from '../../client/src/components/map/GoogleBaseMap';
import { mapStateCopy } from '../../client/src/components/map/mapModel';
import type { LayerVisibility } from '../../client/src/components/map/types';

const text = (html: string) => html.replace(/<wbr\/?>/g, '').replace(/<\/p>/g, ' ').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const visible: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the rejected-key placeholder', () => {
  const html = renderToStaticMarkup(<MapPlaceholder copy={mapStateCopy('auth-error', 'http://localhost:5173')} />);
  const t = text(html);

  it('is a status (not an alert) that says Google rejected the browser key', () => {
    expect(html).toContain('class="map-v2__state-text" role="status"');
    expect(html).not.toContain('role="alert"');
    expect(t).toMatch(/^Google rejected the browser key\./);
  });

  it('names the three settings to check, with this page origin', () => {
    expect(t).toContain('allow http://localhost:5173 for the key in Google Cloud');
    expect(t).toContain('turn on Maps JavaScript and billing');
    expect(html).toContain('<code>http://localhost:5173</code>');
  });

  it('says the rest of the page works and to reload after the fix', () => {
    expect(t).toContain('Everything else on this page still works.');
    expect(t).toMatch(/then reload\.$/);
  });

  it('without an origin (a server render) it says "this website"', () => {
    const none = text(renderToStaticMarkup(<MapPlaceholder copy={mapStateCopy('auth-error')} />));
    expect(none).toContain('allow this website for the key in Google Cloud');
  });

  it('never shows a key, the script URL or Google error text', () => {
    expect(html).not.toMatch(/AIza|key=|maps\.googleapis\.com|Oops|Something went wrong|MapError/i);
  });

  it('has no Retry button (Google will not accept the key until a reload)', () => {
    expect(html).not.toContain('<button');
  });
});

describe('GoogleBaseMap with a key, before any effect', () => {
  it('starts loading (auth-error only after Google calls back) and never renders the key', () => {
    const fakeKey = 'TEST-ONLY-NOT-A-REAL-KEY-510';
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', fakeKey);
    const html = renderToStaticMarkup(<GoogleBaseMap places={[]} routes={[]} movers={[]} visible={visible} />);
    expect(text(html)).toContain('Loading the map');
    expect(text(html)).not.toContain('Google rejected');
    expect(html).not.toContain(fakeKey);
  });
});
