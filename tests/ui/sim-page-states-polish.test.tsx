// @vitest-environment jsdom
// #894: the simulator page's own states in plain words, in a real DOM.
//   - first load: the workspace frame with placeholder rows and one line in the map area, never blank;
//   - server unreachable or answering with an error: one sentence, the last good data still on screen;
//   - a stale link (a package the run does not have): "That package isn't in this run." and a way back;
//   - below 900 px: one sentence and a link to `/`, and nothing is fetched.
// The first group mounts the real page (`SimulatorV2`, the real data hook and poller) over a fake
// `fetch`, so "the poll backs off while the server is away" (#921) and "no poll after unmount" are
// counted on the requests the page really sends. The map runs in its no-key state; nothing is loaded from Google.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestOptions } from '../../client/src/api/v2';
import {
  BACK_TO_NETWORK, LOADING_TEXT, MISSING_BUSINESS_TEXT, MISSING_EMPLOYEE_TEXT, MISSING_PACKAGE_TEXT, RECONNECTING_TEXT,
} from '../../client/src/components/sim/v2/compose/simPageView';
import {
  CONNECTION_LOST_MESSAGE, SERVER_ERROR_MESSAGE, SERVER_UNREACHABLE_MESSAGE, errorMessage, pollErrorMessage,
  type SimDataAction,
} from '../../client/src/components/sim/v2/live/simDataModel';
import { SIM_POLL_MS, createSimPoller } from '../../client/src/components/sim/v2/live/simPoller';
import {
  DESKTOP_ONLY_LINK_TEXT, DESKTOP_ONLY_TEXT, DesktopOnlyNotice,
} from '../../client/src/components/sim/v2/page/DesktopOnlyNotice';
import { RETRY_NOW_TEXT } from '../../client/src/components/sim/v2/page/SimStateFrame';
import type { MatchMediaFn } from '../../client/src/components/sim/v2/page/simPageState';
import { staleMessage } from '../../client/src/components/sim/v2/page/urlState';
import SimulatorV2 from '../../client/src/pages/v2/SimulatorV2';
import { button, click, mount, textOf } from './kitDom';
import { httpError, mapOf, networkError, simAt } from './sim-v2-data-fixtures';
import {
  FakeSimServer, T, advance, currentSearch, leftBody, mountPage, packageLabels, readyState, rightBody, runAt,
  sampleMapResponse, settle, stubMatchMedia,
} from './sim-v2-dom-helpers';

const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

// ---------- The fake server behind `fetch` ----------

/** hold: no answer yet; ok: the sample run; down: the request fails (no server); http500: the server answers 500. */
type Mode = 'hold' | 'ok' | 'down' | 'http500';
const net = {
  mode: 'hold' as Mode,
  calls: [] as { url: string; signal: AbortSignal | null }[],
  /** Answers every held request with the sample run (the slow server answered at last). */
  held: [] as Array<() => void>,
  release() { for (const answer of net.held.splice(0)) answer(); },
};

const SIM_URL = '/api/v2/simulator';
const MAP_URL = '/api/v2/map';
const simCalls = () => net.calls.filter((c) => c.url === SIM_URL);
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

