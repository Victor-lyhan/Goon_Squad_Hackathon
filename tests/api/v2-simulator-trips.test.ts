// #761 (docs/mvp4.md F2): the simulator answer carries the trips of the employees who drive a plan leg, so a
// journey can play each carrier's whole commute. Over HTTP on the real default NYC run (v2-e2e-nyc-helper.ts:
// the whole server, no key, no network). Nothing is written, so it boots from the committed fixtures/nyc.
// No story ID, name or count is pinned (DECISIONS pass 54): every expectation is read from the run.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { Run } from '../../shared/v2/types';
import { recordFetch, startNycApi, T, type NycApi } from './v2-e2e-nyc-helper';

const net = recordFetch();
let api: NycApi;
let run: Run;
let sim: SimulatorResponse;

beforeAll(async () => {
  api = await startNycApi(net);
  run = await api.exportRun();
  sim = await api.simulator();
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
}, T);

const legs = (s: Pick<SimulatorResponse, 'plans'>) => s.plans.flatMap((p) => p.legs);

describe('GET /api/v2/simulator: `trips` on the default NYC run (#761)', () => {
  it('holds exactly the trips whose id is the tripId of some plan leg', () => {
    const legTripIds = new Set(legs(sim).map((l) => l.tripId));
    expect(legTripIds.size).toBeGreaterThan(0);
    expect(sim.trips).toBeDefined();
    expect(new Set(sim.trips!.map((t) => t.id))).toEqual(legTripIds);
    // Each once.
    expect(sim.trips).toHaveLength(legTripIds.size);
  });

  it('they are the run\'s own trips, in run.trips order, and far fewer than every employee\'s', () => {
    const legTripIds = new Set(legs(sim).map((l) => l.tripId));
    expect(sim.trips).toEqual(run.trips.filter((t) => legTripIds.has(t.id)));
    expect(sim.trips!.length).toBeLessThan(run.trips.length);
    // Not all employees: only the ones who drive a leg.
    const carriers = new Set(legs(sim).map((l) => l.employeeId));
    expect(new Set(sim.trips!.map((t) => t.employeeId))).toEqual(carriers);
    expect(carriers.size).toBeLessThan(run.scenario.employees.length);
  });

  it('each leg\'s trip is its carrier\'s commute: same employee, same end points, departing before the leg finishes', () => {
    const trips = new Map(sim.trips!.map((t) => [t.id, t]));
    for (const leg of legs(sim)) {
      const trip = trips.get(leg.tripId)!;
      expect(trip.employeeId).toBe(leg.employeeId);
      expect(trip.originPlaceId).toBe(leg.placeIds[0]);
      expect(trip.destinationPlaceId).toBe(leg.placeIds[leg.placeIds.length - 1]);
      expect(Number.isInteger(trip.departureMin)).toBe(true);
      expect(trip.departureMin).toBeLessThanOrEqual(leg.stops[0].arrivalMin);
      expect(trip.departureMin).toBeLessThan(leg.finishMin);
    }
  });

  it('POST /simulator/control answers the same trips (a seek moves the clock, not the trips)', async () => {
    const first = legs(sim)[0];
    const moved = await api.control({ action: 'seek', timeMin: first.stops[0].arrivalMin });
    expect(moved.trips).toEqual(sim.trips);
    const back = await api.control({ action: 'seek', timeMin: sim.clock.timeMin });
    expect(back.trips).toEqual(sim.trips);
    expect(back.clock.timeMin).toBe(sim.clock.timeMin);
  });
});
