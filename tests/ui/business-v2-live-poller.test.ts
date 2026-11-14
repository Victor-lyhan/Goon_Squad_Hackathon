// Poller + shipment-action tests for the MVP II Business workspace data layer (#386), with fake timers.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, type RequestOptions } from '../../client/src/api/v2';
import type { BusinessDashboard, ShipmentResponse, ShipmentView } from '../../shared/v2/api';
import { createBusinessPoller, type BusinessWorkspaceApi } from '../../client/src/components/business/v2/live/businessPoller';
import {
  businessWorkspaceReducer, initialBusinessWorkspaceState, type BusinessWorkspaceAction, type BusinessWorkspaceState,
} from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { ownedBusinessReducer, shipmentActionsWith } from '../../client/src/components/business/v2/live/useBusinessWorkspace';
import { BUSINESSES, DASHBOARD, directOut, plan, shipment, view } from './business-v2-table-sample';

const abortable = <T>(opts: RequestOptions | undefined, ms: number, value: () => T | Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { Promise.resolve().then(value).then(resolve, reject); }, ms);
    opts?.signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ApiRequestError(0, 'Request aborted', undefined, 'abort'));
    });
  });

const dash = (version: number, businessId = DASHBOARD.business.id, outgoing = DASHBOARD.outgoing): BusinessDashboard =>
  ({ ...DASHBOARD, business: { ...DASHBOARD.business, id: businessId }, outgoing, version });

type Fake = {
  api: BusinessWorkspaceApi;
  calls: string[];
  maxConcurrent: number;
  delayMs: number;
  listDelayMs: number;
  mapDelayMs: number;
  /** How many of the next directory loads fail with a network error. */
  failLists: number;
  signals: AbortSignal[];
  runId: string;
  setDash: (id: string, d: BusinessDashboard | Error) => void;
  /** What GET /shipments/:id answers; an unknown ID is a 404. */
  setShipment: (id: string, v: ShipmentView | Error) => void;
};

function fakeApi(): Fake {
  const dashes = new Map<string, BusinessDashboard | Error>();
  const shipments = new Map<string, ShipmentView | Error>();
  let active = 0;
  const f: Fake = {
    calls: [], maxConcurrent: 0, delayMs: 10, listDelayMs: 1, mapDelayMs: 1, failLists: 0, signals: [], runId: 'run-1',
    setDash: (id, d) => { dashes.set(id, d); },
    setShipment: (id, v) => { shipments.set(id, v); },
    api: {
      getShipment: (id, opts) => {
        f.calls.push(`shipment:${id}`);
        return abortable(opts, 5, () => {
          const v = shipments.get(id);
          if (!v) throw new ApiRequestError(404, 'Unknown shipment');
          if (v instanceof Error) throw v;
          return v;
        });
      },
      getBusinessDashboard: (id, opts) => {
        f.calls.push(`dash:${id}`);
        if (opts?.signal) f.signals.push(opts.signal);
        active += 1; f.maxConcurrent = Math.max(f.maxConcurrent, active);
        return abortable(opts, f.delayMs, () => {
          const d = dashes.get(id);
          if (!d) throw new ApiRequestError(404, 'Unknown business');
          if (d instanceof Error) throw d;
          return d;
        }).finally(() => { active -= 1; });
      },
      getBusinesses: (opts) => {
        f.calls.push('businesses');
        const fail = f.failLists > 0;
        if (fail) f.failLists -= 1;
        return abortable(opts, f.listDelayMs, () => {
          if (fail) throw new ApiRequestError(0, 'Failed to fetch', undefined, 'network');
          return { businesses: BUSINESSES };
        });
      },
      getEmployees: (opts) => {
        f.calls.push('employees');
        return abortable(opts, f.listDelayMs, () => ({ employees: [{ id: 'emp-07', name: 'Bo', businessId: 'x' }] as never }));
      },
      getMap: (opts) => { f.calls.push('map'); return abortable(opts, f.mapDelayMs, () => ({ runId: f.runId })); },
    },
  };
  return f;
}

