// @vitest-environment jsdom
// Issue 900: the Business page's live updates never loop or pile up requests. Fake timers and a mocked
// `fetch` under the real client helpers (client/src/api/v2), so aborts and errors take the real path.
// Pinned here: one poll in flight at a time, an older answer never replaces a newer one, the back-off
// while the server is down, the pause in a hidden tab (the real `document`), and the stop on unmount.
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessDashboard, ShipmentView } from '../../shared/v2/api';
import {
  createBusinessPoller, documentVisibility, MAX_BACKOFF_MS, pollDelayMs, POLL_INTERVAL_MS,
  type BusinessPollerOptions,
} from '../../client/src/components/business/v2/live/businessPoller';
import {
  businessWorkspaceReducer, initialBusinessWorkspaceState, type BusinessWorkspaceAction, type BusinessWorkspaceState,
} from '../../client/src/components/business/v2/live/businessWorkspaceState';
import {
  defaultBusinessWorkspaceDeps, useBusinessWorkspace, type BusinessWorkspace,
} from '../../client/src/components/business/v2/live/useBusinessWorkspace';
import { BUSINESSES, DASHBOARD, plan, shipment, view } from './business-v2-table-sample';
import { mount } from './kitDom';

const ID = DASHBOARD.business.id;
const DASH = `/api/v2/businesses/${ID}/dashboard`;
const LISTS = '/api/v2/businesses';
const MAP = '/api/v2/map';
const HELD_ID = 'shp-9';
const HELD = `/api/v2/shipments/${HELD_ID}`;

const dash = (version: number): BusinessDashboard => ({ ...DASHBOARD, version });
// shp-9 goes from the print shop to the cafe and waits overnight at this business: in neither dashboard list.
const held = (status: ShipmentView['status']): ShipmentView => view(
  shipment(HELD_ID, { label: 'Prints', originBusinessId: 'biz-print', destinationBusinessId: 'biz-cafe' }),
  plan(HELD_ID, { kind: 'relay', relayBusinessId: ID }), status,
);

type Call = { path: string; start: number; end: number | null; aborted: boolean };

/**
 * The server behind a mocked `fetch`. An answer is the server's state when the request arrived, delivered
 * `delayMs` (+ `slow`) later, so a slow answer is an old one. `up = false` refuses every connection.
 */
function mockServer() {
  // The fake clock starts at the real time of day; the log counts from the server's start.
  const t0 = Date.now();
  const now = () => Date.now() - t0;
  const s = {
    calls: [] as Call[],
    up: true,
    /** The dashboard's HTTP status. */
    dashStatus: 200,
    version: 1,
    /** Like the simulator playing: every dashboard request gets a higher version. */
    rising: false,
    runId: 'run-1',
    heldStatus: 'at_hub' as ShipmentView['status'],
    delayMs: 10,
    /** Extra time for one request: its path and its number among the requests of that path (1 = first). */
    slow: (_path: string, _nth: number): number => 0,
    /** Map answers delivered so far. */
    mapAnswers: 0,
  };
  const answer = (path: string): { status: number; body: unknown } => {
    if (path === DASH) {
      if (s.dashStatus !== 200) return { status: s.dashStatus, body: { error: 'The server could not answer.' } };
      if (s.rising) s.version += 1;
      return { status: 200, body: dash(s.version) };
    }
    if (path === LISTS) return { status: 200, body: { businesses: BUSINESSES } };
    if (path === '/api/v2/employees') return { status: 200, body: { employees: [{ id: 'emp-07', name: 'Bo' }] } };
    if (path === MAP) return { status: 200, body: { runId: s.runId } };
    if (path === HELD) return { status: 200, body: held(s.heldStatus) };
    return { status: 404, body: { error: 'Not found' } };
  };
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => {
    const path = String(input);
    const nth = s.calls.filter((c) => c.path === path).length + 1;
    const call: Call = { path, start: now(), end: null, aborted: false };
    s.calls.push(call);
    const got = s.up ? answer(path) : null;
    const json = got ? JSON.stringify(got.body) : '';
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        call.end = now();
        if (!got) { reject(new TypeError('Failed to fetch')); return; }
        if (path === MAP) s.mapAnswers += 1;
        resolve({
          ok: got.status >= 200 && got.status < 300, status: got.status,
          json: async () => JSON.parse(json) as unknown, arrayBuffer: async () => new ArrayBuffer(0),
        } as unknown as Response);
      }, s.delayMs + s.slow(path, nth));
      init?.signal?.addEventListener('abort', () => {
        if (call.end !== null) return;
        clearTimeout(timer);
        call.end = now();
        call.aborted = true;
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  });
  return s;
}
type Server = ReturnType<typeof mockServer>;

