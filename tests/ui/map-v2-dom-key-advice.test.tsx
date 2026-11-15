// @vitest-environment jsdom
// What the map area tells you to do about the browser key (#737), in a real DOM. Vite reads
// VITE_GOOGLE_MAPS_BROWSER_KEY when the dev server starts and when the app is built, so the no-key
// placeholder names both ways: restart the dev server, or build again. "restart npm run dev" alone was
// wrong for the production build (PR #726 note 2). Since #890 the advice is one short hint under one
// plain line, in the placeholder every map shares; the commands themselves are in the README.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleBaseMap, MapPlaceholder } from '../../client/src/components/map/GoogleBaseMap';
import { AUTH_ERROR_TEXT, KEY_MISSING_TEXT, mapStateCopy } from '../../client/src/components/map/mapModel';
import type { LayerVisibility } from '../../client/src/components/map/types';
import { mount, textOf } from './kitDom';

const visible: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };
const codes = (el: Element) => [...el.querySelectorAll('code')].map((c) => c.textContent);
const line = (root: Element) => root.querySelector('.map-v2__state-line')!;
const hint = (root: Element) => root.querySelector('.map-v2__state-hint')!;

const NO_KEY_HINT =
  'Everything else on this page still works. To show the map, add VITE_GOOGLE_MAPS_BROWSER_KEY to .env, then restart the dev server or build again.';
const REJECTED_HINT =
  'Everything else on this page still works. To show the map, allow http://localhost:3001 for the key in Google Cloud, turn on Maps JavaScript and billing, then reload.';

const NoKey = () => <MapPlaceholder copy={mapStateCopy('missing-key')} />;
const Rejected = ({ origin }: { origin: string }) => <MapPlaceholder copy={mapStateCopy('auth-error', origin)} />;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the no-key placeholder', () => {
  it('says what still works and what to do under the dev server and under the production build', () => {
    const m = mount(<NoKey />);
    expect(textOf(line(m.container))).toBe(KEY_MISSING_TEXT);
    expect(textOf(hint(m.container))).toBe(NO_KEY_HINT);
    expect(codes(m.container)).toEqual(['VITE_GOOGLE_MAPS_BROWSER_KEY', '.env']);
  });

  it('is a calm notice: role="status" (polite), not an alert (#767)', () => {
    const m = mount(<NoKey />);
    const region = m.container.querySelector('.map-v2__state-text')!;
    expect(region.getAttribute('role')).toBe('status');
    // role="status" implies aria-live="polite"; an explicit value must not make it assertive.
    expect(region.getAttribute('aria-live') ?? 'polite').toBe('polite');
    expect(m.container.querySelector('[role="alert"], [aria-live="assertive"]')).toBeNull();
  });

  it('keeps "Google Maps key missing." as the lead line, the one line of the placeholder', () => {
    const m = mount(<NoKey />);
    expect(KEY_MISSING_TEXT).toBe('Google Maps key missing.');
    expect([...m.container.querySelectorAll('.map-v2__state-line')].map((s) => s.textContent)).toEqual([KEY_MISSING_TEXT]);
    // No bold of its own: map.css sets the line's weight (600, the heaviest Inter that is loaded).
    expect(m.container.querySelector('strong, b')).toBeNull();
  });

  it('is what GoogleBaseMap shows without a browser key, with no map canvas', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
    const m = mount(<GoogleBaseMap places={[]} routes={[]} movers={[]} visible={visible} />);
    const placeholders = m.container.querySelectorAll('.map-v2__state');
    expect(placeholders).toHaveLength(1);
    expect(textOf(line(m.container))).toBe(KEY_MISSING_TEXT);
    expect(textOf(hint(m.container))).toBe(NO_KEY_HINT);
    // Nothing in the no-key map interrupts a screen reader (#767).
    expect(m.container.querySelector('[role="alert"], [aria-live="assertive"]')).toBeNull();
    expect(m.container.querySelector('.map-v2__canvas')).toBeNull();
    // Nothing to press: a retry cannot bring a key.
    expect(m.container.querySelector('button')).toBeNull();
  });
});

describe('the key-rejected placeholder', () => {
  it('names the website to allow, the two settings to turn on, and the reload', () => {
    const m = mount(<Rejected origin="http://localhost:3001" />);
    // A status since #890: every map state is said politely, once.
    expect(m.container.querySelector('.map-v2__state-text')!.getAttribute('role')).toBe('status');
    expect(m.container.querySelector('[role="alert"]')).toBeNull();
    expect(textOf(line(m.container))).toBe(AUTH_ERROR_TEXT);
    expect(textOf(hint(m.container))).toBe(REJECTED_HINT);
    expect(codes(m.container)).toEqual(['http://localhost:3001']);
    expect(m.container.querySelector('button')).toBeNull(); // no Retry: only a reload helps
  });
});

describe('both placeholders', () => {
  it('no key: never tells you only to restart the dev server', () => {
    const text = textOf(mount(<NoKey />).container);
    expect(text).toContain('restart the dev server or build again');
    expect(text).not.toMatch(/restart (the dev server|npm run dev)\./);
  });

  it('key rejected: the fix is in Google Cloud and needs a reload, not a restart', () => {
    const text = textOf(mount(<Rejected origin="http://localhost:5173" />).container);
    expect(text).toContain('then reload.');
    expect(text).not.toMatch(/restart/);
  });

  it.each([
    ['no key', <NoKey key="a" />],
    ['key rejected', <Rejected key="b" origin="http://localhost:5173" />],
  ])('%s: one line and one hint, short enough for a narrow map', (_name, element) => {
    const root = mount(element).container;
    expect(root.querySelectorAll('.map-v2__state-line')).toHaveLength(1);
    expect(root.querySelectorAll('.map-v2__state-hint')).toHaveLength(1);
    expect(root.querySelectorAll('p')).toHaveLength(2);
    expect(root.querySelectorAll('ul, ol, li')).toHaveLength(0);
    expect(textOf(hint(root)).length).toBeLessThanOrEqual(180);
  });
});
