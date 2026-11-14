import { describe, expect, it, vi } from 'vitest';
import { TravelDataMissingError, pairKey, type DeliveryPlan } from '../../shared/v2/types';
import { createInitialRun } from '../../server/api/v2/initialRun';
import {
  AGENCY, CAFE, PRINT, sampleDeps, sampleScenario, sampleTable, stubEvents, tableTravel,
} from './v2-pipeline-sample';

const stop = (placeId: string, kind: string, arrivalMin: number) => ({
  placeId, kind, arrivalMin, serviceStartMin: arrivalMin, serviceEndMin: arrivalMin + 2,
});

const RELAY_PLAN = {
  id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'relay', relayBusinessId: CAFE,
  legs: [
    {
      tripId: 'emp-1-eve', employeeId: 'emp-1', placeIds: [PRINT, CAFE, 'home-001'],
      stops: [stop(PRINT, 'pickup', 1020), stop(CAFE, 'hub_drop', 1032)],
      finishMin: 1039, extraMin: 4, extraDistanceM: 0, rewardCents: 300,
    },
    {
      tripId: 'emp-2-morn', employeeId: 'emp-2', placeIds: ['home-002', CAFE, AGENCY],
      stops: [stop(CAFE, 'hub_pickup', 1940), stop(AGENCY, 'delivery', 1962)],
      finishMin: 1964, extraMin: 4, extraDistanceM: 0, rewardCents: 300,
    },
  ],
  deliveryMin: 1964, customerPriceCents: 1000, platformContributionCents: 300,
};

const DIRECT_PLAN = {
  id: 'plan-shp-2', shipmentId: 'shp-2', kind: 'direct',
  legs: [
    {
      tripId: 'emp-3-eve', employeeId: 'emp-3', placeIds: [AGENCY, PRINT, 'home-003'],
      stops: [stop(AGENCY, 'pickup', 1020), stop(PRINT, 'delivery', 1052)],
      finishMin: 1059, extraMin: 4, extraDistanceM: 0, rewardCents: 300,
    },
  ],
  deliveryMin: 1054, customerPriceCents: 1000, platformContributionCents: 650,
};