function fakeFetch(input: unknown, init?: { signal?: AbortSignal | null }): Promise<Response> {
  const url = String(input);
  const signal = init?.signal ?? null;
  net.calls.push({ url, signal });
  if (net.mode === 'down') return Promise.reject(new TypeError('Failed to fetch'));
  if (net.mode === 'http500') return Promise.resolve(json(500, { error: 'boom: stack trace line 12' }));
  const answer = () => json(200, url === SIM_URL ? runAt(1000) : url === MAP_URL ? sampleMapResponse : { error: 'Not found' });
  if (net.mode === 'hold') {
    return new Promise((resolve, reject) => {
      net.held.push(() => resolve(answer()));
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  }
  return Promise.resolve(answer());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  stubMatchMedia(); // a wide window with motion allowed
  vi.stubGlobal('fetch', fakeFetch);
  net.mode = 'hold';
  net.calls = [];
  net.held = [];
  google.loads = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  expect(google.loads).toBe(0);
});

const mountLivePage = (url = '/simulator') =>
  mount(createElement(MemoryRouter, { initialEntries: [url] }, createElement(SimulatorV2)));

const mapArea = (c: ParentNode) => c.querySelector<HTMLElement>('.sw-map')!;
const banner = (c: ParentNode) => [...c.querySelectorAll<HTMLElement>('.spc-banner')].map((b) => textOf(b));
/** Sentence ends in a text: "Retrying…" is the end of the one sentence, not a second one. */
const sentenceEnds = (s: string) => (s.replace(/…/g, '').match(/[.!?](\s|$)/g) ?? []).length;

// ---------- First load ----------

describe('first load, before the first poll has an answer', () => {
  it('draws the workspace frame: placeholder rows in both panels and one line in the map area', async () => {
    const { container: c } = mountLivePage();
    await settle();

    expect(c.querySelector('.sw-frame')).not.toBeNull();
    // Left: the "Packages" heading over the rows; right: the rows of the run summary. Decoration only.
    expect(textOf(leftBody(c).querySelector('h2')!)).toBe('Packages');
    expect(leftBody(c).querySelectorAll('.sps-rows .sps-row').length).toBeGreaterThanOrEqual(3);
    expect(rightBody(c).querySelectorAll('.sps-rows .sps-row').length).toBeGreaterThanOrEqual(3);
    for (const rows of c.querySelectorAll('.sps-rows')) expect(rows.getAttribute('aria-hidden')).toBe('true');

    // Map area: the one line, announced once (the visible copy is hidden from screen readers).
    const status = mapArea(c).querySelectorAll('[role="status"]');
    expect(status).toHaveLength(1);
    expect(textOf(status[0])).toBe(LOADING_TEXT);
    expect(LOADING_TEXT).toBe('Loading the simulator…');
    expect(mapArea(c).querySelector('.spc-state.sps-map [aria-hidden="true"]:not(.ui-spinner)')?.textContent).toBe(LOADING_TEXT);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(c.querySelector('.spc-map')).toBeNull(); // no map, no Play button yet

    // One request is open; the 1 s ticks wait for it instead of piling up behind it.
    expect(simCalls()).toHaveLength(1);
    await advance(3 * SIM_POLL_MS);
    expect(simCalls()).toHaveLength(1);
  }, T);

  it('fills in when the answer arrives: the placeholders and the line go, the list and the map come', async () => {
    const { container: c } = mountLivePage();
    await settle();
    net.mode = 'ok';
    net.release(); // the slow first answer arrives; the map request it triggers is answered at once
    await settle();

    expect(c.querySelector('.sps-rows')).toBeNull();
    expect(textOf(c)).not.toContain(LOADING_TEXT);
    expect(packageLabels(c).length).toBeGreaterThan(0);
    expect(c.querySelector('.spc-map')).not.toBeNull();
    expect(textOf(rightBody(c))).toContain('Run summary');
  }, T);
});

// ---------- Server unreachable or erroring ----------

describe('the server cannot be reached, or answers with an error', () => {
  it('first load: one sentence and "Retry now" in the frame; the poll backs off, before and after a press', async () => {
    net.mode = 'down';
    const { container: c } = mountLivePage();
    await settle();

    const alert = mapArea(c).querySelector<HTMLElement>('[role="alert"]')!;
    expect(textOf(alert.querySelector('p')!)).toBe("Can't reach the Relay server. Retrying…");
    expect(alert.querySelectorAll('p, h1, h2')).toHaveLength(1); // no title above it, no note under it
    expect(c.querySelector('.sw-frame')).not.toBeNull();
    expect(leftBody(c).querySelector('.sps-rows')).not.toBeNull();
    expect(c.querySelector('[role="status"]')).toBeNull(); // the loading line is gone

    // Polling backs off while the server is away (#921): t = 0, 1, 3 s (then 7, 15, 25 s…), never doubled.
    expect(simCalls()).toHaveLength(1);
    await advance(5 * SIM_POLL_MS); // t = 5 s
    expect(simCalls()).toHaveLength(3);
    expect(textOf(mapArea(c).querySelector('[role="alert"] p')!)).toBe("Can't reach the Relay server. Retrying…");

    // "Retry now" polls at once (one request); it fails too, so the back-off goes on (next at 5 + 8 = 13 s).
    click(button(c, RETRY_NOW_TEXT));
    await settle();
    expect(simCalls()).toHaveLength(4);
    await advance(5 * SIM_POLL_MS); // t = 10 s
    expect(simCalls()).toHaveLength(4);
    expect(net.calls.every((call) => call.url === SIM_URL)).toBe(true); // no map request without a run

    // A server that answers 500: another sentence, and never the server's own error text. An answer of
    // any kind ends the back-off: the next poll is 1 s later.
    net.mode = 'http500';
    await advance(3 * SIM_POLL_MS); // t = 13 s
    expect(simCalls()).toHaveLength(5);
    expect(textOf(mapArea(c).querySelector('[role="alert"] p')!)).toBe('The Relay server returned an error. Retrying…');
    expect(textOf(c)).not.toMatch(/boom|stack trace|Request failed/);

    // The server is back: the page fills in by itself.
    net.mode = 'ok';
    await advance(SIM_POLL_MS);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(packageLabels(c).length).toBeGreaterThan(0);
    expect(simCalls()).toHaveLength(6);
  }, T);

  it('after data was shown: one sentence over the map, the last good data still visible, the poll backs off', async () => {
    net.mode = 'ok';
    const { container: c } = mountLivePage();
    await settle();
    const labels = packageLabels(c);
    expect(labels.length).toBeGreaterThan(0);
    expect(banner(c)).toEqual([]);
    const before = simCalls().length;

    net.mode = 'down';
    await advance(SIM_POLL_MS);
    expect(banner(c)).toEqual(["Can't reach the Relay server. Retrying…"]);
    expect(c.querySelector('.spc-banner')!.getAttribute('role')).toBe('status');
    expect(packageLabels(c)).toEqual(labels);
    expect(textOf(rightBody(c))).toContain('Run summary');
    expect(c.querySelector('.spc-map')).not.toBeNull();
    expect(c.querySelector('.sps-rows')).toBeNull(); // not back to the placeholders

    // Failed at 1 s, so the next polls are at 2 and 4 s, then 8 s (#921).
    await advance(4 * SIM_POLL_MS); // t = 5 s
    expect(simCalls()).toHaveLength(before + 3);
    expect(banner(c)).toEqual([CONNECTION_LOST_MESSAGE]);

    net.mode = 'http500';
    await advance(3 * SIM_POLL_MS); // t = 8 s
    expect(simCalls()).toHaveLength(before + 4);
    expect(banner(c)).toEqual(['The Relay server returned an error. Retrying…']);
    expect(packageLabels(c)).toEqual(labels);
    expect(textOf(c)).not.toMatch(/boom|stack trace/);

    net.mode = 'ok';
    await advance(SIM_POLL_MS);
    expect(banner(c)).toEqual([]);
    expect(packageLabels(c)).toEqual(labels);
    expect(simCalls()).toHaveLength(before + 5);
  }, T);

  it('polling stops on unmount: the open request is aborted and nothing is sent afterwards', async () => {
    // Unmounted while the first request is open.
    const held = mountLivePage();
    await settle();
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].signal?.aborted).toBe(false);
    held.unmount();
    expect(net.calls[0].signal?.aborted).toBe(true);
    await advance(10 * SIM_POLL_MS);
    expect(net.calls).toHaveLength(1);

    // Unmounted while the server is down (the page was backing off: t = 0, 1, 3 s, next at 7 s).
    net.mode = 'down';
    net.calls = [];
    const failing = mountLivePage();
    await advance(4 * SIM_POLL_MS);
    expect(simCalls()).toHaveLength(3);
    failing.unmount();
    await advance(30 * SIM_POLL_MS);
    expect(net.calls).toHaveLength(3);

    // Unmounted with data on screen (the map's slow refresh timer is cleared too: 30 s pass in silence).
    net.mode = 'ok';
    net.calls = [];
    const ready = mountLivePage();
    await advance(2 * SIM_POLL_MS);
    const sent = net.calls.length;
    expect(sent).toBeGreaterThan(0);
    ready.unmount();
    await advance(40 * SIM_POLL_MS);
    expect(net.calls).toHaveLength(sent);
  }, T);
});

