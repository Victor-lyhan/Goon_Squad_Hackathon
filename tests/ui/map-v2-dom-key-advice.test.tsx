// @vitest-environment jsdom
// What the map area tells you to do about the browser key (#737), in a real DOM. Vite reads
// VITE_GOOGLE_MAPS_BROWSER_KEY when `npm run dev` starts and when `npm run build` runs, so both the
// no-key card and the key-rejected card name both ways: restart the dev server, or build again before
// `npm start`. "restart npm run dev" alone was wrong for the production build (PR #726 note 2).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleBaseMap, MapAuthError, MapKeyMissing } from '../../client/src/components/map/GoogleBaseMap';
import { AUTH_ERROR_TEXT, KEY_MISSING_TEXT } from '../../client/src/components/map/mapModel';
import type { LayerVisibility } from '../../client/src/components/map/types';
import { mount, textOf } from './kitDom';

const visible: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };
const codes = (el: Element) => [...el.querySelectorAll('code')].map((c) => c.textContent);

const NO_KEY_ADVICE =
  'Add VITE_GOOGLE_MAPS_BROWSER_KEY to .env, then restart npm run dev, or run npm run build again before npm start (the key is read at build time).';
const REJECTED_ADVICE =
  'The key is read from VITE_GOOGLE_MAPS_BROWSER_KEY. Reload the page after the fix. If you changed .env, first restart npm run dev, or run npm run build again before npm start (the key is read at build time).';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the no-key card (MapKeyMissing)', () => {
  it('says what to do under npm run dev and under the production build', () => {
    const m = mount(<MapKeyMissing />);
    const alert = m.container.querySelector('[role="alert"]')!;
    expect(textOf(alert)).toBe(`${KEY_MISSING_TEXT} ${NO_KEY_ADVICE}`);
    expect(codes(alert)).toEqual(['VITE_GOOGLE_MAPS_BROWSER_KEY', '.env', 'npm run dev', 'npm run build', 'npm start']);
  });

  it('keeps "Google Maps key missing." as the lead line, in the one <strong>', () => {
    const m = mount(<MapKeyMissing />);
    expect(KEY_MISSING_TEXT).toBe('Google Maps key missing.');
    expect([...m.container.querySelectorAll('strong')].map((s) => s.textContent)).toEqual([KEY_MISSING_TEXT]);
  });

  it('is what GoogleBaseMap shows without a browser key, with no map canvas', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
    const m = mount(<GoogleBaseMap places={[]} routes={[]} movers={[]} visible={visible} />);
    const alerts = m.container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(textOf(alerts[0])).toBe(`${KEY_MISSING_TEXT} ${NO_KEY_ADVICE}`);
    expect(m.container.querySelector('.map-v2__canvas')).toBeNull();
  });
});

describe('the key-rejected card (MapAuthError)', () => {
  it('its last paragraph names both modes too; the lines above it are unchanged', () => {
    const m = mount(<MapAuthError origin="http://localhost:3001" />);
    const alert = m.container.querySelector('[role="alert"]')!;
    const paragraphs = [...alert.querySelectorAll('p')];
    expect(paragraphs).toHaveLength(2);
    expect(textOf(paragraphs[1])).toBe(REJECTED_ADVICE);
    expect(codes(paragraphs[1])).toEqual(['VITE_GOOGLE_MAPS_BROWSER_KEY', '.env', 'npm run dev', 'npm run build', 'npm start']);
    expect(alert.querySelector('strong')!.textContent).toBe(AUTH_ERROR_TEXT);
    expect(textOf(paragraphs[0])).toBe('In the Google Cloud project that owns the key, check:');
    expect(alert.querySelectorAll('li')).toHaveLength(3);
  });
});

describe('both cards', () => {
  it.each([
    ['no key', <MapKeyMissing key="a" />],
    ['key rejected', <MapAuthError key="b" origin="http://localhost:5173" />],
  ])('%s: never tells you only to restart npm run dev', (_name, element) => {
    const text = textOf(mount(element).container);
    expect(text).toContain('restart npm run dev, or run npm run build again before npm start');
    expect(text).toContain('the key is read at build time');
    expect(text).not.toMatch(/restart npm run dev\./);
    expect(text).not.toMatch(/restart npm run dev first/);
  });
});
