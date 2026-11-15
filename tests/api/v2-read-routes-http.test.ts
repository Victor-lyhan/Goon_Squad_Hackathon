// The MVP II read routes over HTTP, registered the way the bootstrap issue will register them:
// createV2Router({ travel, store, extraRoutes: (r) => registerReadRoutes(r, deps) }) inside createApp.
// Every expected body is the pure view (server/api/v2/views.ts) called directly on the same run and snapshot.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/v2/schemas';
import { TravelDataMissingError } from '../../shared/v2/types';
import {
  businessDashboard, employeeDashboard, jobResponse, mapResponse, shipmentView, simulatorResponse,
} from '../../server/api/v2/views';
import {
  agency, ana, cafe, directJob, lee, relayPlan, sam, sampleRun, snapshotEnd, snapshotEvening, snapshotStart,
  studio, UNCACHED_PAIRS, UNMATCHED_REASON,
} from './v2-sample';
import { sampleCityTravel } from './v2-compare-helper';
import { sampleRunAt, startReadApi, wire, type ReadApi } from './v2-read-routes-helper';

const travel = sampleCityTravel();
let api: ReadApi;

beforeAll(async () => {
  api = await startReadApi({ travel });
});
afterAll(async () => {
  await api.close();
});

/** Runs `request` and returns the snapshot calls it caused. */
async function snapshotCallsDuring<T>(request: () => Promise<T>) {
  const before = api.snapshotCalls.length;
  const result = await request();
  return { result, calls: api.snapshotCalls.slice(before) };
}

const OK_GETS = [
  '/businesses',
  '/businesses/biz-studio/dashboard',
  '/employees',
  '/employees/emp-2/dashboard',
  '/shipments/shp-1',
  '/jobs/plan-shp-1-L1',
  '/map',
  '/simulator',
];
const UNKNOWN_GETS: [string, string][] = [
  ['/businesses/biz-nowhere/dashboard', 'Business not found'],
  ['/employees/emp-99/dashboard', 'Employee not found'],
  ['/shipments/shp-99', 'Shipment not found'],
  ['/jobs/plan-shp-99-L0', 'Job not found'],
];