describe('the poller alone (no React)', () => {
  it('an unreachable server gets a backing-off poll (1, 2, 4, 8, then 10 s) and never two at once; stop() ends it', async () => {
    let calls = 0;
    const startedAt: number[] = [];
    let open = 0;
    let maxOpen = 0;
    const failing = (ms: number) => (o?: RequestOptions) => new Promise<never>((_, reject) => {
      calls += 1; open += 1; maxOpen = Math.max(maxOpen, open); startedAt.push(Date.now());
      const t = setTimeout(() => { open -= 1; reject(networkError()); }, ms);
      o?.signal?.addEventListener('abort', () => { clearTimeout(t); open -= 1; reject(networkError()); }, { once: true });
    });
    const actions: SimDataAction[] = [];
    const poller = createSimPoller({ getSimulator: failing(50), getMap: async () => mapOf('run-a') }, (a) => actions.push(a));
    const t0 = Date.now();
    poller.start();
    await vi.advanceTimersByTimeAsync(40_000);
    // Each request fails after 50 ms; the wait after it doubles from 1 s and stops at 10 s.
    expect(startedAt.map((t) => t - t0)).toEqual([0, 1050, 3100, 7150, 15_200, 25_250, 35_300]);
    expect(actions.every((a) => a.type === 'pollFailed')).toBe(true);
    expect(actions).toHaveLength(7);

    // Retry pressed twice in a row during an open request: the open one is dropped, never doubled.
    await vi.advanceTimersByTimeAsync(5370); // t = 45.37 s: the back-off poll (45.35 s) is open
    expect(calls).toBe(8);
    void poller.refetchNow();
    void poller.refetchNow();
    expect(maxOpen).toBe(1);
    expect(calls).toBe(10); // the timer's, plus one per press
    await vi.advanceTimersByTimeAsync(9000); // the second press failed at 45.42 s: next poll at 55.42 s
    expect(calls).toBe(10);
    await vi.advanceTimersByTimeAsync(1100);
    expect(calls).toBe(11);

    poller.stop();
    const seen = actions.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(11);
    expect(actions).toHaveLength(seen);
    expect(open).toBe(0);
  });

  it('recovers on the first good answer and keeps the same rhythm', async () => {
    let fail = true;
    let calls = 0;
    const actions: SimDataAction[] = [];
    const poller = createSimPoller({
      getSimulator: async () => { calls += 1; if (fail) throw httpError(500, 'x'); return simAt('run-a', calls); },
      getMap: async () => mapOf('run-a'),
    }, (a) => actions.push(a));
    poller.start();
    await vi.advanceTimersByTimeAsync(2990);
    fail = false;
    await vi.advanceTimersByTimeAsync(3000);
    poller.stop();
    expect(calls).toBe(6);
    expect(actions.map((a) => a.type)).toEqual(['pollFailed', 'pollFailed', 'pollFailed', 'sim', 'map', 'sim', 'sim']);
  });
});

