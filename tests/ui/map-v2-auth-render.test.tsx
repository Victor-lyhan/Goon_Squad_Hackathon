// The auth-error view (#510): Google rejected the browser key. Static render pins the sentences and
// that neither the key, the script URL nor Google's error text is shown.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoogleBaseMap, MapAuthError } from '../../client/src/components/map/GoogleBaseMap';
import type { LayerVisibility } from '../../client/src/components/map/types';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const visible: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MapAuthError', () => {
  const html = renderToStaticMarkup(<MapAuthError origin="http://localhost:5173" />);
  const t = text(html);

  it('is an alert that says Google rejected the browser key', () => {
    expect(html).toContain('role="alert"');
    expect(t).toMatch(/^Google rejected the browser key\./);
  });

  it('lists the three settings to check, with this page origin', () => {
    expect(t).toContain("The Maps JavaScript API is enabled in the key's project.");
    expect(t).toContain("The key's website restriction allows this page's origin: http://localhost:5173");
    expect(t).toContain('Billing is active on the project.');
    expect(html.match(/<li>/g)).toHaveLength(3);
  });

  it('names the env variable and says to reload the page after the fix', () => {
    expect(t).toContain('The key is read from VITE_GOOGLE_MAPS_BROWSER_KEY .');
    expect(t).toContain('Reload the page after the fix');
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
    expect(text(html)).toContain('Loading map');
    expect(text(html)).not.toContain('Google rejected');
    expect(html).not.toContain(fakeKey);
  });
});