describe('v2 createInitialRun on the hand-built scenario', () => {
  const scenario = sampleScenario();
  const run = createInitialRun(scenario, sampleDeps());

  it('starts run-1 at version 0 in the planning phase, paused at simStartMin', () => {
    expect(run.runId).toBe('run-1');
    expect(run.version).toBe(0);
    expect(run.scenario).toBe(scenario);
    expect(run.clock).toEqual({ phase: 'planning', playing: false, timeMin: scenario.settings.simStartMin, speed: 120 });
  });

  it('builds the enabled trips of every employee from the travel table', () => {
    expect(run.trips).toEqual([
      {
        id: 'emp-1-eve', employeeId: 'emp-1', direction: 'evening', originPlaceId: PRINT,
        destinationPlaceId: 'home-001', departureMin: 1020, baselineDurationMin: 15, baselineDistanceM: 5250,
      },
      {
        id: 'emp-2-eve', employeeId: 'emp-2', direction: 'evening', originPlaceId: AGENCY,
        destinationPlaceId: 'home-002', departureMin: 1030, baselineDurationMin: 25, baselineDistanceM: 8750,
      },
      {
        id: 'emp-2-morn', employeeId: 'emp-2', direction: 'morning', originPlaceId: 'home-002',
        destinationPlaceId: AGENCY, departureMin: 1935, baselineDurationMin: 25, baselineDistanceM: 8750,
      },
      {
        id: 'emp-3-eve', employeeId: 'emp-3', direction: 'evening', originPlaceId: AGENCY,
        destinationPlaceId: 'home-003', departureMin: 1020, baselineDurationMin: 35, baselineDistanceM: 12250,
      },
    ]);
  });

  it('matches one relay through the cafe, one direct, and reports the third as unmatched', () => {
    expect(run.assignments.plans).toEqual([RELAY_PLAN, DIRECT_PLAN]);
    expect(run.assignments.plans[1]).not.toHaveProperty('relayBusinessId');
    expect(run.assignments.unmatched).toEqual([{
      shipmentId: 'shp-3', reason: 'No sender evening commute or recipient morning commute is available',
    }]);
  });

  it('measures computeMs', () => {
    expect(Number.isFinite(run.assignments.computeMs)).toBe(true);
    expect(run.assignments.computeMs).toBeGreaterThanOrEqual(0);
  });

  it('creates one job per leg with the leg index, trip, pickup and drop-off', () => {
    const [relay, direct] = run.assignments.plans;
    expect(run.jobs).toEqual([
      {
        id: 'plan-shp-1-L0', planId: 'plan-shp-1', shipmentId: 'shp-1', employeeId: 'emp-1', legIndex: 0,
        tripId: 'emp-1-eve', pickup: stop(PRINT, 'pickup', 1020), dropoff: stop(CAFE, 'hub_drop', 1032), rewardCents: 300,
      },
      {
        id: 'plan-shp-1-L1', planId: 'plan-shp-1', shipmentId: 'shp-1', employeeId: 'emp-2', legIndex: 1,
        tripId: 'emp-2-morn', pickup: stop(CAFE, 'hub_pickup', 1940), dropoff: stop(AGENCY, 'delivery', 1962), rewardCents: 300,
      },
      {
        id: 'plan-shp-2-L0', planId: 'plan-shp-2', shipmentId: 'shp-2', employeeId: 'emp-3', legIndex: 0,
        tripId: 'emp-3-eve', pickup: stop(AGENCY, 'pickup', 1020), dropoff: stop(PRINT, 'delivery', 1052), rewardCents: 300,
      },
    ]);
    // Jobs point at the plan's own stops, not copies with different times.
    expect(run.jobs[0].dropoff).toBe(relay.legs[0].stops[1]);
    expect(run.jobs[2].pickup).toBe(direct.legs[0].stops[0]);
  });

  it('notifies each business side, the relay point and each job once, naming the relay business as a relay point', () => {
    const n = (id: string, audience: string, audienceId: string, planId: string, message: string, createdSeq: number, jobId?: string) => ({
      id, audience, audienceId, kind: audience === 'business' ? 'delivery_matched' : 'job_assigned',
      shipmentId: planId.replace('plan-', ''), planId, ...(jobId ? { jobId } : {}), message, createdSeq,
    });
    expect(run.notifications).toEqual([
      n('ntf-plan-shp-1-biz-print-shop', 'business', PRINT, 'plan-shp-1',
        'Delivery arranged: "Poster proofs" to Midtown Agency via Corner Cafe (relay point), $10.00.', 1),
      n('ntf-plan-shp-1-biz-agency', 'business', AGENCY, 'plan-shp-1',
        'Incoming delivery: "Poster proofs" from Northside Print Shop via Corner Cafe (relay point).', 2),
      // The relay business itself (#535): it holds the package overnight.
      n('ntf-plan-shp-1-biz-cafe', 'business', CAFE, 'plan-shp-1',
        'Relay point: "Poster proofs" from Northside Print Shop to Midtown Agency is dropped here in the evening and collected the next morning.', 3),
      n('ntf-plan-shp-1-L0', 'employee', 'emp-1', 'plan-shp-1',
        'New delivery job: "Poster proofs". Drop at Corner Cafe; another employee completes delivery. Reward $3.00.', 4, 'plan-shp-1-L0'),
      n('ntf-plan-shp-1-L1', 'employee', 'emp-2', 'plan-shp-1',
        'New delivery job: "Poster proofs". Collect from Corner Cafe and deliver to Midtown Agency. Reward $3.00.', 5, 'plan-shp-1-L1'),
      n('ntf-plan-shp-2-biz-agency', 'business', AGENCY, 'plan-shp-2',
        'Delivery arranged: "Signed contract" to Northside Print Shop, $10.00.', 6),
      n('ntf-plan-shp-2-biz-print-shop', 'business', PRINT, 'plan-shp-2',
        'Incoming delivery: "Signed contract" from Midtown Agency.', 7),
      n('ntf-plan-shp-2-L0', 'employee', 'emp-3', 'plan-shp-2',
        'New delivery job: "Signed contract". Collect from Midtown Agency and deliver to Northside Print Shop. Reward $3.00.', 8, 'plan-shp-2-L0'),
    ]);
  });

  it('never says "hub", "undefined" or a raw place ID in a notification', () => {
    for (const { message } of run.notifications) {
      expect(message).not.toMatch(/hub/i);
      expect(message).not.toContain('undefined');
      expect(message).not.toMatch(/\b(biz|home|emp|shp|plan)-/);
    }
  });

  it('takes the timeline from the injected buildEvents, called once with the plans and jobs', () => {
    const buildEvents = vi.fn(stubEvents);
    const spied = createInitialRun(sampleScenario(), { travel: tableTravel(), buildEvents });
    expect(buildEvents).toHaveBeenCalledTimes(1);
    const [plans, jobs] = buildEvents.mock.calls[0] as [DeliveryPlan[], typeof spied.jobs];
    expect(plans).toBe(spied.assignments.plans);
    expect(jobs).toBe(spied.jobs);
    expect(spied.events).toBe(buildEvents.mock.results[0].value);
    expect(spied.events.map((e) => [e.id, e.kind, e.timeMin])).toEqual([
      ['evt-plan-shp-1-L0', 'hub_drop', 1034],
      ['evt-plan-shp-1-L1', 'delivered', 1964],
      ['evt-plan-shp-2-L0', 'delivered', 1054],
    ]);
  });

  it('is deterministic apart from computeMs and does not change the scenario', () => {
    const before = structuredClone(scenario);
    const again = createInitialRun(scenario, sampleDeps());
    const strip = (r: typeof run) => ({ ...r, assignments: { ...r.assignments, computeMs: 0 } });
    expect(strip(again)).toEqual(strip(run));
    expect(scenario).toEqual(before);
  });
});

describe('v2 createInitialRun with travel data missing', () => {
  it('throws TravelDataMissingError when a pair a candidate needs is not in the table', () => {
    const table = sampleTable();
    delete table[pairKey(PRINT, CAFE)]; // emp-1's detour to the relay business
    let thrown: unknown;
    try {
      createInitialRun(sampleScenario(), sampleDeps(table));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TravelDataMissingError);
    expect(thrown).toMatchObject({ from: PRINT, to: CAFE, what: 'matrix' });
  });

  it('throws TravelDataMissingError when a baseline commute is not in the table', () => {
    const table = sampleTable();
    delete table[pairKey('home-002', AGENCY)]; // emp-2's morning commute
    expect(() => createInitialRun(sampleScenario(), sampleDeps(table))).toThrow(TravelDataMissingError);
  });

  it('does not build a timeline for a run it could not match', () => {
    const table = sampleTable();
    delete table[pairKey(CAFE, AGENCY)];
    const buildEvents = vi.fn(stubEvents);
    expect(() => createInitialRun(sampleScenario(), { travel: tableTravel(table), buildEvents }))
      .toThrow(TravelDataMissingError);
    expect(buildEvents).not.toHaveBeenCalled();
  });
});
