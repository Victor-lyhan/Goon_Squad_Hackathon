import { describe, expect, it } from 'vitest';
import { pairKey, type Run, type TravelProvider } from '../../shared/v2/types';
import { mapResponse } from '../../server/api/v2/views';
import {
  agency, cachedPolylines, cafe, homeAna, homeLee, homeSam, homeUnused, sampleRun, sampleTravel, studio,
  UNCACHED_PAIRS, undefinedPaths,
} from './v2-sample';

// Byte limit for the sample's map body (3 businesses, 3 homes, 3 employees, 12 route lines with short test polylines).
// It is 1,836 bytes today; 4 KB leaves room for a field or two but fails if the body starts carrying
// whole employees, trips or plans.
const MAP_BYTE_LIMIT = 4096;

const run = sampleRun;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

// Every ordered pair the sample needs, by hand, already in `from` then `to` order.
const EXPECTED_PAIRS: [string, string][] = [
  ['biz-agency', 'biz-studio'],         // direct leg: pickup -> delivery
  ['biz-agency', 'home-story-ana'],     // Ana's evening baseline
  ['biz-cafe', 'biz-agency'],           // relay leg 1: relay point -> delivery
  ['biz-cafe', 'home-001'],             // relay leg 0: relay point -> Sam's home
  ['biz-studio', 'biz-cafe'],           // relay leg 0: pickup -> relay point
  ['biz-studio', 'home-001'],           // Sam's evening baseline
  ['biz-studio', 'home-002'],           // Lee's evening baseline
  ['biz-studio', 'home-story-ana'],     // direct leg: delivery -> Ana's home (not cached)
  ['home-001', 'biz-studio'],           // Sam's morning baseline
  ['home-002', 'biz-studio'],           // Lee's morning baseline (not cached)
  ['home-story-ana', 'biz-agency'],     // Ana's morning baseline
  ['home-story-ana', 'biz-cafe'],       // relay leg 1: Ana's home -> relay point
];