const of = (s: Server, path: string) => s.calls.filter((c) => c.path === path);
const count = (s: Server, path: string) => of(s, path).length;
/** The wait between the end of each request and the start of the next one. */
const waits = (calls: Call[]) => calls.slice(1).map((c, i) => c.start - (calls[i]!.end ?? Number.NaN));
/** The most of `calls` in flight at one moment (one without an answer counts as still in flight). */
function maxInFlight(calls: Call[]): number {
  const events = calls.flatMap((c) => [[c.start, 1], [c.end ?? Number.POSITIVE_INFINITY, -1]] as [number, number][]);
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let max = 0;
  for (const [, d] of events) { now += d; max = Math.max(max, now); }
  return max;
}

function sinkState() {
  let state: BusinessWorkspaceState = initialBusinessWorkspaceState;
  const actions: BusinessWorkspaceAction[] = [];
  /** The state after every action, in order. */
  const states: BusinessWorkspaceState[] = [];
  return {
    sink: { dispatch: (a: BusinessWorkspaceAction) => { actions.push(a); state = businessWorkspaceReducer(state, a); states.push(state); } },
    get: () => state, actions, states,
  };
}

/** Every poller a test made, so a failed test cannot leave one running into the next test. */
const made: { stop: () => void }[] = [];

/** A poller on the real client helpers; the tab's visibility is the real `document` unless `opts` says so. */
function poller(opts?: BusinessPollerOptions) {
  const s = sinkState();
  const p = createBusinessPoller(ID, defaultBusinessWorkspaceDeps, s.sink, opts);
  made.push(p);
  return { ...s, p };
}

