import { describe, expect, it } from 'vitest';
import type { Run } from '../../shared/v2/types';
import {
  businessDashboard, commuteResponse, employeeDashboard, jobResponse, mapResponse, shipmentView, simulatorResponse,
} from '../../server/api/v2/views';
import {
  agency, ana, anaEve, anaMorn, cafe, directJob, directPlan, events, homeAna, homeLee, homeSam, lee, leeEve, leeMorn,
  noteAgencyIncoming, noteAgencySent, noteAnaDirectJob, noteAnaRelayJob, noteSamJob, noteStudioIncoming,
  noteStudioSent, relayJob0, relayJob1, relayPlan, sam, samEve, samMorn, sampleRun, sampleTravel, shp1, shp2, shp3,
  snapshotEnd, snapshotEvening, snapshotStart, studio, undefinedPaths, UNMATCHED_REASON,
} from './v2-sample';

// The sample is deep-frozen, so every call below also proves the views never mutate their inputs.
const run = sampleRun;

// The three shipment views at t = 1110 (Day 1 18:30), written out by hand.
const relayAtCafe = {
  shipment: shp1, plan: relayPlan, jobIds: ['plan-shp-1-L0', 'plan-shp-1-L1'],
  status: 'at_hub', deliveredAtMin: null, unmatchedReason: null,
};
const directDelivered = {
  shipment: shp2, plan: directPlan, jobIds: ['plan-shp-2-L0'],
  status: 'delivered', deliveredAtMin: 1108, unmatchedReason: null,
};
const unmatched = {
  shipment: shp3, plan: null, jobIds: [],
  status: 'unmatched', deliveredAtMin: null, unmatchedReason: UNMATCHED_REASON,
};

describe('v2 shipmentView', () => {
  it('matches the expected object for a relay, a direct and an unmatched package', () => {
    expect(shipmentView(run, snapshotEvening, 'shp-1')).toStrictEqual(relayAtCafe);
    expect(shipmentView(run, snapshotEvening, 'shp-2')).toStrictEqual(directDelivered);
    expect(shipmentView(run, snapshotEvening, 'shp-3')).toStrictEqual(unmatched);
  });

  it('reads progress from the snapshot, never from the run', () => {
    expect(shipmentView(run, snapshotEnd, 'shp-1')).toStrictEqual({ ...relayAtCafe, status: 'delivered', deliveredAtMin: 1952 });
  });

  it('falls back to scheduled / unmatched when the snapshot has no entry', () => {
    expect(shipmentView(run, snapshotStart, 'shp-1')).toStrictEqual({ ...relayAtCafe, status: 'scheduled' });
    expect(shipmentView(run, snapshotStart, 'shp-2')).toStrictEqual({ ...directDelivered, status: 'scheduled', deliveredAtMin: null });
    expect(shipmentView(run, snapshotStart, 'shp-3')).toStrictEqual(unmatched);
  });

  it('orders job IDs by leg, whatever the order of run.jobs', () => {
    const shuffled: Run = { ...run, jobs: [relayJob1, directJob, relayJob0] };
    expect(shipmentView(shuffled, snapshotEvening, 'shp-1')!.jobIds).toEqual(['plan-shp-1-L0', 'plan-shp-1-L1']);
  });
});