describe('v2 mapResponse', () => {
  it('matches the expected object', () => {
    expect(mapResponse(run, sampleTravel().travel)).toStrictEqual({
      runId: 'run-3',
      businesses: [studio, agency, cafe],
      homes: [homeSam, homeAna, homeLee],
      employees: [
        { id: 'emp-1', name: 'Sam', businessId: 'biz-studio', homeId: 'home-001' },
        { id: 'emp-2', name: 'Ana', businessId: 'biz-agency', homeId: 'home-story-ana' },
        { id: 'emp-3', name: 'Lee', businessId: 'biz-studio', homeId: 'home-002' },
      ],
      polylines: EXPECTED_PAIRS.map(([from, to]) => ({ from, to, encoded: cachedPolylines[pairKey(from, to)] ?? null })),
    });
  });

  it('contains each baseline pair and each leg pair exactly once', () => {
    const keys = mapResponse(run, sampleTravel().travel).polylines.map((p) => pairKey(p.from, p.to));
    for (const trip of run.trips) {
      expect(keys.filter((k) => k === pairKey(trip.originPlaceId, trip.destinationPlaceId)), trip.id).toHaveLength(1);
    }
    for (const plan of run.assignments.plans) {
      for (const leg of plan.legs) {
        expect(leg.placeIds.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < leg.placeIds.length; i++) {
          const key = pairKey(leg.placeIds[i - 1], leg.placeIds[i]);
          expect(keys.filter((k) => k === key), `${leg.tripId} ${key}`).toHaveLength(1);
        }
      }
    }
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(12); // 6 baselines + 6 leg pairs, nothing else
  });

  it('keeps A -> B and B -> A as two different lines', () => {
    const lines = mapResponse(run, sampleTravel().travel).polylines;
    const there = lines.find((p) => p.from === 'biz-studio' && p.to === 'home-001')!;
    const back = lines.find((p) => p.from === 'home-001' && p.to === 'biz-studio')!;
    expect(there.encoded).toBe(cachedPolylines['biz-studio|home-001']);
    expect(back.encoded).toBe(cachedPolylines['home-001|biz-studio']);
    expect(there.encoded).not.toBe(back.encoded);
  });

  it('de-duplicates a pair used by several trips and legs, and asks the travel provider once per pair', () => {
    // Every trip and every plan twice: all 12 pairs now appear two times in the input.
    const doubled: Run = {
      ...run,
      trips: [...run.trips, ...run.trips],
      assignments: { ...run.assignments, plans: [...run.assignments.plans, ...run.assignments.plans] },
    };
    const { travel, calls } = sampleTravel();
    expect(mapResponse(doubled, travel)).toStrictEqual(mapResponse(run, sampleTravel().travel));
    expect([...calls].sort()).toEqual(EXPECTED_PAIRS.map(([from, to]) => pairKey(from, to)).sort());

    // A leg pair that is also somebody's baseline commute is still one line.
    const overlap: Run = {
      ...run,
      trips: [...run.trips, { ...run.trips[0], id: 'emp-9-eve', employeeId: 'emp-9', originPlaceId: 'biz-studio', destinationPlaceId: 'biz-cafe' }],
    };
    expect(mapResponse(overlap, sampleTravel().travel).polylines).toHaveLength(12);
  });

  it('a pair without a cached polyline has encoded: null', () => {
    const lines = mapResponse(run, sampleTravel().travel).polylines;
    const missing = lines.filter((p) => p.encoded === null).map((p) => pairKey(p.from, p.to));
    expect(missing.sort()).toEqual([...UNCACHED_PAIRS].sort());
    for (const line of lines) expect(line.encoded === null || line.encoded.length > 0).toBe(true);

    // With an empty cache every line is still listed, all null.
    const none = mapResponse(run, sampleTravel({}).travel).polylines;
    expect(none.map((p) => [p.from, p.to])).toEqual(EXPECTED_PAIRS);
    expect(none.every((p) => p.encoded === null)).toBe(true);

    // A provider backed by a plain JSON lookup may hand back undefined for a missing key: still null on the wire.
    const loose = { polyline: (from: string, to: string) => cachedPolylines[pairKey(from, to)] } as Pick<TravelProvider, 'polyline'>;
    const fromLoose = mapResponse(run, loose);
    expect(undefinedPaths(fromLoose)).toEqual([]);
    expect(fromLoose).toStrictEqual(mapResponse(run, sampleTravel().travel));
  });

  it('homes not used by any employee are absent', () => {
    const map = mapResponse(run, sampleTravel().travel);
    expect(run.scenario.homes).toContain(homeUnused);
    expect(map.homes.map((h) => h.id)).toEqual(['home-001', 'home-story-ana', 'home-002']);
    expect(JSON.stringify(map)).not.toContain(homeUnused.id);

    // Two employees sharing a home: it is listed once.
    const shared: Run = {
      ...run,
      scenario: { ...run.scenario, employees: run.scenario.employees.map((e) => ({ ...e, homeId: 'home-001' })) },
    };
    expect(mapResponse(shared, sampleTravel().travel).homes).toEqual([homeSam]);
  });

  it('the employee directory has exactly id, name, businessId and homeId', () => {
    for (const employee of mapResponse(run, sampleTravel().travel).employees) {
      expect(Object.keys(employee).sort()).toEqual(['businessId', 'homeId', 'id', 'name']);
    }
  });

  it('the output is the same when run.trips and run.assignments.plans are shuffled', () => {
    const expected = JSON.stringify(mapResponse(run, sampleTravel().travel));
    const { trips } = run;
    const { plans } = run.assignments;
    const orders: [number[], number[]][] = [
      [[5, 4, 3, 2, 1, 0], [1, 0]],
      [[3, 0, 5, 1, 4, 2], [0, 1]],
      [[2, 5, 0, 4, 1, 3], [1, 0]],
      [[1, 3, 5, 0, 2, 4], [1, 0]],
    ];
    for (const [tripOrder, planOrder] of orders) {
      const shuffled: Run = {
        ...run,
        trips: tripOrder.map((i) => trips[i]),
        assignments: { ...run.assignments, plans: planOrder.map((i) => plans[i]) },
      };
      expect(JSON.stringify(mapResponse(shuffled, sampleTravel().travel)), `${tripOrder} / ${planOrder}`).toBe(expected);
    }
  });

  it('polylines are sorted by from, then to', () => {
    const lines = mapResponse(run, sampleTravel().travel).polylines;
    for (let i = 1; i < lines.length; i++) {
      const [a, b] = [lines[i - 1], lines[i]];
      expect(a.from < b.from || (a.from === b.from && a.to < b.to), `${pairKey(a.from, a.to)} before ${pairKey(b.from, b.to)}`).toBe(true);
    }
  });

  it('a run with no trips and no plans has no polylines and never calls the travel provider', () => {
    const empty: Run = { ...run, trips: [], assignments: { plans: [], unmatched: [], computeMs: 0 } };
    const { travel, calls } = sampleTravel();
    expect(mapResponse(empty, travel).polylines).toEqual([]);
    expect(calls).toEqual([]);
  });

  it(`has no undefined values and stays under ${MAP_BYTE_LIMIT} bytes of JSON for the sample`, () => {
    const map = mapResponse(run, sampleTravel().travel);
    expect(undefinedPaths(map)).toEqual([]);
    expect(bytes(map)).toBeLessThan(MAP_BYTE_LIMIT);
    // No per-poll or per-plan data rides along: the map body is static per runId + plan set.
    const json = JSON.stringify(map);
    for (const word of ['departureMin', 'maxExtraMin', 'rewardCents', 'stops', 'shipment', 'clock']) {
      expect(json, word).not.toContain(word);
    }
  });
});