/** Hides or shows the tab the way a browser does: `document.hidden` changes, then `visibilitychange`. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); });
afterEach(() => {
  for (const p of made.splice(0)) p.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as unknown as Record<string, unknown>).hidden;
});

describe('pollDelayMs: the wait before the next poll', () => {
  it('is 1 s, then doubles per failed poll in a row, up to 10 s', () => {
    expect(POLL_INTERVAL_MS).toBe(1000);
    expect(MAX_BACKOFF_MS).toBe(10_000);
    expect([0, 1, 2, 3, 4, 5, 6, 50, 5000].map((n) => pollDelayMs(n))).toEqual(
      [1000, 1000, 2000, 4000, 8000, 10_000, 10_000, 10_000, 10_000],
    );
  });
  it('never goes under the normal interval, also with a small cap', () => {
    expect([0, 1, 2, 3].map((n) => pollDelayMs(n, 3000, 1000))).toEqual([3000, 3000, 3000, 3000]);
    expect([1, 2, 3, 4].map((n) => pollDelayMs(n, 250, 1000))).toEqual([250, 500, 1000, 1000]);
  });
});

describe('one Business poll in flight at a time', () => {
  it('a 2.5 s answer is never overlapped, whatever asks for a poll meanwhile', async () => {
    const s = mockServer();
    s.slow = (path) => (path === DASH ? 2490 : 0);
    const { p } = poller();
    p.start();
    await advance(300);
    void p.refetchNow(); void p.refetchNow(); void p.refetchNow();
    await advance(300);
    p.watch(HELD_ID);
    await advance(300);
    setHidden(true);
    await advance(300);
    setHidden(false);
    expect(count(s, DASH)).toBe(1); // all of it waits for the poll in flight
    await advance(4000);
    p.watch(null);
    p.watch(HELD_ID); // a click after the first dashboard asks for a poll at once
    void p.refetchNow();
    await advance(15_000);
    const calls = of(s, DASH);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(maxInFlight(calls)).toBe(1);
    // Every poll starts after the one before it has its answer.
    for (const w of waits(calls)) expect(w).toBeGreaterThanOrEqual(0);
    p.stop();
  });

  it('five refetchNow() calls during one poll add one poll, and all five resolve with it', async () => {
    const s = mockServer();
    s.slow = (path) => (path === DASH ? 2490 : 0);
    const { p } = poller();
    p.start();
    await advance(100);
    let resolved = 0;
    for (let i = 0; i < 5; i += 1) void p.refetchNow().then(() => { resolved += 1; });
    expect(count(s, DASH)).toBe(1);
    await advance(2500); // t = 2600: the first poll ended at 2500 and the asked-for one started
    expect(count(s, DASH)).toBe(2);
    expect(resolved).toBe(0); // the answer of a request sent before the call is not what they wait for
    await advance(2450); // t = 5050
    expect(resolved).toBe(5);
    expect(count(s, DASH)).toBe(2);
    await advance(900); // t = 5950: the timed poll comes 1 s after the last answer, not five times
    expect(count(s, DASH)).toBe(2);
    await advance(100);
    expect(count(s, DASH)).toBe(3);
    expect(maxInFlight(of(s, DASH))).toBe(1);
    p.stop();
  });
});

describe('an older answer never replaces a newer one', () => {
  it('dashboards reach the page in the order they were asked for, with a 4 s answer in between', async () => {
    const s = mockServer();
    s.rising = true;
    s.slow = (path, nth) => (path === DASH && nth === 3 ? 4000 : 0);
    const { p, actions, states, get } = poller();
    p.start();
    await advance(2500); // the third request left at 2020 and answers at 6030
    void p.refetchNow(); void p.refetchNow();
    await advance(500);
    setHidden(true);
    await advance(500);
    setHidden(false);
    await advance(500);
    p.watch(HELD_ID);
    await advance(5000);
    const sent = actions.flatMap((a) => (a.type === 'dashboard' ? [a.dashboard.version] : []));
    expect(sent.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < sent.length; i += 1) expect(sent[i]).toBeGreaterThanOrEqual(sent[i - 1]!);
    const shown = states.flatMap((st) => (st.dashboard ? [st.dashboard.version] : []));
    for (let i = 1; i < shown.length; i += 1) expect(shown[i]).toBeGreaterThanOrEqual(shown[i - 1]!);
    expect(get().dashboard?.version).toBe(s.version); // the newest answer is the one on screen
    expect(get().runChanged).toBe(false); // a version going down would read as "the city changed"
    expect(maxInFlight(of(s, DASH))).toBe(1);
    p.stop();
  });

  it('the open delivery: a slow read that a later read overtook is dropped', async () => {
    const s = mockServer();
    // The read that follows a run change runs beside the poll. It is the slow one here: 3 s.
    let slowed = false;
    s.slow = (path) => {
      if (path !== HELD || s.mapAnswers < 2 || slowed) return 0;
      slowed = true;
      return 3000;
    };
    const { p, states, get } = poller();
    p.watch(HELD_ID);
    p.start();
    await advance(50);
    expect(get().held?.view?.status).toBe('at_hub');
    s.runId = 'run-2';
    s.version = 2;
    await advance(4990); // t = 5040: the run check answered at 5020 and the slow read left with it
    expect(get().runId).toBe('run-2');
    const slowRead = of(s, HELD).find((c) => c.end === null);
    expect(slowRead?.start).toBe(5020);
    s.heldStatus = 'out_for_delivery'; // the package moves on while the old answer is on its way
    await advance(200); // the next poll (5100) reads it again, fast
    expect(of(s, HELD).some((c) => c.start > slowRead!.start && c.end !== null)).toBe(true);
    expect(get().held?.view?.status).toBe('out_for_delivery');
    const from = states.length;
    await advance(3500); // the slow answer ("at_hub") arrived at 8030
    expect(slowRead!.end).toBe(8030);
    expect(slowRead!.aborted).toBe(false);
    expect(states.slice(from).map((st) => st.held?.view?.status).filter((x) => x !== 'out_for_delivery')).toEqual([]);
    expect(get().held?.view?.status).toBe('out_for_delivery');
    p.stop();
  });
});

describe('while the server is down the poll backs off', () => {
  it('waits 1 s, 2 s, 4 s, 8 s, then 10 s, and is back at 1 s after the first good answer', async () => {
    const s = mockServer();
    const { p, get } = poller();
    p.start();
    await advance(50);
    expect(get().view).toBe('ready');
    s.up = false;
    await advance(39_950); // t = 40 s
    expect(waits(of(s, DASH))).toEqual([1000, 1000, 2000, 4000, 8000, 10_000, 10_000]);
    expect(count(s, DASH)).toBe(8); // 7 while down; a poll every second would be 39
    expect(get().reconnecting).toBe(true);
    expect(get().dashboard?.version).toBe(1); // the data stays on screen
    // Nothing else is asked for while the dashboard gets no answer.
    expect(count(s, LISTS)).toBe(1);
    expect(count(s, MAP)).toBe(1);
    expect(maxInFlight(of(s, DASH))).toBe(1);

    s.up = true;
    await advance(10_000); // t = 50 s: the poll of 46.08 s got through
    expect(waits(of(s, DASH)).slice(7)).toEqual([10_000, 1000, 1000, 1000]);
    expect(get().reconnecting).toBe(false);
    expect(get().view).toBe('ready');
    p.stop();
  });

  it('a 5xx answer backs off the same way, and Retry (refetchNow) polls at once', async () => {
    const s = mockServer();
    s.dashStatus = 500;
    const { p, get } = poller();
    p.start();
    await advance(8000);
    expect(get().view).toBe('error');
    expect(waits(of(s, DASH))).toEqual([1000, 2000, 4000]); // the next one is due at 15.04 s
    s.dashStatus = 200;
    const n = count(s, DASH);
    void p.refetchNow();
    expect(count(s, DASH)).toBe(n + 1);
    await advance(3100);
    expect(get().view).toBe('ready');
    expect(waits(of(s, DASH)).slice(4)).toEqual([1000, 1000, 1000]);
    p.stop();
  });

  it('a 404 is an answer, not an outage: the unknown-business state keeps the 1 s rate', async () => {
    const s = mockServer();
    s.dashStatus = 404;
    const { p, get } = poller();
    p.start();
    await advance(5000);
    expect(get().view).toBe('not_found');
    expect(waits(of(s, DASH))).toEqual([1000, 1000, 1000, 1000]);
    p.stop();
  });

  it('a poll asked for during the wait does not shorten the waits that follow', async () => {
    const s = mockServer();
    const { p } = poller();
    p.start();
    await advance(50);
    s.up = false;
    await advance(4950); // t = 5 s: polls failed at 1.01, 2.02 and 4.03 s; the next is due at 8.04 s
    expect(count(s, DASH)).toBe(4);
    void p.refetchNow();
    expect(count(s, DASH)).toBe(5); // at once
    await advance(7900); // t = 12.9 s: that was the fourth failure in a row, so 8 s follow
    expect(count(s, DASH)).toBe(5);
    await advance(200);
    expect(count(s, DASH)).toBe(6);
    p.stop();
  });

  it('the run check stops with it: at most one while down, and one with the first good dashboard', async () => {
    const s = mockServer();
    s.rising = true; // playback: a run check is wanted after every poll
    const { p, get } = poller();
    p.start();
    await advance(4500);
    expect(count(s, MAP)).toBe(1);
    s.up = false;
    await advance(35_500); // t = 40 s. The check of 5.01 s left before the first failed poll.
    expect(count(s, MAP)).toBe(2);
    s.up = true;
    await advance(1000); // t = 41 s: the poll of 40.11 s got through and sent the check that was held back
    expect(count(s, MAP)).toBe(3);
    expect(get().runId).toBe('run-1');
    expect(get().reconnecting).toBe(false);
    p.stop();
  });
});

describe('in a hidden tab the poll pauses', () => {
  it('the default is the browser\'s own tab state', () => {
    expect(documentVisibility()).not.toBeNull();
    expect(documentVisibility()!.hidden()).toBe(false);
    setHidden(true);
    expect(documentVisibility()!.hidden()).toBe(true);
  });

  it('sends nothing while hidden, polls once on return, then keeps the 1 s rate', async () => {
    const s = mockServer();
    const { p, get } = poller();
    p.start();
    await advance(3050);
    expect(count(s, DASH)).toBe(4);
    setHidden(true);
    const all = s.calls.length;
    await advance(60_000);
    expect(s.calls.length).toBe(all);
    expect(vi.getTimerCount()).toBe(0); // nothing is waiting to fire either

    s.version = 2;
    setHidden(false);
    expect(count(s, DASH)).toBe(5); // at once, not at the next tick
    await advance(50);
    expect(get().dashboard?.version).toBe(2);
    await advance(3000);
    expect(count(s, DASH)).toBe(8);
    expect(waits(of(s, DASH)).slice(4)).toEqual([1000, 1000, 1000]);
    p.stop();
  });

  it('an answer that arrives while hidden is still shown, and no poll follows it', async () => {
    const s = mockServer();
    s.slow = (path) => (path === DASH ? 1990 : 0);
    const { p, get } = poller();
    p.start();
    await advance(500);
    setHidden(true);
    await advance(10_000);
    expect(get().view).toBe('ready');
    expect(count(s, DASH)).toBe(1);
    expect(of(s, DASH)[0]!.aborted).toBe(false);
    p.stop();
  });

  it('hiding and showing the tab during one poll adds one poll, never a second one in flight', async () => {
    const s = mockServer();
    s.slow = (path) => (path === DASH ? 1990 : 0);
    const { p } = poller();
    p.start();
    for (const hidden of [true, false, true, false, true, false]) {
      await advance(100);
      setHidden(hidden);
    }
    expect(count(s, DASH)).toBe(1);
    await advance(1500); // t = 2.1 s: the first poll ended at 2 s
    expect(count(s, DASH)).toBe(2);
    await advance(2800); // t = 4.9 s: the second ended at 4 s; the timed one is due at 5 s
    expect(count(s, DASH)).toBe(2);
    expect(maxInFlight(of(s, DASH))).toBe(1);
    p.stop();
  });

  it('a page opened in a background tab loads once and waits for the tab to be shown', async () => {
    const s = mockServer();
    setHidden(true);
    const { p, get } = poller();
    p.start();
    await advance(30_000);
    expect(get().view).toBe('ready');
    expect(get().businesses).toHaveLength(BUSINESSES.length);
    expect(count(s, DASH)).toBe(1);
    setHidden(false);
    expect(count(s, DASH)).toBe(2);
    p.stop();
  });

  it('while the server is down too: one try on return, and the back-off goes on from where it was', async () => {
    const s = mockServer();
    const { p } = poller();
    p.start();
    await advance(50);
    s.up = false;
    await advance(4950); // t = 5 s: three failed polls
    setHidden(true);
    await advance(60_000);
    expect(count(s, DASH)).toBe(4);
    setHidden(false);
    expect(count(s, DASH)).toBe(5);
    await advance(7900); // the fourth failure in a row: 8 s
    expect(count(s, DASH)).toBe(5);
    await advance(200);
    expect(count(s, DASH)).toBe(6);
    p.stop();
  });

  it('without a tab state (visibility: null) it never pauses', async () => {
    const s = mockServer();
    setHidden(true);
    const { p } = poller({ visibility: null });
    p.start();
    await advance(3050);
    expect(count(s, DASH)).toBe(4);
    p.stop();
  });
});

/** How many `visibilitychange` listeners the code under test has on the document right now. */
function tabListeners() {
  const live = new Set<unknown>();
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  add.mockImplementation(function (this: Document, ...args: Parameters<Document['addEventListener']>) {
    if (args[0] === 'visibilitychange') live.add(args[1]);
    return EventTarget.prototype.addEventListener.apply(this, args);
  });
  remove.mockImplementation(function (this: Document, ...args: Parameters<Document['removeEventListener']>) {
    if (args[0] === 'visibilitychange') live.delete(args[1]);
    return EventTarget.prototype.removeEventListener.apply(this, args);
  });
  return { count: () => live.size, restore: () => { add.mockRestore(); remove.mockRestore(); } };
}