describe('v2 businessDashboard', () => {
  it('Studio: outgoing and incoming newest first, totals count committed spend', () => {
    expect(businessDashboard(run, snapshotEvening, 'biz-studio')).toStrictEqual({
      business: studio,
      outgoing: [unmatched, relayAtCafe],   // shp-3 (seq 3) before shp-1 (seq 1)
      incoming: [directDelivered],
      notifications: [noteStudioIncoming, noteStudioSent], // seq 6 before seq 1
      // By hand: Studio sent shp-1 and shp-3; only shp-1 is matched (1000 cents) and it is not delivered yet.
      totals: { sent: 2, matched: 1, delivered: 0, spendCents: 1000 },
      phase: 'locked', version: 12,
    });
  });

  it('Agency: its one outgoing package is matched and delivered', () => {
    expect(businessDashboard(run, snapshotEvening, 'biz-agency')).toStrictEqual({
      business: agency,
      outgoing: [directDelivered],
      incoming: [unmatched, relayAtCafe],
      notifications: [noteAgencySent, noteAgencyIncoming], // seq 5 before seq 2
      totals: { sent: 1, matched: 1, delivered: 1, spendCents: 1000 },
      phase: 'locked', version: 12,
    });
  });

  it('the relay business sends and receives nothing', () => {
    expect(businessDashboard(run, snapshotEvening, 'biz-cafe')).toStrictEqual({
      business: cafe, outgoing: [], incoming: [], notifications: [],
      totals: { sent: 0, matched: 0, delivered: 0, spendCents: 0 },
      phase: 'locked', version: 12,
    });
  });

  it('spend is committed spend: the same before any delivery and after all of them', () => {
    // Studio's only matched outgoing plan is plan-shp-1 (1000). The unmatched shp-3 adds nothing.
    expect(businessDashboard(run, snapshotStart, 'biz-studio')!.totals).toEqual({ sent: 2, matched: 1, delivered: 0, spendCents: 1000 });
    expect(businessDashboard(run, snapshotEnd, 'biz-studio')!.totals).toEqual({ sent: 2, matched: 1, delivered: 1, spendCents: 1000 });
  });

  it('spend sums every matched outgoing plan and ignores incoming ones', () => {
    // A second matched Studio package at 1250 cents: 1000 + 1250 = 2250. The incoming plan-shp-2 (1000) is not Studio's spend.
    const shp4 = { ...shp3, id: 'shp-4', clientRequestId: 'req-4', createdSeq: 4 };
    const plan4 = { ...relayPlan, id: 'plan-shp-4', shipmentId: 'shp-4', customerPriceCents: 1250 };
    const bigger: Run = {
      ...run,
      scenario: { ...run.scenario, shipments: [...run.scenario.shipments, shp4] },
      assignments: { ...run.assignments, plans: [...run.assignments.plans, plan4] },
    };
    const dashboard = businessDashboard(bigger, snapshotEvening, 'biz-studio')!;
    expect(dashboard.outgoing.map((v) => v.shipment.id)).toEqual(['shp-4', 'shp-3', 'shp-1']);
    expect(dashboard.totals).toEqual({ sent: 3, matched: 2, delivered: 0, spendCents: 2250 });
  });

  it('follows the run phase and version', () => {
    const planning: Run = { ...run, version: 13, clock: { ...run.clock, phase: 'planning' } };
    expect(businessDashboard(planning, snapshotEvening, 'biz-cafe')).toMatchObject({ phase: 'planning', version: 13 });
  });
});

describe('v2 employeeDashboard', () => {
  const anaDirect = { job: directJob, status: 'completed', shipment: shp2, plan: directPlan };
  const anaRelay = { job: relayJob1, status: 'assigned', shipment: shp1, plan: relayPlan };

  it('Ana (two jobs): home, trips, assigned vs completed, earned vs projected', () => {
    expect(employeeDashboard(run, snapshotEvening, 'emp-2')).toStrictEqual({
      employee: ana, home: homeAna, trips: [anaEve, anaMorn],
      assigned: [anaRelay],
      completed: [anaDirect],
      // By hand: the evening direct leg (300) is done; the morning relay leg (300) is still to come. 300 + 300 = 600.
      earnedCents: 300, projectedCents: 600,
      notifications: [noteAnaDirectJob, noteAnaRelayJob], // seq 7 before seq 4
      phase: 'locked', version: 12,
    });
  });

  it('Sam (one relay leg, done)', () => {
    expect(employeeDashboard(run, snapshotEvening, 'emp-1')).toStrictEqual({
      employee: sam, home: homeSam, trips: [samEve, samMorn],
      assigned: [],
      completed: [{ job: relayJob0, status: 'completed', shipment: shp1, plan: relayPlan }],
      earnedCents: 300, projectedCents: 300,
      notifications: [noteSamJob],
      phase: 'locked', version: 12,
    });
  });

  it('Lee (no jobs): empty lists and zero cents, even with no earnings entry in the snapshot', () => {
    expect(employeeDashboard(run, snapshotEvening, 'emp-3')).toStrictEqual({
      employee: lee, home: homeLee, trips: [leeEve, leeMorn],
      assigned: [], completed: [], earnedCents: 0, projectedCents: 0, notifications: [],
      phase: 'locked', version: 12,
    });
  });

  it('before playback every job is assigned, ordered by pickup time; projected stays the sum of rewards', () => {
    const start = employeeDashboard(run, snapshotStart, 'emp-2')!;
    // run.jobs lists the morning leg first; the evening pickup (1080) must still come before the morning one (1928).
    expect(start.assigned).toStrictEqual([{ ...anaDirect, status: 'assigned' }, anaRelay]);
    expect(start.completed).toEqual([]);
    expect(start.earnedCents).toBe(0);
    expect(start.projectedCents).toBe(600);
  });

  it('at the end earned equals projected', () => {
    const end = employeeDashboard(run, snapshotEnd, 'emp-2')!;
    expect(end.assigned).toEqual([]);
    expect(end.completed).toStrictEqual([anaDirect, { ...anaRelay, status: 'completed' }]);
    expect(end.earnedCents).toBe(600);
    expect(end.projectedCents).toBe(600);
  });

  it('an in-progress job counts as assigned, not completed', () => {
    const driving = { ...snapshotEvening, jobStatus: { ...snapshotEvening.jobStatus, 'plan-shp-1-L1': 'in_progress' as const } };
    const dashboard = employeeDashboard(run, driving, 'emp-2')!;
    expect(dashboard.assigned.map((v) => [v.job.id, v.status])).toEqual([['plan-shp-1-L1', 'in_progress']]);
    expect(dashboard.completed.map((v) => v.job.id)).toEqual(['plan-shp-2-L0']);
  });

  it('gives null instead of `home: undefined` when the employee\'s home is not in the scenario', () => {
    const broken: Run = { ...run, scenario: { ...run.scenario, homes: [homeSam, homeLee] } };
    expect(employeeDashboard(broken, snapshotEvening, 'emp-2')).toBeNull();
    expect(commuteResponse(broken, 'emp-2')).toBeNull();
    expect(employeeDashboard(broken, snapshotEvening, 'emp-1')!.home).toBe(homeSam);
  });
});

