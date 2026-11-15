// POST /api/v2/planning/reset and POST /api/v2/matches/recompute through the real app, on the small
// hand-built city with a table TravelProvider (DECISIONS pass 6, 12, 47, 51; QUESTIONS pass 6).
import { afterEach, describe, expect, it } from 'vitest';
import { RECOMPUTE_LOCKED } from '../../server/api/v2/planningOps';
import { planCreateShipment } from '../../server/api/v2/shipmentOps';
import type { Store } from '../../server/store';
import { pairKey, type Run } from '../../shared/v2/types';
import { CAFE, PRINT } from './v2-pipeline-sample';
import {
  T, deliveryRequest, expectUntouched, initialRun, matchedScenario, smallScenario, startPlanningApi, stateOf, wire,
  type PlanningApi,
} from './v2-planning-routes-helper';

const SIMULATOR_KEYS = ['clock', 'computeMs', 'jobs', 'nextEventMin', 'plans', 'runId', 'shipments', 'snapshot', 'unmatched', 'version'];
const NOBODY = 'No sender evening commute or recipient morning commute is available';
const ids = (items: { id: string }[]) => items.map((item) => item.id);
/** Plans without the one measured number next to them: the parts of a run a full match decides. */
const matching = (run: Run) => wire({
  plans: run.assignments.plans, unmatched: run.assignments.unmatched, jobs: run.jobs, events: run.events,
});

let api: PlanningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('POST /api/v2/planning/reset', () => {
  it('after Play a delivery request is refused; reset unlocks the run and every package is matched', async () => {
    api = await startPlanningApi({ run: initialRun(matchedScenario()) });
    await api.lock();
    await api.post('/simulator/control', { action: 'seek', timeMin: 1100 });
    const locked = api.store.get();
    expect(locked.clock).toEqual({ phase: 'locked', playing: false, timeMin: 1100, speed: 120 });
    expect(planCreateShipment(locked, deliveryRequest()).kind).toBe('locked');
    expect((await api.post('/matches/recompute')).status).toBe(409);

    const { status, body } = await api.post('/planning/reset');

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(SIMULATOR_KEYS);
    expect(body.runId).toBe('run-2');
    expect(body.version).toBe(locked.version + 1);
    expect(body.clock).toEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 120 });
    // every package has a plan again, and the snapshot is the one of the new cycle at its start
    expect(body.plans.map((p: { shipmentId: string }) => p.shipmentId)).toEqual(['shp-1', 'shp-2']);
    expect(body.unmatched).toEqual([]);
    expect(body.snapshot).toMatchObject({
      runId: 'run-2', version: body.version, timeMin: 930, occurredEvents: [],
      shipmentStatus: { 'shp-1': 'scheduled', 'shp-2': 'scheduled' },
    });
    expect(body.nextEventMin).toBe(1022);
    // the same shape and content the read route gives
    expect(body).toStrictEqual(await api.simulator());

    // a delivery request is accepted again, and so is a recompute
    expect(planCreateShipment(api.store.get(), deliveryRequest()).kind).toBe('create');
    expect((await api.post('/matches/recompute')).status).toBe(200);
  }, T);

  it('matches at once: a run with nothing matched comes back with the full match, at the speed it had', async () => {
    const matched = initialRun(smallScenario());
    const stale: Run = {
      ...structuredClone(matched),
      runId: 'run-7',
      assignments: { plans: [], unmatched: [], computeMs: 0 },
      jobs: [], notifications: [], events: [],
      clock: { phase: 'locked', playing: false, timeMin: 1500, speed: 600 },
    };
    api = await startPlanningApi({ run: stale });

    const { status, body } = await api.post('/planning/reset');

    expect(status).toBe(200);
    expect(body.runId).toBe('run-8');
    expect(body.clock).toEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 600 });
    const stored = api.store.get();
    expect(matching(stored)).toStrictEqual(matching(matched));
    expect(wire(stored.notifications)).toStrictEqual(wire(matched.notifications));
    expect(body.unmatched).toEqual([{ shipmentId: 'shp-3', reason: NOBODY }]);
    // businesses, employees, packages and trips are kept
    expect(stored.scenario).toStrictEqual(stale.scenario);
    expect(stored.trips).toStrictEqual(stale.trips);
    // one write through the store: one version, and the file holds the new cycle
    expect(stored.version).toBe(stale.version + 1);
    expect(await api.savedRun()).toStrictEqual(wire(stored));
  }, T);

  it('counts the cycles up: run-2, then run-3, one version each', async () => {
    api = await startPlanningApi({ run: initialRun(smallScenario()) });
    const first = await api.post('/planning/reset');
    const second = await api.post('/planning/reset');
    expect([first.body.runId, second.body.runId]).toEqual(['run-2', 'run-3']);
    expect([first.body.version, second.body.version]).toEqual([1, 2]);
    expect(second.body.plans).toStrictEqual(first.body.plans);
  }, T);

  it('a travel time the cache lacks is the 503 travel_data_missing, and the old run still answers', async () => {
    api = await startPlanningApi({ run: initialRun(smallScenario()) });
    await api.lock();
    const before = await stateOf(api);
    delete api.table[pairKey(PRINT, CAFE)];

    const { status, body } = await api.post('/planning/reset');

    expect(status).toBe(503);
    expect(body).toEqual({
      error: `No travel time is cached for ${PRINT} to ${CAFE}. Run npm run fetch:routes and commit fixtures/nyc/.`,
      code: 'travel_data_missing',
    });
    await expectUntouched(api, before.run, before.saved, before.simulator);
    expect(api.store.get().clock.phase).toBe('locked');
  }, T);

  it('only POST is registered: GET /planning/reset is the JSON 404', async () => {
    api = await startPlanningApi({ run: initialRun(smallScenario()) });
    const { status, body } = await api.get('/planning/reset');
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
    expect(api.store.get().version).toBe(0);
  }, T);
});