function sinkState() {
  let state: BusinessWorkspaceState = initialBusinessWorkspaceState;
  const actions: BusinessWorkspaceAction[] = [];
  /** The state after every action, in order. */
  const states: BusinessWorkspaceState[] = [];
  return {
    sink: {
      dispatch: (a: BusinessWorkspaceAction) => {
        actions.push(a); state = businessWorkspaceReducer(state, a); states.push(state);
      },
    },
    get: () => state,
    actions,
    states,
  };
}

const count = (f: Fake, call: string) => f.calls.filter((c) => c === call).length;
const ID = DASHBOARD.business.id;

/** Like the simulator playing: every dashboard request gets a higher version. */
function risingVersions(f: Fake) {
  let version = 0;
  const get = f.api.getBusinessDashboard;
  f.api.getBusinessDashboard = (id, opts) => { version += 1; f.setDash(id, dash(version)); return get(id, opts); };
}
/** The versions of the dashboards the sink got, without repeats (a run check sends the shown one again). */
const versionsSent = (actions: BusinessWorkspaceAction[]) =>
  [...new Set(actions.flatMap((a) => (a.type === 'dashboard' ? [a.dashboard.version] : [])))];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('business v2 poller', () => {
  it('polls once per second, loads the directories once and keeps identity on equal polls', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(1));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().view).toBe('ready');
    expect(s.get().businesses).toBe(BUSINESSES);
    expect(s.get().employees).toEqual([{ id: 'emp-07', name: 'Bo' }]);
    const first = s.get();
    await vi.advanceTimersByTimeAsync(3000);
    expect(count(f, `dash:${ID}`)).toBe(4);
    expect(count(f, 'businesses')).toBe(1);
    expect(count(f, 'employees')).toBe(1);
    expect(count(f, 'map')).toBe(1); // run checked once; an unchanged version asks for no further check
    expect(s.get()).toBe(first);
    p.stop();
  });

  it('never overlaps requests when one takes 2.5 s', async () => {
    const f = fakeApi();
    f.delayMs = 2500;
    f.setDash(ID, dash(1));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.maxConcurrent).toBe(1);
    // 2.5 s request + 1 s wait: ticks at 0, ~3.5, ~7 s.
    expect(count(f, `dash:${ID}`)).toBe(3);
    // refetchNow while a poll is in flight queues one poll after it instead of overlapping.
    await vi.advanceTimersByTimeAsync(600);
    const before = count(f, `dash:${ID}`);
    const done = vi.fn();
    void p.refetchNow().then(done);
    expect(count(f, `dash:${ID}`)).toBe(before);
    await vi.advanceTimersByTimeAsync(5100);
    expect(done).toHaveBeenCalled();
    expect(count(f, `dash:${ID}`)).toBe(before + 1);
    expect(f.maxConcurrent).toBe(1);
    p.stop();
  });

  it('stop() aborts the request in flight and nothing reaches the sink after it', async () => {
    const f = fakeApi();
    f.delayMs = 500;
    f.setDash(ID, dash(1));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(100);
    // The lists load with the first dashboard (#599), so they are in before the stop; the dashboard is not.
    expect(s.actions.map((x) => x.type)).toEqual(['directories']);
    p.stop();
    expect(f.signals.length).toBe(1);
    expect(f.signals.every((sig) => sig.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.actions.map((x) => x.type)).toEqual(['directories']);
    expect(s.get().view).toBe('loading');
    expect(count(f, `dash:${ID}`)).toBe(1);
  });

  it('changing the business ID drops a late response for the old ID', async () => {
    const f = fakeApi();
    f.delayMs = 800;
    f.setDash('biz-old', dash(1, 'biz-old'));
    f.setDash('biz-new', dash(5, 'biz-new'));
    let owned = { owner: 'biz-old', state: initialBusinessWorkspaceState };
    const make = (id: string) => createBusinessPoller(id, f.api, {
      dispatch: (action) => { owned = ownedBusinessReducer(owned, { owner: id, action }); },
    });
    const a = make('biz-old');
    a.start();
    await vi.advanceTimersByTimeAsync(300);
    a.stop(); // the hook stops the old poller when the business ID changes
    const b = make('biz-new');
    b.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(owned.owner).toBe('biz-new');
    expect(owned.state.dashboard?.business.id).toBe('biz-new');
    expect(f.signals[0]!.aborted).toBe(true);
    b.stop();
  });

  it('a 404 shows not_found with the first valid business ID, reloading the directory only once', async () => {
    const f = fakeApi();
    const s = sinkState();
    const p = createBusinessPoller('biz-gone', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().view).toBe('not_found');
    expect(s.get().fallbackBusinessId).toBe(BUSINESSES[0]!.id);
    await vi.advanceTimersByTimeAsync(3000);
    expect(count(f, 'businesses')).toBe(1);
    p.stop();
  });

  it('a 503 travel_data_missing shows unavailable, then recovers', async () => {
    const f = fakeApi();
    f.setDash(ID, new ApiRequestError(503, 'no matrix', undefined, 'http', 'travel_data_missing'));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().view).toBe('unavailable');
    expect(s.get().unavailable?.message).toBe('NYC travel data is not loaded on this server yet.');
    f.setDash(ID, dash(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.get().view).toBe('ready');
    expect(count(f, 'businesses')).toBe(1);
    p.stop();
  });

  it('a network error after the first success keeps the data and reconnects', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(1));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    f.setDash(ID, new ApiRequestError(0, 'Failed to fetch', undefined, 'network'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.get().reconnecting).toBe(true);
    expect(s.get().dashboard?.version).toBe(1);
    f.setDash(ID, dash(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.get().reconnecting).toBe(false);
    p.stop();
  });

  it('a run change sets runChanged and reloads the directories', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(1));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    f.runId = 'run-2';
    f.setDash(ID, dash(2));
    // The new version is shown at the next poll; the run is not checked again before 5 s have passed.
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.get().dashboard?.version).toBe(2);
    expect(count(f, 'map')).toBe(1);
    expect(s.get().runChanged).toBe(false);
    // One check follows the change, although the version stays at 2 from here on.
    await vi.advanceTimersByTimeAsync(4000);
    expect(count(f, 'map')).toBe(2);
    expect(s.get().runChanged).toBe(true);
    expect(s.get().runId).toBe('run-2');
    expect(count(f, 'businesses')).toBe(2);
    expect(count(f, 'employees')).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(count(f, 'map')).toBe(2);
    expect(count(f, 'businesses')).toBe(2);
    p.stop();
  });

  it('playback: the version rises on every poll for 10 s, the map is asked for at most 3 times', async () => {
    const f = fakeApi();
    risingVersions(f);
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(count(f, 'map')).toBeGreaterThanOrEqual(2);
    expect(count(f, 'map')).toBeLessThanOrEqual(3);
    expect(versionsSent(s.actions).length).toBeGreaterThanOrEqual(10);
    expect(s.get().dashboard?.version).toBe(count(f, `dash:${ID}`));
    expect(s.get().runChanged).toBe(false);
    expect(count(f, 'businesses')).toBe(1);
    // Playback stops: one more check within 5 s, then none.
    f.api.getBusinessDashboard = (id, opts) => abortable(opts, 10, () => dash(999, id));
    await vi.advanceTimersByTimeAsync(6000);
    const settled = count(f, 'map');
    expect(settled).toBeLessThanOrEqual(4);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(count(f, 'map')).toBe(settled);
    p.stop();
  });

  it('dispatches dashboards while a map request is pending, then adds the run without a new poll', async () => {
    const f = fakeApi();
    f.mapDelayMs = 4000;
    risingVersions(f);
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().view).toBe('ready');
    expect(s.get().runId).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(count(f, 'map')).toBe(1); // still the first request
    expect(versionsSent(s.actions).length).toBeGreaterThanOrEqual(3);
    expect(s.get().runId).toBeNull();
    const polls = count(f, `dash:${ID}`);
    await vi.advanceTimersByTimeAsync(965); // t = 4015: the map answered at 4010, the next poll starts at 4040
    expect(count(f, `dash:${ID}`)).toBe(polls);
    expect(s.get().runId).toBe('run-1');
    expect(s.get().runChanged).toBe(false);
    p.stop();
  });

  it('a failed run check is repeated after 5 s and never holds the dashboard back', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(1));
    const getMap = f.api.getMap;
    f.api.getMap = (opts) => { f.calls.push('map'); return abortable(opts, 1, () => { throw new ApiRequestError(500, 'boom'); }); };
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.get().view).toBe('ready');
    expect(s.get().runId).toBeNull();
    expect(count(f, 'map')).toBe(1);
    f.api.getMap = getMap;
    await vi.advanceTimersByTimeAsync(1100);
    expect(count(f, 'map')).toBe(2);
    expect(s.get().runId).toBe('run-1');
    p.stop();
  });

  it('first load: with the lists delayed by 500 ms the first ready state has the businesses and employees', async () => {
    const f = fakeApi();
    f.listDelayMs = 500;
    f.setDash(ID, dash(1));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.calls.slice(0, 3).sort()).toEqual(['businesses', `dash:${ID}`, 'employees']); // asked for together
    expect(s.get().view).toBe('loading');
    await vi.advanceTimersByTimeAsync(500);
    const firstReady = s.states.find((st) => st.view === 'ready');
    expect(firstReady?.businesses).toBe(BUSINESSES);
    expect(firstReady?.businesses.length).toBeGreaterThan(0);
    expect(firstReady?.employees).toEqual([{ id: 'emp-07', name: 'Bo' }]);
    expect(s.actions[0]?.type).toBe('directories');
    expect(count(f, 'businesses')).toBe(1);
    p.stop();
  });

  it('first load: when the lists fail the dashboard is still shown and the lists are retried on the next poll', async () => {
    const f = fakeApi();
    f.failLists = 1;
    f.setDash(ID, dash(1));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().view).toBe('ready');
    expect(s.get().businesses).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.get().businesses).toBe(BUSINESSES);
    expect(count(f, 'businesses')).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(count(f, 'businesses')).toBe(2);
    p.stop();
  });

  it('after the first dashboard a slow list reload does not hold a dashboard back', async () => {
    const f = fakeApi();
    f.failLists = 1;
    f.setDash(ID, dash(1));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    f.listDelayMs = 800;
    f.setDash(ID, dash(2));
    await vi.advanceTimersByTimeAsync(1000); // the retry is in flight, the dashboard is already there
    expect(s.get().dashboard?.version).toBe(2);
    expect(s.get().businesses).toEqual([]);
    await vi.advanceTimersByTimeAsync(800);
    expect(s.get().businesses).toBe(BUSINESSES);
    p.stop();
  });

  it('stop() leaves nothing running: no timer, no request, no action', async () => {
    const f = fakeApi();
    f.mapDelayMs = 60_000; // a map request and the 5 s wait are both pending at stop()
    risingVersions(f);
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(count(f, 'map')).toBe(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const calls = f.calls.length;
    const sent = s.actions.length;
    p.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.calls.length).toBe(calls);
    expect(s.actions.length).toBe(sent);
    await p.refetchNow();
    expect(f.calls.length).toBe(calls);
  });

  it('refetchNow() after a create polls at once and shows the new row', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(1, ID, []));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    const before = count(f, `dash:${ID}`);
    const res = { ...directOut, matched: true } as ShipmentResponse;
    const create = vi.fn(async () => { f.setDash(ID, dash(2, ID, [directOut])); return res; });
    const actions = shipmentActionsWith({ createShipment: create, patchShipment: vi.fn(), matchShipment: vi.fn() }, p.refetchNow);
    expect(await actions.createShipment({} as never)).toBe(res);
    await vi.advanceTimersByTimeAsync(20);
    expect(count(f, `dash:${ID}`)).toBe(before + 1);
    expect(s.get().dashboard?.outgoing).toHaveLength(1);
    p.stop();
  });
});