describe('v2 commuteResponse', () => {
  it('carries the employee, the home and both trips', () => {
    expect(commuteResponse(run, 'emp-1', ['shp-3'])).toStrictEqual({
      employee: sam, home: homeSam, trips: [samEve, samMorn], rematchedShipmentIds: ['shp-3'],
    });
    expect(commuteResponse(run, 'emp-3')).toStrictEqual({
      employee: lee, home: homeLee, trips: [leeEve, leeMorn], rematchedShipmentIds: [],
    });
  });
});

describe('v2 jobResponse', () => {
  it('matches the expected object: job view plus its trip', () => {
    expect(jobResponse(run, snapshotEvening, 'plan-shp-1-L1')).toStrictEqual({
      job: relayJob1, status: 'assigned', shipment: shp1, plan: relayPlan, trip: anaMorn,
    });
    expect(jobResponse(run, snapshotEvening, 'plan-shp-2-L0')).toStrictEqual({
      job: directJob, status: 'completed', shipment: shp2, plan: directPlan, trip: anaEve,
    });
    expect(jobResponse(run, snapshotStart, 'plan-shp-1-L0')).toStrictEqual({
      job: relayJob0, status: 'assigned', shipment: shp1, plan: relayPlan, trip: samEve,
    });
  });

  it('gives null when the job points at a plan or trip that no longer exists', () => {
    const noPlan: Run = { ...run, assignments: { ...run.assignments, plans: [directPlan] } };
    const noTrip: Run = { ...run, trips: run.trips.filter((t) => t.id !== anaMorn.id) };
    expect(jobResponse(noPlan, snapshotEvening, 'plan-shp-1-L1')).toBeNull();
    expect(jobResponse(noTrip, snapshotEvening, 'plan-shp-1-L1')).toBeNull();
  });
});