describe('POST /api/v2/matches/recompute', () => {
  it('while planning: the same run and clock, matched again, one version up', async () => {
    const run = initialRun(smallScenario());
    api = await startPlanningApi({ run });

    const { status, body } = await api.post('/matches/recompute');

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(SIMULATOR_KEYS);
    expect(body.runId).toBe('run-1');
    expect(body.version).toBe(run.version + 1);
    expect(body.clock).toEqual(run.clock);
    expect(matching(api.store.get())).toStrictEqual(matching(run));
    expect(wire(api.store.get().notifications)).toStrictEqual(wire(run.notifications));
    expect(body.unmatched).toEqual([{ shipmentId: 'shp-3', reason: NOBODY }]);
    expect(body).toStrictEqual(await api.simulator());
    expect(await api.savedRun()).toStrictEqual(wire(api.store.get()));
  }, T);

  it('picks up what changed since the last match, and rewrites notifications in place with the same ID', async () => {
    // emp-1 accepts no added time at first (the relay leg of shp-1 adds 4 min), so only shp-2 has a plan.
    const allow = (minutes: number) => (draft: Run) => {
      draft.scenario.employees.find((e) => e.id === 'emp-1')!.maxExtraMin = minutes;
    };
    const scenario = smallScenario();
    scenario.employees.find((e) => e.id === 'emp-1')!.maxExtraMin = 0;
    const run = initialRun(scenario);
    expect(ids(run.assignments.plans)).toEqual(['plan-shp-2']);
    const seqs = (notes: Run['notifications']) => Object.fromEntries(notes.map((n) => [n.id, n.createdSeq]));
    const contractNotes = { 'ntf-plan-shp-2-biz-agency': 1, 'ntf-plan-shp-2-biz-print-shop': 2, 'ntf-plan-shp-2-L0': 3 };
    const proofNotes = {
      'ntf-plan-shp-1-biz-print-shop': 4, 'ntf-plan-shp-1-biz-agency': 5, 'ntf-plan-shp-1-biz-cafe': 6,
      'ntf-plan-shp-1-L0': 7, 'ntf-plan-shp-1-L1': 8,
    };
    expect(seqs(run.notifications)).toEqual(contractNotes);
    api = await startPlanningApi({ run });

    // emp-1 allows 8 min and shp-2 gets another name: shp-1 gets its plan, shp-2 keeps its plan ID.
    await api.store.mutate((draft) => {
      allow(8)(draft);
      draft.scenario.shipments.find((s) => s.id === 'shp-2')!.label = 'Countersigned contract';
    });
    const again = await api.post('/matches/recompute');

    expect(again.status).toBe(200);
    expect(ids(again.body.plans).sort()).toEqual(['plan-shp-1', 'plan-shp-2']);
    const notes = api.store.get().notifications;
    // The old three keep their ID and createdSeq and get the new text; the new plan's are numbered after
    // them, although its plan comes first in the list. No ID twice. The relay plan also tells its relay point.
    expect(seqs(notes)).toEqual({ ...contractNotes, ...proofNotes });
    expect(notes).toHaveLength(8);
    for (const note of notes.filter((n) => n.planId === 'plan-shp-2')) {
      expect(note.message).toContain('"Countersigned contract"');
      expect(note.message).not.toContain('Signed contract');
    }

    // emp-1 is back to no added time: the plan goes, and so do its notifications; the others are as they were.
    await api.store.mutate(allow(0));
    const last = await api.post('/matches/recompute');

    expect(ids(last.body.plans)).toEqual(['plan-shp-2']);
    expect(last.body.unmatched.map((u: { shipmentId: string }) => u.shipmentId).sort()).toEqual(['shp-1', 'shp-3']);
    expect(api.store.get().notifications).toStrictEqual(notes.filter((n) => n.planId === 'plan-shp-2'));
    expect(ids(api.store.get().jobs)).toEqual(['plan-shp-2-L0']);
    expect(api.store.get().events.every((e) => e.planId === 'plan-shp-2')).toBe(true);

    // "Start new planning cycle" follows the same rule (DECISIONS pass 12).
    await api.store.mutate(allow(8));
    const cycle = await api.post('/planning/reset');
    expect(cycle.body.runId).toBe('run-2');
    expect(seqs(api.store.get().notifications)).toEqual({ ...contractNotes, ...proofNotes });
  }, T);

  it('while locked: 409 with the reason, and nothing changes (same version)', async () => {
    api = await startPlanningApi({ run: initialRun(smallScenario()) });
    await api.lock();
    const before = await stateOf(api);

    const { status, body } = await api.post('/matches/recompute');

    expect(status).toBe(409);
    expect(body).toEqual({ error: RECOMPUTE_LOCKED });
    expect(body.error).toBe('The simulation is playing. Press Back to start in the simulator to recompute.');
    await expectUntouched(api, before.run, before.saved, before.simulator);
  }, T);

  it('the lock is read inside the mutation, so a Play that was queued first refuses the recompute', async () => {
    // A store whose get() still shows the run from before Play: a route that decided on get() would recompute.
    const planning = initialRun(smallScenario());
    const behind = (real: Store<Run>): Store<Run> => ({ ...real, get: () => planning });
    api = await startPlanningApi({ run: planning, wrapStore: behind });
    await api.lock();
    const version = api.store.get().version;

    const { status, body } = await api.post('/matches/recompute');

    expect(status).toBe(409);
    expect(body).toEqual({ error: RECOMPUTE_LOCKED });
    expect(api.store.get().version).toBe(version);
  }, T);

  it('a travel time the cache lacks is the 503 travel_data_missing, and nothing changes', async () => {
    api = await startPlanningApi({ run: initialRun(smallScenario()) });
    const before = await stateOf(api);
    delete api.table[pairKey(PRINT, CAFE)];

    const { status, body } = await api.post('/matches/recompute');

    expect(status).toBe(503);
    expect(body.code).toBe('travel_data_missing');
    expect(body.error).toContain(`${PRINT} to ${CAFE}`);
    await expectUntouched(api, before.run, before.saved, before.simulator);

    // a refusal does not block the next request
    api.table[pairKey(PRINT, CAFE)] = { durationMin: 10, distanceM: 3500 };
    const next = await api.post('/matches/recompute');
    expect(next.status).toBe(200);
    expect(next.body.version).toBe(before.run.version + 1);
  }, T);
});
