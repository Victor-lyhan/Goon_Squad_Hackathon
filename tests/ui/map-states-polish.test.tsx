// @vitest-environment jsdom
// #890: one calm placeholder on every Google map while it shows no map: no browser key, key rejected,
// load error, loading. One plain line, where useful one short hint, Retry only where a retry can help;
// said once in a status region; on the ink frame; fits a 220 px map; never the key.
// The Google loader and deck.gl are faked: no network, no key, no WebGL.
import { act } from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryRouteSlot } from '../../client/src/components/business/v2/route/DeliveryRoutePreview';
import {
  ROUTE_MAP_FAILED_TEXT, ROUTE_MAP_LOADING_TEXT, deliveryMapReducer, deliveryMapSlot, initialDeliveryMapState,
} from '../../client/src/components/business/v2/route/deliveryMapLoader';
import { GoogleBaseMap, MapPlaceholder, MapStateFrame } from '../../client/src/components/map/GoogleBaseMap';
import {
  AUTH_ERROR_TEXT, BROWSER_KEY_NAME, KEY_MISSING_TEXT, LOAD_ERROR_TEXT, MAP_LOADING_TEXT, RETRYING_COPY,
  STILL_WORKS_TEXT, hintText, mapStateCopy, type MapStatus,
} from '../../client/src/components/map/mapModel';
import type { LayerVisibility, MapPlace } from '../../client/src/components/map/types';
import { RELAY } from './business-v2-page-sample';
import { parseCss, readTokens, type CssRule } from './employee-v2-qa-helpers';
import { button, click, flush, mount, textOf } from './kitDom';

const KEY = 'TEST-ONLY-NOT-A-REAL-KEY-890';
const ORIGIN = 'http://localhost:5173';

type Load = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
const fake = vi.hoisted(() => ({ loads: [] as Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }>, maps: 0 }));

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => {},
  importLibrary: () => new Promise((resolve, reject) => { fake.loads.push({ resolve, reject }); }),
}));
vi.mock('@deck.gl/google-maps', () => ({
  GoogleMapsOverlay: class { setMap() {} finalize() {} setProps() {} },
}));
vi.mock('@deck.gl/layers', () => {
  class Layer { constructor(public props: unknown) {} }
  return { PathLayer: Layer, ScatterplotLayer: Layer, TextLayer: Layer };
});
class FakeMap { constructor() { fake.maps += 1; } fitBounds() {} panTo() {} setOptions() {} }

const visible: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };
const places: MapPlace[] = [{ id: 'biz-a', kind: 'business', lat: 40.7, lng: -73.99, label: 'DUMBO Café' }];
const NO_MAP: MapStatus[] = ['missing-key', 'auth-error', 'error'];
const ALL: MapStatus[] = [...NO_MAP, 'loading'];

const lastLoad = (): Load => fake.loads[fake.loads.length - 1];
const settle = async (how: (l: Load) => void) => {
  await act(async () => { how(lastLoad()); await Promise.resolve(); });
  await flush();
};
const region = (root: Element) => root.querySelector('.map-v2__state-text')!;
const state = (root: Element) => root.querySelector('.map-v2__state')!;

beforeEach(() => {
  fake.loads = [];
  fake.maps = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (window as { gm_authFailure?: unknown }).gm_authFailure;
});

/** A fresh map module per test: the "Google already rejected the key on this page" flag lives in it. */
async function freshMap() {
  vi.resetModules();
  return (await import('../../client/src/components/map/GoogleBaseMap')).GoogleBaseMap;
}