describe('v2 simulatorResponse', () => {
  it('matches the expected object', () => {
    expect(simulatorResponse(run, snapshotEvening)).toStrictEqual({
      runId: 'run-3', version: 12,
      clock: { phase: 'locked', playing: false, timeMin: 1110, speed: 120 },
      snapshot: snapshotEvening,
      plans: [relayPlan, directPlan],
      jobs: [relayJob0, relayJob1, directJob],
      shipments: [shp1, shp2, shp3],
      unmatched: [{ shipmentId: 'shp-3', reason: UNMATCHED_REASON }],
      computeMs: 3,
      nextEventMin: 1930, // events: 1052, 1072, 1082, 1108 | clock 1110 | 1930, 1952
      // #761: only the trips a plan leg rides on, in run.trips order (not samMorn, leeEve, leeMorn).
      trips: [samEve, anaEve, anaMorn],
    });
  });

  it('trips: exactly the trips of the plan legs, in run.trips order; none without a plan', () => {
    const shuffled: Run = { ...run, trips: [leeMorn, anaMorn, samMorn, anaEve, leeEve, samEve] };
    expect(simulatorResponse(shuffled, snapshotEvening).trips).toStrictEqual([anaMorn, anaEve, samEve]);
    const noPlans: Run = { ...run, assignments: { ...run.assignments, plans: [] } };
    expect(simulatorResponse(noPlans, snapshotEvening).trips).toStrictEqual([]);
    const oneLeg: Run = { ...run, assignments: { ...run.assignments, plans: [directPlan] } };
    expect(simulatorResponse(oneLeg, snapshotEvening).trips).toStrictEqual([anaEve]);
  });

  const at = (timeMin: number, evts = events): Run => ({ ...run, events: evts, clock: { ...run.clock, timeMin } });

  it('nextEventMin is the first event strictly after the clock, or null', () => {
    expect(simulatorResponse(at(930), snapshotStart).nextEventMin).toBe(1052);
    expect(simulatorResponse(at(1081), snapshotStart).nextEventMin).toBe(1082);
    expect(simulatorResponse(at(1082), snapshotStart).nextEventMin).toBe(1108); // an event at the clock time is not "next"
    expect(simulatorResponse(at(1951), snapshotEnd).nextEventMin).toBe(1952);
    expect(simulatorResponse(at(1952), snapshotEnd).nextEventMin).toBeNull();
    expect(simulatorResponse(at(2160), snapshotEnd).nextEventMin).toBeNull();
    expect(simulatorResponse(at(930, []), snapshotStart).nextEventMin).toBeNull();
  });

  it('nextEventMin does not depend on the order of run.events', () => {
    expect(simulatorResponse(at(1110, [...events].reverse()), snapshotEvening).nextEventMin).toBe(1930);
    expect(simulatorResponse(at(930, [events[4], events[1], events[5], events[0]]), snapshotStart).nextEventMin).toBe(1052);
  });
});

describe('v2 views: unknown IDs and clean output', () => {
  it('returns null for unknown IDs', () => {
    expect(shipmentView(run, snapshotEvening, 'shp-99')).toBeNull();
    expect(businessDashboard(run, snapshotEvening, 'biz-nope')).toBeNull();
    expect(employeeDashboard(run, snapshotEvening, 'emp-99')).toBeNull();
    expect(commuteResponse(run, 'emp-99')).toBeNull();
    expect(jobResponse(run, snapshotEvening, 'plan-shp-9-L0')).toBeNull();
    // an ID of the wrong kind is unknown too
    expect(businessDashboard(run, snapshotEvening, 'home-001')).toBeNull();
    expect(employeeDashboard(run, snapshotEvening, 'biz-studio')).toBeNull();
    expect(jobResponse(run, snapshotEvening, 'plan-shp-1')).toBeNull();
  });

  it('no view output contains undefined, at any snapshot', () => {
    const { scenario, jobs } = run;
    for (const snapshot of [snapshotStart, snapshotEvening, snapshotEnd]) {
      const outputs: Record<string, unknown> = {
        simulator: simulatorResponse(run, snapshot),
        map: mapResponse(run, sampleTravel().travel),
      };
      for (const s of scenario.shipments) outputs[s.id] = shipmentView(run, snapshot, s.id);
      for (const b of scenario.businesses) outputs[b.id] = businessDashboard(run, snapshot, b.id);
      for (const e of scenario.employees) {
        outputs[e.id] = employeeDashboard(run, snapshot, e.id);
        outputs[`commute ${e.id}`] = commuteResponse(run, e.id);
      }
      for (const j of jobs) outputs[j.id] = jobResponse(run, snapshot, j.id);

      expect(Object.keys(outputs)).toHaveLength(2 + 3 + 3 + 3 + 3 + 3);
      for (const [name, output] of Object.entries(outputs)) {
        expect(output, name).not.toBeNull();
        expect(undefinedPaths(output), name).toEqual([]);
        // and nothing is lost on the wire
        expect(JSON.parse(JSON.stringify(output)), name).toEqual(output);
      }
    }
  });
});