// ---------- Stale link ----------

describe('a stale link: a package the run does not have', () => {
  it('says so in one sentence, keeps the list on screen, and "Back to network" clears the link', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-from-an-old-run');

    const alert = rightBody(c).querySelector<HTMLElement>('[role="alert"]')!;
    expect(textOf(alert)).toBe("That package isn't in this run.");
    expect(textOf(c)).not.toContain('shp-from-an-old-run'); // the raw ID is never shown
    // The list is there to pick from, with nothing selected, and the map shows the whole network.
    const labels = packageLabels(c);
    expect(labels.length).toBeGreaterThan(0);
    expect(c.querySelector('.sw-pkg.is-selected, .sw-pkg[aria-current]')).toBeNull();
    expect(server.calls).toEqual([]);

    click(button(rightBody(c), new RegExp(BACK_TO_NETWORK)));
    expect(currentSearch(server)).toBe('');
    expect(server.navigations.at(-1)).toBe('PUSH'); // Back returns to the link, as for any selection
    expect(rightBody(c).querySelector('[role="alert"]')).toBeNull();
    expect(textOf(rightBody(c))).toContain('Run summary');
    expect(packageLabels(c)).toEqual(labels);
  }, T);

  it('the same sentence for a business and an employee; the three texts are one sentence each', () => {
    const server = new FakeSimServer(readyState(1000));
    const biz = mountPage(server, '?business=biz-gone');
    expect(textOf(rightBody(biz.container).querySelector('[role="alert"]')!)).toBe("That business isn't in this run.");
    biz.unmount();
    const emp = mountPage(server, '?employee=emp-gone');
    expect(textOf(rightBody(emp.container).querySelector('[role="alert"]')!)).toBe("That employee isn't in this run.");

    for (const [kind, text] of [['package', MISSING_PACKAGE_TEXT], ['business', MISSING_BUSINESS_TEXT], ['employee', MISSING_EMPLOYEE_TEXT]] as const) {
      expect(staleMessage(kind)).toBe(text);
      expect(sentenceEnds(text)).toBe(1);
      expect(text).not.toMatch(/scenario|city|\bID\b/i);
    }
  }, T);
});