// #581: a package this business holds as the relay point is in neither list of the dashboard.
describe('the open delivery outside the dashboard (watch)', () => {
  // shp-9 goes from the print shop to the cafe and is held overnight at this business.
  const held = (status: ShipmentView['status'] = 'at_hub'): ShipmentView => view(
    shipment('shp-9', { label: 'Prints', originBusinessId: 'biz-print', destinationBusinessId: 'biz-cafe' }),
    plan('shp-9', { kind: 'relay', relayBusinessId: ID }), status,
  );
  const heldActions = (s: ReturnType<typeof sinkState>) => s.actions.filter((a) => a.type.startsWith('held'));

  it('reads it with getShipment at once when opened, then on every poll, and stops when it is closed', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(1));
    f.setShipment('shp-9', held());
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(count(f, 'shipment:shp-9')).toBe(0);
    expect(s.get().held).toBeNull();

    p.watch('shp-9'); // the click: not the next tick, now
    await vi.advanceTimersByTimeAsync(50);
    expect(count(f, 'shipment:shp-9')).toBe(1);
    expect(s.get().held).toEqual({ shipmentId: 'shp-9', view: held(), status: 'ready' });
    const first = s.get();

    // Equal answers keep the state object; a changed status (the clock moved) arrives with the next poll.
    await vi.advanceTimersByTimeAsync(2000);
    expect(count(f, 'shipment:shp-9')).toBe(3);
    expect(s.get()).toBe(first);
    f.setShipment('shp-9', held('out_for_delivery'));
    await vi.advanceTimersByTimeAsync(1100); // one more poll (1 s wait + the two requests)
    expect(s.get().held?.view?.status).toBe('out_for_delivery');
    expect(f.maxConcurrent).toBe(1);

    p.watch(null);
    const n = count(f, 'shipment:shp-9');
    await vi.advanceTimersByTimeAsync(3000);
    expect(count(f, 'shipment:shp-9')).toBe(n);
    expect(s.get().held?.shipmentId).toBe('shp-9'); // kept for its notification's time
    p.stop();
  });

  it('never asks for a delivery the dashboard lists', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(1));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.watch(directOut.shipment.id);
    p.start();
    await vi.advanceTimersByTimeAsync(2100);
    p.watch(DASHBOARD.incoming[0].shipment.id);
    await vi.advanceTimersByTimeAsync(2100);
    expect(f.calls.filter((c) => c.startsWith('shipment:'))).toEqual([]);
    expect(heldActions(s)).toEqual([]);
    p.stop();
  });

  it('a delivery named before the first poll (?shipment= in the link) is read with that poll', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(1));
    f.setShipment('shp-9', held());
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.watch('shp-9');
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(count(f, `dash:${ID}`)).toBe(1);
    expect(count(f, 'shipment:shp-9')).toBe(1);
    expect(s.get().held?.status).toBe('ready');
    p.stop();
  });

  it('a 404 is "missing", another failure is "failed" and is tried again; a failed refresh keeps the view', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(1));
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    p.watch('shp-404');
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().held).toEqual({ shipmentId: 'shp-404', view: null, status: 'missing' });

    f.setShipment('shp-9', new ApiRequestError(500, 'boom'));
    p.watch('shp-9');
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().held).toEqual({ shipmentId: 'shp-9', view: null, status: 'failed' });
    f.setShipment('shp-9', held());
    await vi.advanceTimersByTimeAsync(1100);
    expect(s.get().held?.status).toBe('ready');
    f.setShipment('shp-9', new ApiRequestError(0, 'Failed to fetch', undefined, 'network'));
    await vi.advanceTimersByTimeAsync(1100);
    expect(s.get().held).toEqual({ shipmentId: 'shp-9', view: held(), status: 'ready' });
    p.stop();
  });

  it('drops the answer for a delivery that was closed while the request was in flight, and nothing after stop()', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(1));
    f.setShipment('shp-9', held());
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    p.watch('shp-9');
    await vi.advanceTimersByTimeAsync(12); // the dashboard answered, the shipment request is in flight
    expect(count(f, 'shipment:shp-9')).toBe(1);
    p.watch(null);
    await vi.advanceTimersByTimeAsync(50);
    expect(heldActions(s)).toEqual([]);

    p.watch('shp-9');
    await vi.advanceTimersByTimeAsync(12);
    p.stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(heldActions(s)).toEqual([]);
  });

  it('a new run forgets the held delivery and reads the same ID again', async () => {
    const f = fakeApi();
    f.setDash(ID, dash(5));
    f.setShipment('shp-9', held());
    const s = sinkState();
    const p = createBusinessPoller(ID, f.api, s.sink);
    p.watch('shp-9');
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().held?.status).toBe('ready');
    // New city: in that run shp-9 is another package, which this business does not hold.
    f.runId = 'run-2';
    f.setDash(ID, dash(6));
    const other = view(shipment('shp-9', { label: 'Other', originBusinessId: 'biz-print', destinationBusinessId: 'biz-cafe' }), null, 'unmatched');
    f.setShipment('shp-9', other);
    // The run is checked again 5 s after the first check (#599); until then the old run's ID stays.
    await vi.advanceTimersByTimeAsync(1100);
    expect(s.get().runChanged).toBe(false);
    expect(s.get().held).toEqual({ shipmentId: 'shp-9', view: other, status: 'ready' });
    const before = s.actions.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.get().runChanged).toBe(true);
    expect(s.get().runId).toBe('run-2');
    // The run change dropped the held delivery, and it was read again right away, not at the next poll.
    const after = s.actions.slice(before);
    const runAt = after.findIndex((a) => a.type === 'dashboard' && a.runId === 'run-2');
    expect(runAt).toBeGreaterThanOrEqual(0);
    expect(s.states[before + runAt].held).toBeNull();
    expect(after.slice(runAt + 1).find((a) => a.type === 'dashboard' || a.type === 'held')?.type).toBe('held');
    expect(s.get().held).toEqual({ shipmentId: 'shp-9', view: other, status: 'ready' });
    p.stop();
  });
});