describe('what each state says (mapStateCopy)', () => {
  it('one plain line each; the lines the README quotes are unchanged', () => {
    expect(ALL.map((s) => mapStateCopy(s, ORIGIN)!.line)).toEqual([KEY_MISSING_TEXT, AUTH_ERROR_TEXT, LOAD_ERROR_TEXT, MAP_LOADING_TEXT]);
    expect([KEY_MISSING_TEXT, AUTH_ERROR_TEXT, LOAD_ERROR_TEXT, MAP_LOADING_TEXT]).toEqual([
      'Google Maps key missing.', 'Google rejected the browser key.', "Couldn't load the map.", 'Loading the map…',
    ]);
    for (const s of ALL) expect(mapStateCopy(s, ORIGIN)!.line.length, s).toBeLessThanOrEqual(32); // one row in a 220 px map
    expect(mapStateCopy('ready')).toBeNull();
  });

  it('a map that is not coming says the page still works, then the one thing to do', () => {
    const hint = (s: MapStatus) => hintText(mapStateCopy(s, ORIGIN)!.hint);
    expect(hint('missing-key')).toBe(`${STILL_WORKS_TEXT} To show the map, add ${BROWSER_KEY_NAME} to .env, then restart the dev server or build again.`);
    expect(hint('auth-error')).toBe(`${STILL_WORKS_TEXT} To show the map, allow ${ORIGIN} for the key in Google Cloud, turn on Maps JavaScript and billing, then reload.`);
    expect(hint('error')).toBe(`${STILL_WORKS_TEXT} Check the connection, then retry.`);
    for (const s of NO_MAP) {
      expect(hint(s).startsWith('Everything else on this page still works.'), s).toBe(true);
      expect(hint(s).length, s).toBeLessThanOrEqual(180);
    }
    // Loading needs no hint.
    expect(mapStateCopy('loading')!.hint).toEqual([]);
  });

  it('Retry only for a load error: a retry cannot bring a key, and Google refuses a rejected key until a reload', () => {
    expect(ALL.filter((s) => mapStateCopy(s)!.retry)).toEqual(['error']);
    // While that retry loads the button stays, busy, on the same dark frame.
    expect(mapStateCopy('loading', '', true)).toBe(RETRYING_COPY);
    expect(RETRYING_COPY).toEqual({ line: MAP_LOADING_TEXT, hint: [], retry: true, busy: true, tone: 'dark' });
    for (const s of NO_MAP) expect(mapStateCopy(s, '', true), s).toEqual(mapStateCopy(s, ''));
  });

  it('the ink frame for a map that is not coming; loading keeps the frame of the map that is', () => {
    expect(ALL.map((s) => mapStateCopy(s)!.tone)).toEqual(['dark', 'dark', 'dark', 'plain']);
  });

  it('plain words: no key value, URL, Google error text or jargon in any state', () => {
    for (const s of ALL) {
      const c = mapStateCopy(s, ORIGIN)!;
      const all = `${c.line} ${hintText(c.hint)}`;
      expect(all, s).not.toMatch(/AIza|key=|googleapis|Oops|Something went wrong|MapError|gm_authFailure|referr?er|\bAPIs?\b|\bhubs?\b/i);
      expect(all, s).not.toMatch(/undefined|null|NaN/);
    }
    // The only names set apart: the variable and the file (no key), this page's origin (key rejected).
    const codes = (s: MapStatus) => mapStateCopy(s, ORIGIN)!.hint.flatMap((p) => (typeof p === 'string' ? [] : [p.code]));
    expect(codes('missing-key')).toEqual(['VITE_GOOGLE_MAPS_BROWSER_KEY', '.env']);
    expect(codes('auth-error')).toEqual([ORIGIN]);
    expect(codes('error')).toEqual([]);
  });
});