describe('the nine read routes answer 200 with the body of the pure view (clock at 1110)', () => {
  it('GET /businesses lists every business and takes no snapshot', async () => {
    const { result, calls } = await snapshotCallsDuring(() => api.get('/businesses'));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ businesses: [studio, agency, cafe] });
    expect(calls).toHaveLength(0);
  });

  it('GET /employees lists every employee and takes no snapshot', async () => {
    const { result, calls } = await snapshotCallsDuring(() => api.get('/employees'));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ employees: [sam, ana, lee] });
    expect(calls).toHaveLength(0);
  });

  it('GET /businesses/:id/dashboard', async () => {
    const { result, calls } = await snapshotCallsDuring(() => api.get('/businesses/biz-studio/dashboard'));
    expect(result.status).toBe(200);
    expect(result.body).toEqual(wire(businessDashboard(sampleRun, snapshotEvening, 'biz-studio')));
    expect(result.body.business).toEqual(studio);
    expect(result.body.outgoing.map((v: any) => [v.shipment.id, v.status])).toEqual([['shp-3', 'unmatched'], ['shp-1', 'at_hub']]);
    expect(result.body.incoming.map((v: any) => [v.shipment.id, v.status])).toEqual([['shp-2', 'delivered']]);
    expect(result.body.totals).toEqual({ sent: 2, matched: 1, delivered: 0, spendCents: 1050 });
    expect(result.body).toMatchObject({ phase: 'locked', version: 12 });
    expect(calls).toEqual([{ run: sampleRun, timeMin: 1110 }]);
  });

  it('GET /employees/:id/dashboard', async () => {
    const { result, calls } = await snapshotCallsDuring(() => api.get('/employees/emp-2/dashboard'));
    expect(result.status).toBe(200);
    expect(result.body).toEqual(wire(employeeDashboard(sampleRun, snapshotEvening, 'emp-2')));
    expect(result.body.employee).toEqual(ana);
    expect(result.body.home.id).toBe('home-story-ana');
    expect(result.body.trips.map((t: any) => t.id)).toEqual(['emp-2-eve', 'emp-2-morn']);
    expect(result.body.assigned.map((v: any) => v.job.id)).toEqual(['plan-shp-1-L1']);
    expect(result.body.completed.map((v: any) => v.job.id)).toEqual([directJob.id]);
    expect(result.body).toMatchObject({ earnedCents: 300, projectedCents: 600, phase: 'locked', version: 12 });
    expect(calls).toEqual([{ run: sampleRun, timeMin: 1110 }]);
  });

  it('GET /shipments/:id is the shipment view plus `matched` (the view has a plan)', async () => {
    const { result, calls } = await snapshotCallsDuring(() => api.get('/shipments/shp-1'));
    expect(result.status).toBe(200);
    expect(result.body).toEqual(wire({ ...shipmentView(sampleRun, snapshotEvening, 'shp-1'), matched: true }));
    expect(result.body.plan).toEqual(wire(relayPlan));
    expect(result.body).toMatchObject({
      jobIds: ['plan-shp-1-L0', 'plan-shp-1-L1'], status: 'at_hub', deliveredAtMin: null, unmatchedReason: null, matched: true,
    });
    expect(calls).toEqual([{ run: sampleRun, timeMin: 1110 }]);

    const unmatched = await api.get('/shipments/shp-3');
    expect(unmatched.status).toBe(200);
    expect(unmatched.body).toEqual(wire({ ...shipmentView(sampleRun, snapshotEvening, 'shp-3'), matched: false }));
    expect(unmatched.body).toMatchObject({
      plan: null, jobIds: [], status: 'unmatched', unmatchedReason: UNMATCHED_REASON, matched: false,
    });
  });

  it('GET /jobs/:id', async () => {
    const { result, calls } = await snapshotCallsDuring(() => api.get('/jobs/plan-shp-1-L1'));
    expect(result.status).toBe(200);
    expect(result.body).toEqual(wire(jobResponse(sampleRun, snapshotEvening, 'plan-shp-1-L1')));
    expect(result.body.job.id).toBe('plan-shp-1-L1');
    expect(result.body.status).toBe('assigned');
    expect(result.body.shipment.id).toBe('shp-1');
    expect(result.body.plan.id).toBe('plan-shp-1');
    expect(result.body.trip.id).toBe('emp-2-morn');
    expect(calls).toEqual([{ run: sampleRun, timeMin: 1110 }]);
  });

  it('GET /map is static per run: route lines from the travel provider, no snapshot', async () => {
    const { result, calls } = await snapshotCallsDuring(() => api.get('/map'));
    expect(result.status).toBe(200);
    expect(result.body).toEqual(wire(mapResponse(sampleRun, travel)));
    expect(result.body.runId).toBe('run-3');
    expect(result.body.businesses).toHaveLength(3);
    expect(result.body.homes.map((h: any) => h.id)).toEqual(['home-001', 'home-story-ana', 'home-002']);
    expect(result.body.polylines).toHaveLength(12);
    const notCached = result.body.polylines.filter((p: any) => p.encoded === null).map((p: any) => `${p.from}|${p.to}`);
    expect(notCached.sort()).toEqual([...UNCACHED_PAIRS].sort());
    expect(calls).toHaveLength(0);
  });

  it('GET /simulator', async () => {
    const { result, calls } = await snapshotCallsDuring(() => api.get('/simulator'));
    expect(result.status).toBe(200);
    expect(result.body).toEqual(wire(simulatorResponse(sampleRun, snapshotEvening)));
    expect(result.body).toMatchObject({ runId: 'run-3', version: 12, computeMs: 3, nextEventMin: 1930 });
    expect(result.body.clock).toEqual(sampleRun.clock);
    expect(result.body.snapshot).toEqual(wire(snapshotEvening));
    expect(result.body.plans.map((p: any) => p.id)).toEqual(['plan-shp-1', 'plan-shp-2']);
    expect(result.body.unmatched).toEqual([{ shipmentId: 'shp-3', reason: UNMATCHED_REASON }]);
    expect(calls).toEqual([{ run: sampleRun, timeMin: 1110 }]);
  });

  it('POST /matches/compare answers both sides, each with a result and metrics, and takes no snapshot', async () => {
    const { result, calls } = await snapshotCallsDuring(() => api.call('POST', '/matches/compare', {}));
    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual(['directOnly', 'withRelay']);
    for (const side of [result.body.directOnly, result.body.withRelay]) {
      expect(Object.keys(side).sort()).toEqual(['metrics', 'result']);
      expect(Object.keys(side.result).sort()).toEqual(['computeMs', 'plans', 'unmatched']);
      expect(side.metrics.requested).toBe(3);
      expect(side.metrics.matched).toBe(side.result.plans.length);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('an unknown ID is a 404 with a JSON ApiError', () => {
  it.each(UNKNOWN_GETS)('GET %s -> 404 "%s"', async (url, message) => {
    const res = await api.get(url);
    expect(res.status).toBe(404);
    expect(res.isJson).toBe(true);
    expect(res.body).toEqual({ error: message });
    expect(ApiError.safeParse(res.body).success).toBe(true);
  });

  it('a path this group does not register still gets the router 404', async () => {
    const res = await api.get('/shipments');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

describe('statuses come from the passed snapshot function, at the run clock', () => {
  afterAll(() => api.setRun(sampleRun));

  it('GET /simulator at three clock minutes shows the status change the snapshot function reports', async () => {
    const seen: { timeMin: number; shp1: string | undefined; delivered: number; nextEventMin: number | null }[] = [];
    for (const [timeMin, snapshot] of [[930, snapshotStart], [1110, snapshotEvening], [2160, snapshotEnd]] as const) {
      const run = sampleRunAt(timeMin);
      api.setRun(run);
      const { result, calls } = await snapshotCallsDuring(() => api.get('/simulator'));
      expect(result.status).toBe(200);
      expect(result.body).toEqual(wire(simulatorResponse(run, snapshot)));
      expect(result.body.clock.timeMin).toBe(timeMin);
      expect(result.body.snapshot.timeMin).toBe(timeMin);
      expect(calls).toEqual([{ run, timeMin }]); // one snapshot, at the clock, of the run that was read
      seen.push({
        timeMin,
        shp1: result.body.snapshot.shipmentStatus['shp-1'],
        delivered: result.body.snapshot.metrics.delivered,
        nextEventMin: result.body.nextEventMin,
      });
    }
    expect(seen).toEqual([
      { timeMin: 930, shp1: undefined, delivered: 0, nextEventMin: 1052 }, // the start snapshot holds no statuses
      { timeMin: 1110, shp1: 'at_hub', delivered: 1, nextEventMin: 1930 },
      { timeMin: 2160, shp1: 'delivered', delivered: 2, nextEventMin: null },
    ]);
  });

  it('the portal routes follow the same clock: shipment status, job status and earnings', async () => {
    const seen: unknown[] = [];
    for (const timeMin of [930, 1110, 2160]) {
      api.setRun(sampleRunAt(timeMin));
      const shipment = await api.get('/shipments/shp-1');
      const job = await api.get('/jobs/plan-shp-1-L1');
      const employee = await api.get('/employees/emp-2/dashboard');
      const business = await api.get('/businesses/biz-studio/dashboard');
      seen.push([
        shipment.body.status, shipment.body.deliveredAtMin, shipment.body.matched,
        job.body.status, employee.body.earnedCents, business.body.totals.delivered,
      ]);
    }
    expect(seen).toEqual([
      ['scheduled', null, true, 'assigned', 0, 0],
      ['at_hub', null, true, 'assigned', 300, 0],
      ['delivered', 1952, true, 'completed', 600, 1],
    ]);
  });
});

describe('reads never change state', () => {
  it('no GET (found or not found) and no compare changes the run, its version or calls store.mutate', async () => {
    const before = api.store.get();
    expect(before).toBe(sampleRun); // deep-frozen, so a handler that wrote to it would have thrown
    for (const url of [...OK_GETS, ...UNKNOWN_GETS.map(([url]) => url)]) {
      await api.get(url);
      expect(api.store.get().version, url).toBe(12);
      expect(api.store.get(), url).toBe(before);
    }
    await api.call('POST', '/matches/compare', {});
    expect(api.store.get()).toBe(before);
    expect(api.store.get().version).toBe(12);
    expect(api.mutations()).toBe(0);
  });

  it('two polls of the same state give byte-identical bodies', async () => {
    for (const url of OK_GETS) {
      const first = await api.get(url);
      const second = await api.get(url);
      expect(first.status, url).toBe(200);
      expect(second.text, url).toBe(first.text);
    }
  });
});

describe('GET /map with `ensureLegPolylines` (issue #536)', () => {
  it('answers the same body, then asks for the one plan-leg pair without a line, not for the commute of an employee with no plan', async () => {
    const calls: string[][][] = [];
    const withLines = await startReadApi({
      travel,
      ensureLegPolylines: async (legs) => {
        calls.push(legs.map((leg) => leg.placeIds));
      },
    });
    try {
      const res = await withLines.get('/map');
      expect(res.status).toBe(200);
      expect(res.text).toBe((await api.get('/map')).text); // `api` has no `ensureLegPolylines`
      // Not cached in the sample: Ana's leg pair Studio -> home, and the morning commute of Lee, who has no job.
      expect(calls).toEqual([[['biz-studio', 'home-story-ana']]]);
      expect(withLines.snapshotCalls).toHaveLength(0);
      expect(withLines.mutations()).toBe(0);
      expect(withLines.store.get()).toBe(sampleRun);
    } finally {
      await withLines.close();
    }
  });
});

describe('a travel error inside a handler becomes the documented 503', () => {
  let broken: ReadApi;
  beforeAll(async () => {
    broken = await startReadApi({
      // What the real snapshotAt or a real provider does when a pair is not in the cache.
      snapshotAt: () => {
        throw new TravelDataMissingError('biz-studio', 'biz-cafe', 'polyline');
      },
      travel: {
        durationMin: (from, to) => { throw new TravelDataMissingError(from, to); },
        distanceM: (from, to) => { throw new TravelDataMissingError(from, to); },
        polyline: (from, to) => { throw new TravelDataMissingError(from, to, 'polyline'); },
      },
    });
  });
  afterAll(async () => {
    await broken.close();
  });

  it.each([
    '/businesses/biz-studio/dashboard', '/employees/emp-2/dashboard', '/shipments/shp-1', '/jobs/plan-shp-1-L1', '/simulator',
  ])('GET %s -> 503 travel_data_missing when the snapshot function throws TravelDataMissingError', async (url) => {
    const res = await broken.get(url);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      code: 'travel_data_missing',
      error: 'No route line is cached for biz-studio to biz-cafe. Run npm run fetch:routes and commit fixtures/nyc/.',
    });
  });

  it('GET /map -> 503 when the provider throws', async () => {
    const res = await broken.get('/map');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('travel_data_missing');
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error']);
  });

  it('the routes that need no travel data and no snapshot still answer', async () => {
    expect((await broken.get('/businesses')).status).toBe(200);
    expect((await broken.get('/employees')).status).toBe(200);
  });

  it('an error that is not a travel error is a JSON 500 without the message', async () => {
    const api500 = await startReadApi({
      travel,
      snapshotAt: () => {
        throw new Error('secret detail');
      },
    });
    try {
      const res = await api500.get('/simulator');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
    } finally {
      await api500.close();
    }
  });
});