// ---------- Desktop-only notice ----------

describe('below 900 px: the desktop-only notice', () => {
  it('is one sentence and one link, to /', () => {
    const { container: c } = mount(createElement(DesktopOnlyNotice));
    const notice = c.querySelector<HTMLElement>('.sim-desktop-notice')!;
    expect(textOf(notice.querySelector('.sim-desktop-notice-text')!)).toBe('The simulator needs a wider screen, so open it on a desktop.');
    expect(sentenceEnds(DESKTOP_ONLY_TEXT)).toBe(1);
    const links = [...notice.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/');
    expect(textOf(links[0])).toBe(DESKTOP_ONLY_LINK_TEXT);
    expect(DESKTOP_ONLY_LINK_TEXT).toBe('Back to the homepage');
    expect(notice.querySelectorAll('p')).toHaveLength(2); // the sentence, then the link
    expect(notice.querySelectorAll('button, input, select')).toHaveLength(0);
  });

  it('the page renders only the notice and sends nothing to the server', async () => {
    const narrow: MatchMediaFn = () => ({ matches: true });
    const { container: c } = mount(
      <MemoryRouter initialEntries={['/simulator?package=shp-2&play=1']}><SimulatorV2 matchMedia={narrow} /></MemoryRouter>,
    );
    await advance(5 * SIM_POLL_MS);
    expect(textOf(c)).toBe(`${DESKTOP_ONLY_TEXT}${DESKTOP_ONLY_LINK_TEXT}`);
    expect(c.querySelector('.sw-frame, .spc-state, .spc-map')).toBeNull();
    expect(net.calls).toEqual([]);
  }, T);
});

// ---------- Copy and CSS ----------

describe('the sentences', () => {
  it('a failed poll is one sentence that ends in "Retrying…"; a failed action is not said to retry', () => {
    expect(pollErrorMessage(networkError())).toBe("Can't reach the Relay server. Retrying…");
    expect(pollErrorMessage(httpError(500, 'Internal error'))).toBe('The Relay server returned an error. Retrying…');
    expect(pollErrorMessage(new SyntaxError('Unexpected token < in JSON'))).toBe(SERVER_ERROR_MESSAGE);
    expect(RECONNECTING_TEXT).toBe(CONNECTION_LOST_MESSAGE);
    for (const s of [CONNECTION_LOST_MESSAGE, SERVER_ERROR_MESSAGE]) {
      expect(s.endsWith(' Retrying…')).toBe(true);
      expect(sentenceEnds(s)).toBe(1);
      expect(s).not.toMatch(/every second|sorry|oops|please/i);
    }
    // An action (a control, the comparison) is sent once: its message does not promise a retry.
    expect(errorMessage(networkError())).toBe(SERVER_UNREACHABLE_MESSAGE);
    expect(SERVER_UNREACHABLE_MESSAGE).toBe("Can't reach the Relay server.");
    expect(errorMessage(httpError(409, 'Playback has started.'))).toBe('Playback has started.');
  });
});

describe('states.css', () => {
  const css = readFileSync('client/src/components/sim/v2/page/states.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map([...readFileSync('client/src/styles/tokens.css', 'utf8').matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .map((m) => [m[1], m[2].trim()]));

  it('keeps the page-state area inside the map slot', () => {
    expect(css).toMatch(/\.spc-state\.sps-map\s*\{[^}]*position:\s*static;[^}]*box-sizing:\s*border-box;/);
  });

  it('MVP III look: token colours with their own value as the fallback, small radius, flat, still', () => {
    const uses = [...css.matchAll(/var\(\s*(--[\w-]+)\s*,\s*([^)]+)\)/g)];
    expect(uses.length).toBeGreaterThan(5);
    for (const [, name, fallback] of uses) expect(fallback.trim(), name).toBe(tokens.get(name));
    expect(css).not.toMatch(/var\(\s*--[\w-]+\s*\)/); // every var() has a fallback
    expect(css.replace(/var\([^)]*\)/g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i); // no colour outside a token
    for (const [, px] of css.matchAll(/border-radius:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(4);
    expect(css).not.toMatch(/box-shadow|gradient|animation|transition|@keyframes/i);
    expect(css).not.toMatch(/text-transform/);
  });
});