describe('the placeholder (MapPlaceholder)', () => {
  it.each(ALL)('%s: one status region with one line and at most one hint, never an alert', (status) => {
    const copy = mapStateCopy(status, ORIGIN)!;
    const m = mount(<MapPlaceholder copy={copy} onRetry={() => {}} />);
    expect(m.container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(m.container.querySelector('[role="alert"], [aria-live="assertive"]')).toBeNull();
    expect([...region(m.container).children].map((c) => c.className)).toEqual(
      copy.hint.length ? ['map-v2__state-line', 'map-v2__state-hint'] : ['map-v2__state-line'],
    );
    expect(textOf(region(m.container))).toBe(copy.line + hintText(copy.hint));
    expect(state(m.container).className).toBe(`map-v2__state map-v2__state--${copy.tone}`);
    // Retry only where the copy says so, and outside the region: the announcement is the words alone.
    expect([...m.container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(copy.retry ? ['Retry'] : []);
    expect(region(m.container).querySelector('button')).toBeNull();
  });

  it('a long variable name may wrap after each underscore, and still reads as one word', () => {
    const html = renderToStaticMarkup(<MapPlaceholder copy={mapStateCopy('missing-key')} />);
    expect(html).toContain('<code>VITE_<wbr/>GOOGLE_<wbr/>MAPS_<wbr/>BROWSER_<wbr/>KEY</code>');
    expect(textOf(mount(<MapPlaceholder copy={mapStateCopy('missing-key')} />).container.querySelector('code')!)).toBe(BROWSER_KEY_NAME);
  });

  it('a map that is showing: the region is still there, empty and out of sight', () => {
    const m = mount(<MapPlaceholder copy={null} onRetry={() => {}} />);
    expect(state(m.container).className).toBe('map-v2__state map-v2__state--off');
    expect(region(m.container).getAttribute('role')).toBe('status');
    expect(region(m.container).textContent).toBe('');
    expect(m.container.querySelector('button')).toBeNull();
  });

  it('Retry calls back; while a retry loads it is aria-disabled (it keeps the focus) and does nothing', () => {
    const onRetry = vi.fn();
    const m = mount(<MapPlaceholder copy={mapStateCopy('error')} onRetry={onRetry} />);
    click(button(m.container, 'Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    m.rerender(<MapPlaceholder copy={RETRYING_COPY} onRetry={onRetry} />);
    const busy = button(m.container, 'Retry');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(busy.disabled).toBe(false);
    click(busy);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('GoogleBaseMap: every state is the one placeholder', () => {
  it('no key: the dark placeholder, no canvas, no request to Google, nothing to press', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
    const Map = await freshMap();
    const m = mount(<Map places={places} routes={[]} movers={[]} visible={visible} />);
    await flush();
    expect(fake.loads).toHaveLength(0);
    expect(m.container.querySelectorAll('.map-v2__state')).toHaveLength(1);
    expect(state(m.container).classList.contains('map-v2__state--dark')).toBe(true);
    expect(textOf(m.container.querySelector('.map-v2__state-line')!)).toBe(KEY_MISSING_TEXT);
    expect(m.container.querySelector('.map-v2__canvas, button, [role="alert"]')).toBeNull();
  });

  it('loading, load error, Retry, error again, then the map: one region throughout, each change said once', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', KEY);
    const Map = await freshMap();
    const el = (p: MapPlace[]) => <Map places={p} routes={[]} movers={[]} visible={visible} />;
    const m = mount(el(places));
    await flush();
    const live = region(m.container);
    const said: string[] = [];
    const observer = new MutationObserver(() => { const t = live.textContent ?? ''; if (said[said.length - 1] !== t) said.push(t); });
    observer.observe(live, { subtree: true, childList: true, characterData: true });
    const canvas = () => m.container.querySelector('.map-v2__canvas')!;

    // Loading: on the frame of the map that is coming, no hint, no Retry.
    expect(fake.loads).toHaveLength(1);
    expect(textOf(live)).toBe(MAP_LOADING_TEXT);
    expect(state(m.container).className).toBe('map-v2__state map-v2__state--plain');
    expect(canvas().className).toBe('map-v2__canvas');
    expect(m.container.querySelector('button')).toBeNull();

    // The load fails. The error's text can hold the script URL (and so the key): it is never shown.
    await settle((l) => l.reject(new Error(`https://maps.googleapis.com/maps/api/js?key=${KEY} could not load.`)));
    expect(region(m.container)).toBe(live); // the same element: the change is announced, not a new region
    expect(textOf(live)).toBe(`${LOAD_ERROR_TEXT}${STILL_WORKS_TEXT} Check the connection, then retry.`);
    expect(state(m.container).className).toBe('map-v2__state map-v2__state--dark');
    expect(canvas().className).toBe('map-v2__canvas map-v2__canvas--hidden');
    expect(m.container.innerHTML).not.toContain(KEY);
    expect(m.container.innerHTML).not.toContain('googleapis');

    // A poll with new props says nothing new.
    const before = said.length;
    m.rerender(el([...places]));
    m.rerender(el([...places, { id: 'biz-b', kind: 'business', lat: 40.72, lng: -73.98, label: 'Bakery Row' }]));
    await flush();
    expect(said.length).toBe(before);

    // Retry: a second load. The frame stays dark and the button stays (busy), still focused.
    const retry = button(m.container, 'Retry');
    retry.focus();
    click(retry);
    await flush();
    expect(fake.loads).toHaveLength(2);
    expect(textOf(live)).toBe(MAP_LOADING_TEXT);
    expect(state(m.container).className).toBe('map-v2__state map-v2__state--dark');
    expect(button(m.container, 'Retry')).toBe(retry);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(retry);
    click(retry); // pressing it again while it loads starts nothing
    await flush();
    expect(fake.loads).toHaveLength(2);

    // It fails again: the error again, the same button, usable again.
    await settle((l) => l.reject(new Error('offline')));
    expect(textOf(live)).toContain(LOAD_ERROR_TEXT);
    expect(button(m.container, 'Retry')).toBe(retry);
    expect(retry.hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(retry);

    // Retry once more, and the map loads: the placeholder is gone, the region stays, empty.
    click(retry);
    await flush();
    await settle((l) => l.resolve({ Map: FakeMap }));
    expect(fake.maps).toBe(1);
    expect(region(m.container)).toBe(live);
    expect(live.textContent).toBe('');
    expect(state(m.container).className).toBe('map-v2__state map-v2__state--off');
    expect(canvas().className).toBe('map-v2__canvas');
    expect(m.container.querySelector('button')).toBeNull();

    // What a screen reader was told after the first render: each state once, in order.
    expect(said).toEqual([
      `${LOAD_ERROR_TEXT}${STILL_WORKS_TEXT} Check the connection, then retry.`,
      MAP_LOADING_TEXT,
      `${LOAD_ERROR_TEXT}${STILL_WORKS_TEXT} Check the connection, then retry.`,
      MAP_LOADING_TEXT,
      '',
    ]);
    observer.disconnect();
  });

  it('key rejected: the dark placeholder with this page\'s origin, no Retry, the canvas hidden; never the key', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', KEY);
    const Map = await freshMap();
    const m = mount(<Map places={places} routes={[]} movers={[]} visible={visible} />);
    await flush();
    const live = region(m.container);
    act(() => { (window as unknown as { gm_authFailure: () => void }).gm_authFailure(); });
    expect(region(m.container)).toBe(live);
    expect(textOf(live)).toBe(`${AUTH_ERROR_TEXT}${STILL_WORKS_TEXT} To show the map, allow ${window.location.origin} for the key in Google Cloud, turn on Maps JavaScript and billing, then reload.`);
    expect(state(m.container).className).toBe('map-v2__state map-v2__state--dark');
    // Google draws its grey error box into the canvas: it is hidden under the opaque frame.
    expect(m.container.querySelector('.map-v2__canvas')!.className).toBe('map-v2__canvas map-v2__canvas--hidden');
    expect(m.container.querySelector('button, [role="alert"]')).toBeNull();
    expect(m.container.innerHTML).not.toContain(KEY);
  });

  it('the key is never rendered or logged, whatever the state', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', KEY);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const Map = await freshMap();
    const m = mount(<Map places={places} routes={[]} movers={[]} visible={visible} dayNight="day" clockText="Day 1 · 4:29 PM" />);
    await flush();
    const seen = [m.container.innerHTML];
    await settle((l) => l.reject(new Error(`key=${KEY}`)));
    seen.push(m.container.innerHTML);
    click(button(m.container, 'Retry'));
    await flush();
    seen.push(m.container.innerHTML);
    act(() => { (window as unknown as { gm_authFailure: () => void }).gm_authFailure(); });
    seen.push(m.container.innerHTML);
    expect(seen).toHaveLength(4);
    for (const html of seen) expect(html).not.toContain(KEY);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
  });

  it('the simulator\'s sun or moon badge stays in every state, next to the placeholder', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', KEY);
    const Map = await freshMap();
    const m = mount(<Map places={places} routes={[]} movers={[]} visible={visible} dayNight="night" clockText="Day 1 · 10:00 PM" />);
    await flush();
    const badge = () => m.container.querySelector('.map-v2__daynight');
    expect(badge()!.textContent).toBe('Day 1 · 10:00 PM'); // loading
    await settle((l) => l.reject(new Error('offline')));
    expect(badge()).not.toBeNull(); // load error
    act(() => { (window as unknown as { gm_authFailure: () => void }).gm_authFailure(); });
    expect(textOf(region(m.container))).toContain(AUTH_ERROR_TEXT);
    expect(badge()).not.toBeNull(); // key rejected
  });
});

describe('the Business route preview uses the same placeholder for its own states', () => {
  const slotHtml = (slot: Parameters<typeof DeliveryRouteSlot>[0]['slot']) =>
    renderToStaticMarkup(<DeliveryRouteSlot slot={slot} view={RELAY} onRetry={() => {}} />);

  it('the words are the map\'s own, so the line does not change when the map takes over', () => {
    expect(ROUTE_MAP_LOADING_TEXT).toBe(MAP_LOADING_TEXT);
    expect(ROUTE_MAP_FAILED_TEXT).toBe(LOAD_ERROR_TEXT);
  });

  it('loading and failed: the map\'s box (so nothing jumps) holding the placeholder', () => {
    const loading = slotHtml({ kind: 'loading', text: ROUTE_MAP_LOADING_TEXT });
    const failed = slotHtml({ kind: 'failed', text: ROUTE_MAP_FAILED_TEXT });
    for (const html of [loading, failed]) {
      expect(html.startsWith('<section class="bdr" aria-label="Delivery route on the map"><div class="bdr__map"><div class="map-v2"><div class="map-v2__state ')).toBe(true);
      expect(html.match(/role="status"/g)).toHaveLength(1);
      expect(html).not.toContain('role="alert"');
    }
    expect(loading).toBe(renderToStaticMarkup(
      <section className="bdr" aria-label="Delivery route on the map"><div className="bdr__map">
        <MapStateFrame copy={mapStateCopy('loading')!} /></div></section>,
    ));
    expect(failed).toContain('map-v2__state--dark');
    expect(failed).toContain(`<p class="map-v2__state-hint">${STILL_WORKS_TEXT}</p>`);
    expect(failed).toContain('<button type="button" class="map-v2__retry">Retry</button>');
    expect(loading).not.toContain('<button');
  });

  it('only a load started by Retry keeps the button; a new run after a failure is a plain load', () => {
    const failed = deliveryMapReducer(deliveryMapReducer(initialDeliveryMapState, { type: 'start', keepMap: false }), { type: 'failed' });
    expect(deliveryMapSlot(deliveryMapReducer(failed, { type: 'start', keepMap: true, retry: true })))
      .toEqual({ kind: 'loading', text: MAP_LOADING_TEXT, retrying: true });
    expect(deliveryMapSlot(deliveryMapReducer(failed, { type: 'start', keepMap: false })))
      .toEqual({ kind: 'loading', text: MAP_LOADING_TEXT });
    // A second failure forgets the retry.
    const again = deliveryMapReducer(deliveryMapReducer(failed, { type: 'start', keepMap: true, retry: true }), { type: 'failed' });
    expect(again).toEqual({ status: 'failed', map: null });
    const retrying = slotHtml({ kind: 'loading', text: ROUTE_MAP_LOADING_TEXT, retrying: true });
    expect(retrying).toContain('map-v2__state--dark');
    expect(retrying).toContain('<button type="button" class="map-v2__retry" aria-disabled="true">Retry</button>');
  });
});

describe('map.css: the placeholder fits its box and follows docs/mvp3.md', () => {
  const MAP_CSS = 'client/src/components/map/map.css';
  const rules = parseCss(readFileSync(MAP_CSS, 'utf8'));
  const tokens = readTokens();
  const own = rules.filter((r) => /\.map-v2__(state|retry)/.test(r.selector));
  const rule = (selector: string, inAt = false): CssRule => {
    const found = own.filter((r) => r.selector === selector && (r.media.length > 0) === inAt);
    expect(found, selector).toHaveLength(1);
    return found[0];
  };
  const value = (selector: string, prop: string) => rule(selector).decls.find((d) => d.prop === prop)?.value;

  const hex = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const lum = (c: number[]) => c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const over = (top: number[], alpha: number, under: number[]) => top.map((v, i) => v * alpha + under[i] * (1 - alpha));
  const ink = hex(tokens.get('--text')!);
  const white = hex(tokens.get('--panel')!);

  it('covers the whole map area, above the canvas and under the controls on the map', () => {
    expect(value('.map-v2__state', 'position')).toBe('absolute');
    expect(value('.map-v2__state', 'inset')).toBe('0');
    expect(value('.map-v2__state', 'z-index')).toBe('1');
    const badge = rules.find((r) => r.selector === '.map-v2__daynight')!;
    expect(Number(badge.decls.find((d) => d.prop === 'z-index')!.value)).toBeGreaterThan(1);
  });

  it('fits a 220 px map: 12 px of padding, a cap but no fixed or minimum width, and it scrolls before it is cut', () => {
    expect(value('.map-v2__state', 'padding')).toBe('var(--space-3, 12px)');
    expect(value('.map-v2__state', 'overflow-y')).toBe('auto');
    // "safe": a block taller than a short map starts at the top instead of being cut at both ends.
    expect(value('.map-v2__state', 'align-items')).toBe('safe center');
    expect(value('.map-v2__state-body', 'max-width')).toBe('360px');
    for (const r of own) {
      if (r.selector === '.map-v2__state--off') continue; // the 1 px hidden region of a map that is showing
      for (const d of r.decls) {
        expect(['width', 'min-width', 'height', 'white-space'].includes(d.prop), `${r.selector} { ${d.prop} }`).toBe(false);
      }
    }
    // A long name wraps: the variable at its underscores (<wbr>), an origin wherever it must.
    expect(value('.map-v2__state-hint code', 'overflow-wrap')).toBe('anywhere');
    // 196 px of room (220 less the padding) holds the longest unbreakable piece, "BROWSER_", at 11 px mono.
    expect(value('.map-v2__state-hint code', 'font-size')).toBe('11px');
  });

  it('in the simulator\'s narrow, tall map the block sits above Play instead of under the legend', () => {
    expect(value('.map-v2__state', 'container-type')).toBe('size');
    const narrow = rule('.map-v2__state-body', true);
    expect(narrow.media).toEqual(['@container (max-width: 320px) and (min-height: 480px)']);
    expect(Object.fromEntries(narrow.decls.map((d) => [d.prop, d.value]))).toEqual({ 'align-self': 'flex-end', 'margin-bottom': '136px' });
    // Never in a short map (the Business and Employee previews are 240 to 320 px tall).
    expect(narrow.media[0]).toMatch(/min-height: 480px/);
  });

  it('the ink frame with white words, flat: tokens only, no gradient, shadow, blur or border on the frame', () => {
    expect(value('.map-v2__state--dark', 'background')).toBe('var(--text, #171C24)');
    expect(value('.map-v2__state--dark', 'color')).toBe('var(--panel, #FFFFFF)');
    for (const r of own) {
      for (const d of r.decls) {
        expect(d.value, `${r.selector} { ${d.prop} }`).not.toMatch(/gradient|rgba?\(|hsla?\(/);
        expect(['box-shadow', 'text-shadow', 'backdrop-filter', 'filter', 'animation', 'transition', 'transform'].includes(d.prop), `${r.selector} { ${d.prop} }`).toBe(false);
        // Every colour is a token with its own value as the fallback.
        for (const [, name, fallback] of d.value.matchAll(/var\((--[\w-]+), (#[0-9A-Fa-f]{6})\)/g)) {
          expect(tokens.get(name)?.toUpperCase(), `${r.selector} ${name}`).toBe(fallback.toUpperCase());
        }
        expect(d.value.replace(/var\(--[\w-]+, #[0-9A-Fa-f]{6}\)/g, ''), `${r.selector} { ${d.prop} }`).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
      }
    }
    // Radius: only Retry has one, and it is the token.
    const radii = own.flatMap((r) => r.decls.filter((d) => d.prop.includes('radius')).map((d) => `${r.selector}: ${d.value}`));
    expect(radii).toEqual(['.map-v2__retry: var(--radius, 4px)']);
  });

  it('Inter for the words, IBM Plex Mono only for a name; sizes from the scale; nothing heavier than 600', () => {
    const families = own.flatMap((r) => r.decls.filter((d) => d.prop === 'font-family').map((d) => `${r.selector}: ${d.value}`));
    expect(families).toEqual([".map-v2__state-hint code: var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)"]);
    expect(value('.map-v2__retry', 'font')).toBe('inherit');
    expect(value('.map-v2__state-line', 'font-size')).toBe('var(--text-md, 14px)');
    expect(value('.map-v2__state-line', 'font-weight')).toBe('600');
    expect(value('.map-v2__state-hint', 'font-size')).toBe('var(--text-xs, 12px)');
    expect(value('.map-v2__state--plain .map-v2__state-line', 'font-weight')).toBe('400');
    const weights = own.flatMap((r) => r.decls.filter((d) => d.prop === 'font-weight').map((d) => Number(d.value)));
    expect(Math.max(...weights)).toBe(600);
  });

  it('every text reads: 7:1 for the line, 4.5:1 or more for the hint, a busy Retry and the loading line', () => {
    const mix = (selector: string, prop: string) => Number(/var\(--panel, #FFFFFF\) (\d+)%, transparent\)/.exec(value(selector, prop) ?? '')?.[1]) / 100;
    expect(contrast(white, ink)).toBeGreaterThanOrEqual(7);
    expect(mix('.map-v2__state-hint', 'color')).toBe(0.72);
    expect(contrast(over(white, 0.72, ink), ink)).toBeGreaterThanOrEqual(7);
    expect(mix(".map-v2__retry[aria-disabled='true']", 'color')).toBe(0.6);
    expect(contrast(over(white, 0.6, ink), ink)).toBeGreaterThanOrEqual(4.5);
    // Loading by day: the muted token on the page background; at night the soft white on the ink.
    expect(value('.map-v2__state--plain', 'color')).toBe('var(--muted, #5B6472)');
    expect(contrast(hex(tokens.get('--muted')!), hex(tokens.get('--bg')!))).toBeGreaterThanOrEqual(4.5);
    expect(mix('.map-v2--night .map-v2__state--plain', 'color')).toBe(0.72);
    // Retry's outline is a control boundary: 3:1.
    expect(mix('.map-v2__retry', 'border')).toBe(0.48);
    expect(contrast(over(white, 0.48, ink), ink)).toBeGreaterThanOrEqual(3);
  });

  it('Retry is large enough to press and shows a white focus ring on the ink', () => {
    expect(Number.parseFloat(value('.map-v2__retry', 'min-height')!)).toBeGreaterThanOrEqual(36);
    expect(value('.map-v2__retry:focus-visible', 'outline')).toBe('2px solid var(--panel, #FFFFFF)');
    expect(value('.map-v2__retry:focus-visible', 'outline-offset')).toBe('2px');
    expect(own.some((r) => r.decls.some((d) => d.prop === 'outline' && /^(none|0)$/.test(d.value)))).toBe(false);
    expect(value(".map-v2__retry:hover:not([aria-disabled='true'])", 'background')).toBe('color-mix(in srgb, var(--panel, #FFFFFF) 14%, transparent)');
  });

  it('the region of a map that is showing is visually hidden, not display:none, and takes no clicks', () => {
    const off = Object.fromEntries(rule('.map-v2__state--off').decls.map((d) => [d.prop, d.value]));
    expect(off).toMatchObject({ width: '1px', height: '1px', overflow: 'hidden', 'pointer-events': 'none' });
    expect(off.display).toBeUndefined();
    expect(off.visibility).toBeUndefined();
  });

  it('Google\'s grey error box cannot show: the canvas of a map that is not coming is hidden', () => {
    const hidden = rules.find((r) => r.selector === '.map-v2__canvas--hidden')!;
    expect(hidden.decls).toEqual([{ prop: 'visibility', value: 'hidden' }]);
    const src = readFileSync('client/src/components/map/GoogleBaseMap.tsx', 'utf8');
    expect(src).toContain("className={noMap ? 'map-v2__canvas map-v2__canvas--hidden' : 'map-v2__canvas'}");
    expect(src).toContain("const noMap = copy?.tone === 'dark';");
  });
});

describe('one placeholder: the old cards and lines are gone', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(name) ? [p] : [];
  });

  it('no class of the white card, the load overlay or the Business one-line states is left in the client', () => {
    const old = /map-v2__(panel|overlay|checks)|map-v2--state\b|bdr-line|bdr-retry/;
    expect(files('client/src').filter((f) => old.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('GoogleBaseMap renders the placeholder in one place, and nothing on a map is an alert', () => {
    const src = readFileSync('client/src/components/map/GoogleBaseMap.tsx', 'utf8');
    expect(src.match(/<MapPlaceholder /g)).toHaveLength(2); // in the map, and in the frame for a page's own states
    expect(src).not.toMatch(/role="alert"|aria-live="assertive"/);
    expect(src).not.toMatch(/\bSpinner\b/);
    expect(readFileSync('client/src/components/business/v2/route/DeliveryRoutePreview.tsx', 'utf8')).not.toMatch(/role="alert"/);
  });
});
