import { describe, expect, it } from 'vitest';
import { applyCommute, pairsToEnsure, resolveCommute } from '../../server/api/v2/commutePlan';
import {
  pairKey, TravelDataMissingError,
  type DeliveryPlan, type Employee, type Home, type Run, type Stop,
} from '../../shared/v2/types';
import {
  AGENCY, CAFE, HOME_1, HOME_2, METERS_PER_MIN, NEW_HOME_ID, NEW_POINT, STREET_ADDRESSES, STUDIO,
  commuteBody, sampleRun, sampleTable, tableTravel, tableWithNewHome,
} from './v2-commute-plan-sample';

const NEW_HOME: Home = { id: NEW_HOME_ID, neighborhood: 'Astoria', ...NEW_POINT };

const employeeOf = (run: Run, id: string, changes: Partial<Employee> = {}): Employee => ({
  ...run.scenario.employees.find((e) => e.id === id)!, ...changes,
});
const tripsOf = (run: Run, employeeId: string) => run.trips.filter((t) => t.employeeId === employeeId);
const homeIds = (run: Run) => run.scenario.homes.map((h) => h.id);

describe('applyCommute', () => {
  it('rebuilds the two trips from the new departure times and the new home', () => {
    const run = sampleRun();
    const employee = employeeOf(run, 'emp-1', { homeId: NEW_HOME_ID, eveningDepartureMin: 1085, morningDepartureMin: 1890 });
    const result = applyCommute(run, employee, NEW_HOME, tableTravel(tableWithNewHome()));

    const expected = [
      {
        id: 'emp-1-eve', employeeId: 'emp-1', direction: 'evening', originPlaceId: STUDIO, destinationPlaceId: NEW_HOME_ID,
        departureMin: 1085, baselineDurationMin: 40, baselineDistanceM: 40 * METERS_PER_MIN,
      },
      {
        id: 'emp-1-morn', employeeId: 'emp-1', direction: 'morning', originPlaceId: NEW_HOME_ID, destinationPlaceId: STUDIO,
        departureMin: 1890, baselineDurationMin: 40, baselineDistanceM: 40 * METERS_PER_MIN,
      },
    ];
    expect(result).toEqual({ employee, home: NEW_HOME, trips: expected });
    expect(tripsOf(run, 'emp-1')).toEqual(expected);
    expect(run.scenario.employees.find((e) => e.id === 'emp-1')).toEqual(employee);
    expect(run.scenario.employees.map((e) => e.id)).toEqual(['emp-1', 'emp-2', 'emp-3']);
  });

  it('a new workplace changes the trips\' business end', () => {
    const run = sampleRun();
    const result = applyCommute(run, employeeOf(run, 'emp-1', { businessId: AGENCY }), run.scenario.homes[0], tableTravel());
    expect(result.trips.map((t) => [t.originPlaceId, t.destinationPlaceId, t.baselineDurationMin])).toEqual([
      [AGENCY, HOME_1, 35], [HOME_1, AGENCY, 35],
    ]);
  });

  it('leaves the trips of other employees untouched', () => {
    const run = sampleRun();
    const before = structuredClone(run);
    applyCommute(run, employeeOf(run, 'emp-2', { homeId: NEW_HOME_ID, eveningDepartureMin: 1000 }), NEW_HOME, tableTravel(tableWithNewHome()));
    for (const id of ['emp-1', 'emp-3']) {
      expect(tripsOf(run, id)).toEqual(tripsOf(before, id));
      expect(employeeOf(run, id)).toEqual(employeeOf(before, id));
    }
    expect(run.trips).toHaveLength(6);
    expect(new Set(run.trips.map((t) => t.id)).size).toBe(6);
  });

  it('availableMorning: false leaves one trip', () => {
    const run = sampleRun();
    const result = applyCommute(run, employeeOf(run, 'emp-1', { availableMorning: false }), run.scenario.homes[0], tableTravel());
    expect(result.trips.map((t) => t.id)).toEqual(['emp-1-eve']);
    expect(tripsOf(run, 'emp-1').map((t) => t.id)).toEqual(['emp-1-eve']);
    expect(run.trips).toHaveLength(5);
  });

  it('both directions off leaves no trip', () => {
    const run = sampleRun();
    const off = employeeOf(run, 'emp-1', { availableEvening: false, availableMorning: false });
    expect(applyCommute(run, off, run.scenario.homes[0], tableTravel()).trips).toEqual([]);
    expect(tripsOf(run, 'emp-1')).toEqual([]);
    expect(homeIds(run)).toEqual([HOME_1, HOME_2]);
  });

  it('an old home that nobody uses any more disappears, and the new home is listed', () => {
    const run = sampleRun();
    applyCommute(run, employeeOf(run, 'emp-1', { homeId: NEW_HOME_ID }), NEW_HOME, tableTravel(tableWithNewHome()));
    expect(run.scenario.homes).toEqual([run.scenario.homes[0], NEW_HOME]);
    expect(homeIds(run)).toEqual([HOME_2, NEW_HOME_ID]);
  });

  it('an old home that someone else still uses stays', () => {
    const run = sampleRun();
    applyCommute(run, employeeOf(run, 'emp-2', { homeId: NEW_HOME_ID }), NEW_HOME, tableTravel(tableWithNewHome()));
    expect(homeIds(run)).toEqual([HOME_1, HOME_2, NEW_HOME_ID]);
    expect(employeeOf(run, 'emp-3').homeId).toBe(HOME_2);
  });

  it('moving into a home that is already listed adds nothing and returns the stored home', () => {
    const run = sampleRun();
    const stored = run.scenario.homes[1];
    const result = applyCommute(run, employeeOf(run, 'emp-1', { homeId: HOME_2 }), { ...stored, neighborhood: 'Typed label' }, tableTravel());
    expect(result.home).toBe(stored);
    expect(run.scenario.homes).toEqual([{ id: HOME_2, neighborhood: 'Harlem', lat: 40.8116, lng: -73.9465 }]);
  });

  it('saving the same commute again changes nothing', () => {
    const run = sampleRun();
    const before = structuredClone(run);
    applyCommute(run, employeeOf(run, 'emp-1'), run.scenario.homes[0], tableTravel());
    expect(run.scenario).toEqual(before.scenario);
    expect([...run.trips].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...before.trips].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it('a missing pair throws TravelDataMissingError and leaves the run as it was', () => {
    const run = sampleRun();
    const before = structuredClone(run);
    const table = tableWithNewHome();
    delete table[pairKey(NEW_HOME_ID, STUDIO)]; // the morning commute; the evening pair is there
    const employee = employeeOf(run, 'emp-1', { homeId: NEW_HOME_ID, eveningDepartureMin: 1085 });

    let thrown: unknown;
    try {
      applyCommute(run, employee, NEW_HOME, tableTravel(table));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TravelDataMissingError);
    expect(thrown).toMatchObject({ from: NEW_HOME_ID, to: STUDIO, what: 'matrix' });
    expect(run).toEqual(before);
    for (const address of STREET_ADDRESSES) expect((thrown as Error).message).not.toContain(address);
  });

  it('a home that was never fetched throws and leaves the run as it was', () => {
    const run = sampleRun();
    const before = structuredClone(run);
    expect(() => applyCommute(run, employeeOf(run, 'emp-1', { homeId: NEW_HOME_ID }), NEW_HOME, tableTravel(sampleTable())))
      .toThrow(TravelDataMissingError);
    expect(run).toEqual(before);
  });

  it('an employee who is not in the run, or a home that is not the employee\'s, throws and writes nothing', () => {
    const run = sampleRun();
    const before = structuredClone(run);
    const travel = tableTravel(tableWithNewHome());
    expect(() => applyCommute(run, { ...employeeOf(run, 'emp-1'), id: 'emp-99' }, run.scenario.homes[0], travel)).toThrow('Employee not found');
    expect(() => applyCommute(run, employeeOf(run, 'emp-1'), NEW_HOME, travel)).toThrow();
    expect(run).toEqual(before);
  });

  it('leaves existing plans, jobs, notifications, events, the clock and the version as they are', () => {
    const run = sampleRun();
    const stop = (placeId: string, kind: Stop['kind'], at: number): Stop =>
      ({ placeId, kind, arrivalMin: at, serviceStartMin: at, serviceEndMin: at + 2 });
    // emp-1 already carries shp-1 on the way home: Studio -> Cafe -> home-001.
    const plan: DeliveryPlan = {
      id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'direct', deliveryMin: 1064,
      customerPriceCents: 700, platformContributionCents: 350,
      legs: [{
        tripId: 'emp-1-eve', employeeId: 'emp-1', placeIds: [STUDIO, CAFE, HOME_1],
        stops: [stop(STUDIO, 'pickup', 1050), stop(CAFE, 'delivery', 1062)],
        finishMin: 1079, extraMin: 24, extraDistanceM: 7000, rewardCents: 300,
      }],
    };
    run.assignments = { plans: [plan], unmatched: [{ shipmentId: 'shp-2', reason: 'No commute can arrive before the deadline' }], computeMs: 3 };
    const before = structuredClone(run);

    applyCommute(run, employeeOf(run, 'emp-1', { homeId: NEW_HOME_ID }), NEW_HOME, tableTravel(tableWithNewHome()));

    expect(run.assignments).toEqual(before.assignments);
    expect(run.jobs).toEqual(before.jobs);
    expect(run.notifications).toEqual(before.notifications);
    expect(run.events).toEqual(before.events);
    expect(run.clock).toEqual(before.clock);
    expect(run.version).toBe(before.version);
    expect(run.runId).toBe(before.runId);
    // The old home is still an endpoint of that plan's leg, so it stays listed until the plan is gone.
    expect(homeIds(run)).toEqual([HOME_1, HOME_2, NEW_HOME_ID]);

    // Once the plan is gone (recompute), the next save drops the home nobody uses.
    run.assignments = { plans: [], unmatched: [], computeMs: 0 };
    applyCommute(run, employeeOf(run, 'emp-3'), run.scenario.homes[1], tableTravel(tableWithNewHome()));
    expect(homeIds(run)).toEqual([HOME_2, NEW_HOME_ID]);
  });
});

describe('the route\'s chain: resolve -> fetch pairs -> apply', () => {
  it('a new home needs exactly the pairs pairsToEnsure lists', () => {
    const run = sampleRun();
    const resolved = resolveCommute(run, 'emp-2', commuteBody({
      businessId: AGENCY, home: { ...NEW_POINT, neighborhood: 'Astoria' }, eveningDepartureMin: 1110, availableMorning: false,
    }));
    if (!resolved.ok) throw new Error('expected ok');
    expect(resolved.isNewHome).toBe(true);

    // Before the fetch: nothing is known about the new home, so nothing is written.
    const table = sampleTable();
    const before = structuredClone(run);
    expect(() => applyCommute(run, resolved.employee, resolved.home, tableTravel(table))).toThrow(TravelDataMissingError);
    expect(run).toEqual(before);

    // The "fetch": fill in the listed matrix pairs only.
    const { matrix } = pairsToEnsure(resolved.home, resolved.employee.businessId, run.scenario.businesses.map((b) => b.id));
    expect(matrix).toHaveLength(6);
    for (const { from, to } of matrix) table[pairKey(from, to)] = { durationMin: 21, distanceM: 9000 };

    const applied = applyCommute(run, resolved.employee, resolved.home, tableTravel(table));
    expect(applied.trips).toEqual([{
      id: 'emp-2-eve', employeeId: 'emp-2', direction: 'evening', originPlaceId: AGENCY, destinationPlaceId: NEW_HOME_ID,
      departureMin: 1110, baselineDurationMin: 21, baselineDistanceM: 9000,
    }]);
    expect(applied.home).toEqual({ id: NEW_HOME_ID, neighborhood: 'Astoria', lat: 40.7642, lng: -73.9235 });
    expect(homeIds(run)).toEqual([HOME_1, HOME_2, NEW_HOME_ID]);

    // The same point again is now a saved home.
    const again = resolveCommute(run, 'emp-1', commuteBody({ home: { ...NEW_POINT, neighborhood: 'Astoria' } }));
    expect(again).toMatchObject({ ok: true, isNewHome: false, home: { id: NEW_HOME_ID } });
  });
});