describe('stop() ends everything', () => {
  it('no timer, no request and no tab listener are left, also during a back-off wait', async () => {
    const s = mockServer();
    const listeners = tabListeners();
    const { p, actions } = poller();
    expect(listeners.count()).toBe(0); // a poller that was never started listens to nothing
    p.start();
    expect(listeners.count()).toBe(1);
    await advance(50);
    s.up = false;
    await advance(4950); // waiting for the poll of 8.04 s
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    p.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners.count()).toBe(0);
    listeners.restore();
    const all = s.calls.length;
    const sent = actions.length;
    s.up = true;
    await advance(60_000);
    setHidden(true);
    setHidden(false);
    await p.refetchNow();
    await advance(60_000);
    expect(s.calls.length).toBe(all);
    expect(actions.length).toBe(sent);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useBusinessWorkspace', () => {
  let latest: BusinessWorkspace | null = null;
  function Probe({ id }: { id: string }) {
    latest = useBusinessWorkspace(id);
    return null;
  }
  const open = () => mount(createElement(Probe, { id: ID }));

  it('returns the same fields as before issue 900', async () => {
    mockServer();
    const m = open();
    await advance(50);
    expect(Object.keys(latest!).sort()).toEqual([
      'businesses', 'createShipment', 'dashboard', 'dismissRunChanged', 'employees', 'error', 'fallbackBusinessId',
      'held', 'matchShipment', 'patchShipment', 'reconnecting', 'refetchNow', 'runChanged', 'runId', 'unavailable', 'view',
    ]);
    expect(latest!.view).toBe('ready');
    m.unmount();
  });

  it('pauses in a hidden tab and polls once on return, with nothing passed in by the page', async () => {
    const s = mockServer();
    const m = open();
    await advance(3050);
    expect(count(s, DASH)).toBe(4);
    setHidden(true);
    await advance(30_000);
    expect(count(s, DASH)).toBe(4);
    s.version = 2;
    act(() => { setHidden(false); });
    expect(count(s, DASH)).toBe(5);
    await advance(50);
    expect(latest!.dashboard?.version).toBe(2);
    m.unmount();
  });

  it('unmount aborts the poll in flight and leaves no timer, request or tab listener', async () => {
    const s = mockServer();
    const listeners = tabListeners();
    const m = open();
    await advance(2500);
    expect(latest!.view).toBe('ready');
    expect(listeners.count()).toBe(1);
    s.slow = (path) => (path === DASH ? 5000 : 0);
    await advance(1000); // the poll of 3.03 s is in flight
    const flying = of(s, DASH).filter((c) => c.end === null);
    expect(flying).toHaveLength(1);
    m.unmount();
    await advance(0);
    expect(flying[0]!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners.count()).toBe(0);
    listeners.restore();
    const all = s.calls.length;
    await advance(120_000);
    act(() => { setHidden(true); });
    act(() => { setHidden(false); });
    await advance(10_000);
    expect(s.calls.length).toBe(all);
  });

  it('leave, come back, leave again: no request after leaving, and one poll per second while there', async () => {
    const s = mockServer();
    const first = open();
    await advance(10_000);
    expect(count(s, DASH)).toBe(10);
    first.unmount();
    await advance(0);
    const afterFirst = s.calls.length;
    await advance(30_000);
    expect(s.calls.length).toBe(afterFirst); // zero on the other page

    const second = open();
    await advance(10_000);
    expect(count(s, DASH)).toBe(20); // one poller, not two
    expect(maxInFlight(of(s, DASH))).toBe(1);
    second.unmount();
    await advance(0);
    const afterSecond = s.calls.length;
    await advance(60_000);
    expect(s.calls.length).toBe(afterSecond);
    expect(vi.getTimerCount()).toBe(0);
  });
});