describe('shipment actions', () => {
  const res = { ...directOut, matched: false } as ShipmentResponse;

  it('each action returns the response and refetches once', async () => {
    const deps = {
      createShipment: vi.fn(async () => res),
      patchShipment: vi.fn(async () => res),
      matchShipment: vi.fn(async () => res),
    };
    const refetch = vi.fn(async () => {});
    const a = shipmentActionsWith(deps, refetch);
    const req = { fromBusinessId: 'a' } as never;
    expect(await a.createShipment(req)).toBe(res);
    expect(deps.createShipment).toHaveBeenCalledWith(req);
    expect(await a.patchShipment('shp-1', { label: 'x' } as never)).toBe(res);
    expect(deps.patchShipment).toHaveBeenCalledWith('shp-1', { label: 'x' });
    expect(await a.matchShipment('shp-1')).toBe(res);
    expect(deps.matchShipment).toHaveBeenCalledWith('shp-1');
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    new ApiRequestError(409, 'Run is locked'),
    new ApiRequestError(503, 'Google down', undefined, 'http', 'google_unavailable'),
    new ApiRequestError(400, 'Bad weight'),
  ])('rethrows %s unchanged and does not refetch', async (err) => {
    const fail = async () => { throw err; };
    const refetch = vi.fn(async () => {});
    const a = shipmentActionsWith({ createShipment: fail, patchShipment: fail, matchShipment: fail }, refetch);
    await expect(a.createShipment({} as never)).rejects.toBe(err);
    await expect(a.patchShipment('shp-1', {} as never)).rejects.toBe(err);
    await expect(a.matchShipment('shp-1')).rejects.toBe(err);
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('business v2 live folder rules', () => {
  const dir = join(__dirname, '../../client/src/components/business/v2/live');
  const files = readdirSync(dir).filter((n) => /\.tsx?$/.test(n));
  it.each(files)('%s imports only the v2 API, no localStorage, no "hub"', (name) => {
    const src = readFileSync(join(dir, name), 'utf8');
    expect(src).not.toMatch(/api\/client['"]/);
    expect(src).not.toMatch(/from ['"](\.\.\/)+api['"]/);
    expect(src).not.toMatch(/api\/index/);
    expect(src).not.toMatch(/localStorage/);
    expect(src.toLowerCase()).not.toContain('hub');
  });
  it('has the three files', () => {
    expect(files.sort()).toEqual(['businessPoller.ts', 'businessWorkspaceState.ts', 'useBusinessWorkspace.ts']);
  });
});
