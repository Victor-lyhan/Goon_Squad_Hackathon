// Fetch planning (server/geo/fetchPlan.ts): pure functions over plain cache objects. No network, no key, no files.
import { describe, expect, it } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import type { PolylinesFile, TravelMatrixFile } from '../../shared/v2/types';
import { batchPairs, carrierCommutePairs, commutePairs, planGeocodes, planLegPairs, planMatrixPairs, planPolylines } from '../../server/geo/fetchPlan';
import type { MatrixPlan } from '../../server/geo/fetchPlan';
import { MAX_MATRIX_ELEMENTS } from '../../server/geo/googleClient';

const emptyMatrix = (): TravelMatrixFile => ({ schemaVersion: 1, places: {}, pairs: {} });
const emptyPolylines = (): PolylinesFile => ({ schemaVersion: 1, polylines: {} });

const BUSINESSES = ['biz-a', 'biz-b', 'biz-c'];
const HOMES = ['home-001', 'home-002'];

/** Every pair the app can need, written out the slow way. */
function neededKeys(businessIds: string[], homeIds: string[]): string[] {
  const keys: string[] = [];
  for (const a of businessIds) for (const b of businessIds) if (a !== b) keys.push(pairKey(a, b));
  for (const home of homeIds) for (const business of businessIds) keys.push(pairKey(home, business), pairKey(business, home));
  return keys.sort();
}

function plannedKeys(plan: MatrixPlan): string[] {
  return plan.batches.flatMap((batch) => batchPairs(batch).map((pair) => pairKey(pair.from, pair.to)));
}

function withPairs(keys: string[]): TravelMatrixFile {
  const matrix = emptyMatrix();
  for (const key of keys) matrix.pairs[key] = { durationS: 600, distanceM: 4000 };
  return matrix;
}

const manyBusinesses = Array.from({ length: 18 }, (_, i) => `biz-${String(i + 1).padStart(2, '0')}`);
const manyHomes = [
  ...Array.from({ length: 120 }, (_, i) => `home-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 9 }, (_, i) => `home-story-${i + 1}`),
];

describe('planGeocodes', () => {
  const businesses = [
    { id: 'biz-c', address: '3 C St, New York, NY', name: 'ignored' },
    { id: 'biz-a', address: '1 A St, New York, NY' },
    { id: 'biz-b', address: '2 B St, Brooklyn, NY' },
    { id: 'biz-a', address: 'a duplicate that is dropped' },
  ];

  it('returns the businesses with no entry in matrix.places, by id, as { id, address } only', () => {
    const matrix = emptyMatrix();
    matrix.places['biz-b'] = { lat: 40.7, lng: -73.99, formattedAddress: '2 B St' };
    expect(planGeocodes(businesses, matrix)).toEqual([
      { id: 'biz-a', address: '1 A St, New York, NY' },
      { id: 'biz-c', address: '3 C St, New York, NY' },
    ]);
  });

  it('is empty when every business has coordinates', () => {
    const matrix = emptyMatrix();
    for (const id of BUSINESSES) matrix.places[id] = { lat: 40.7, lng: -74 };
    expect(planGeocodes(businesses, matrix)).toEqual([]);
  });
});

describe('planMatrixPairs', () => {
  it('plans exactly 6 business pairs and 12 home pairs for 3 businesses and 2 homes on an empty cache', () => {
    const plan = planMatrixPairs({ businessIds: BUSINESSES, homeIds: HOMES }, emptyMatrix());
    const keysOf = (block: string) =>
      plan.batches.filter((batch) => batch.block === block).flatMap((batch) => batchPairs(batch).map((pair) => pairKey(pair.from, pair.to)));

    expect(keysOf('business-business').sort()).toEqual(['biz-a|biz-b', 'biz-a|biz-c', 'biz-b|biz-a', 'biz-b|biz-c', 'biz-c|biz-a', 'biz-c|biz-b']);
    expect(keysOf('home-business')).toHaveLength(6);
    expect(keysOf('business-home')).toHaveLength(6);

    const keys = plannedKeys(plan);
    expect(keys).toHaveLength(18);
    expect(new Set(keys).size).toBe(18); // nothing asked twice
    expect([...keys].sort()).toEqual(neededKeys(BUSINESSES, HOMES));
    expect(keys).not.toContain('home-001|home-002'); // homes are only commute endpoints
    expect(plan.missingPairs).toBe(18);
    expect(plan.cachedPairs).toBe(0);
  });

  it('plans nothing when the cache is full', () => {
    const plan = planMatrixPairs({ businessIds: BUSINESSES, homeIds: HOMES }, withPairs(neededKeys(BUSINESSES, HOMES)));
    expect(plan).toEqual({ batches: [], missingPairs: 0, cachedPairs: 18 });
  });

  it('plans only the missing pairs of a partial cache', () => {
    const all = neededKeys(BUSINESSES, HOMES);
    const missing = ['biz-a|biz-c', 'biz-c|home-002', 'home-001|biz-a', 'home-001|biz-b', 'home-002|biz-b'];
    const plan = planMatrixPairs({ businessIds: BUSINESSES, homeIds: HOMES }, withPairs(all.filter((key) => !missing.includes(key))));

    expect(plannedKeys(plan).sort()).toEqual(missing);
    expect(plan.missingPairs).toBe(5);
    expect(plan.cachedPairs).toBe(13);
  });

  it('ignores cached pairs the app does not need', () => {
    const plan = planMatrixPairs({ businessIds: BUSINESSES, homeIds: HOMES }, withPairs(['home-001|home-002', 'biz-a|biz-a', 'biz-z|biz-a']));
    expect(plan.missingPairs).toBe(18);
    expect(plan.cachedPairs).toBe(0);
  });

  it('keeps every batch within 625 elements for 18 businesses and 129 homes, and covers every pair once', () => {
    const plan = planMatrixPairs({ businessIds: manyBusinesses, homeIds: manyHomes }, emptyMatrix());

    for (const batch of plan.batches) {
      expect(batch.originIds.length * batch.destinationIds.length).toBeLessThanOrEqual(MAX_MATRIX_ELEMENTS);
      expect(batch.originIds.length).toBeGreaterThan(0);
      expect(batch.destinationIds.length).toBeGreaterThan(0);
    }
    const keys = plannedKeys(plan);
    expect(keys).toHaveLength(18 * 17 + 2 * 18 * 129); // 4,950
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(neededKeys(manyBusinesses, manyHomes));
    expect(plan.missingPairs).toBe(4950);
    // Polite: a handful of requests, not one per pair.
    expect(plan.batches.length).toBeLessThanOrEqual(30);
  });

  it('regroups what a failed request left behind into as few requests as fit', () => {
    // Homes 035-068 lost their home -> business request; everything else is cached.
    const lost = manyHomes.slice(34, 68);
    const cached = neededKeys(manyBusinesses, manyHomes).filter((key) => !lost.some((home) => key.startsWith(`${home}|`)));
    const plan = planMatrixPairs({ businessIds: manyBusinesses, homeIds: manyHomes }, withPairs(cached));

    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]).toEqual({ block: 'home-business', originIds: lost, destinationIds: manyBusinesses });
    expect(plan.missingPairs).toBe(34 * 18);
  });

  it('gives the same plan for the same input, whatever order the ids come in', () => {
    const first = planMatrixPairs({ businessIds: manyBusinesses, homeIds: manyHomes }, emptyMatrix());
    const again = planMatrixPairs({ businessIds: manyBusinesses, homeIds: manyHomes }, emptyMatrix());
    const shuffled = planMatrixPairs(
      { businessIds: [...manyBusinesses].reverse(), homeIds: [...manyHomes.slice(60), ...manyHomes.slice(0, 60), manyHomes[3]] },
      emptyMatrix(),
    );
    expect(again).toEqual(first);
    expect(shuffled).toEqual(first);
    expect(plannedKeys(shuffled)).toEqual(plannedKeys(first)); // same order, not just the same set
  });

  it('does not change the matrix it reads', () => {
    const matrix = withPairs(['biz-a|biz-b']);
    const before = structuredClone(matrix);
    planMatrixPairs({ businessIds: BUSINESSES, homeIds: HOMES }, matrix);
    expect(matrix).toEqual(before);
  });
});

describe('planPolylines', () => {
  it('returns the uncached pairs once each, sorted, without self pairs', () => {
    const polylines = emptyPolylines();
    polylines.polylines['biz-a|home-001'] = 'abc';
    const plan = planPolylines(
      [
        { from: 'home-001', to: 'biz-a' },
        { from: 'biz-b', to: 'biz-a' },
        { from: 'biz-a', to: 'home-001' }, // cached
        { from: 'biz-b', to: 'biz-a' }, // duplicate
        { from: 'biz-a', to: 'biz-a' }, // self pair
        { from: 'biz-a', to: 'biz-b' }, // the other direction is its own pair
      ],
      polylines,
    );
    expect(plan).toEqual([
      { from: 'biz-a', to: 'biz-b' },
      { from: 'biz-b', to: 'biz-a' },
      { from: 'home-001', to: 'biz-a' },
    ]);
  });

  it('is empty when everything is cached, and stable when the input order changes', () => {
    const pairs = [
      { from: 'biz-b', to: 'home-002' },
      { from: 'biz-a', to: 'home-001' },
      { from: 'biz-a', to: 'biz-b' },
    ];
    expect(planPolylines([...pairs].reverse(), emptyPolylines())).toEqual(planPolylines(pairs, emptyPolylines()));

    const full = emptyPolylines();
    for (const pair of pairs) full.polylines[pairKey(pair.from, pair.to)] = 'abc';
    expect(planPolylines(pairs, full)).toEqual([]);
  });
});

describe('commutePairs and planLegPairs', () => {
  it('gives both directions of each employee commute', () => {
    const employees = [
      { id: 'emp-1', businessId: 'biz-a', homeId: 'home-001' },
      { id: 'emp-2', businessId: 'biz-b', homeId: 'home-story-ana' },
    ];
    expect(commutePairs(employees)).toEqual([
      { from: 'biz-a', to: 'home-001' },
      { from: 'home-001', to: 'biz-a' },
      { from: 'biz-b', to: 'home-story-ana' },
      { from: 'home-story-ana', to: 'biz-b' },
    ]);
  });

  it('gives every neighbouring pair of each leg', () => {
    const plans = [
      { legs: [{ placeIds: ['biz-a', 'biz-c', 'home-001'] }, { placeIds: ['home-002', 'biz-c', 'biz-b'] }] },
      { legs: [{ placeIds: ['biz-a', 'biz-b', 'home-001'] }] },
      { legs: [{ placeIds: ['biz-a'] }, { placeIds: [] }] },
    ];
    expect(planLegPairs(plans)).toEqual([
      { from: 'biz-a', to: 'biz-c' },
      { from: 'biz-c', to: 'home-001' },
      { from: 'home-002', to: 'biz-c' },
      { from: 'biz-c', to: 'biz-b' },
      { from: 'biz-a', to: 'biz-b' },
      { from: 'biz-b', to: 'home-001' },
    ]);
  });

  it('feeds planPolylines: commutes and plan legs together, each pair once', () => {
    const pairs = [...commutePairs([{ businessId: 'biz-a', homeId: 'home-001' }]), ...planLegPairs([{ legs: [{ placeIds: ['biz-a', 'biz-b', 'home-001'] }] }])];
    expect(planPolylines(pairs, emptyPolylines())).toEqual([
      { from: 'biz-a', to: 'biz-b' },
      { from: 'biz-a', to: 'home-001' },
      { from: 'biz-b', to: 'home-001' },
      { from: 'home-001', to: 'biz-a' },
    ]);
  });
});

describe('carrierCommutePairs (MVP IV F2: the home ↔ work stretches of the employees who carry a package)', () => {
  const employees = [
    { id: 'emp-1', businessId: 'biz-a', homeId: 'home-001' }, // carries in the evening
    { id: 'emp-2', businessId: 'biz-b', homeId: 'home-002' }, // carries in the morning
    { id: 'emp-3', businessId: 'biz-c', homeId: 'home-003' }, // carries nothing
    { id: 'emp-4', businessId: 'biz-a', homeId: 'home-story-ana' }, // carries a direct package in the evening
  ];
  const plans = [
    {
      legs: [
        { employeeId: 'emp-1', placeIds: ['biz-a', 'biz-c', 'home-001'] },
        { employeeId: 'emp-2', placeIds: ['home-002', 'biz-c', 'biz-b'] },
      ],
    },
    { legs: [{ employeeId: 'emp-4', placeIds: ['biz-a', 'biz-b', 'home-story-ana'] }] },
  ];

  it('gives the leg stretches that touch a home, in plan order, then both baseline commutes of every carrier', () => {
    expect(carrierCommutePairs(plans, employees)).toEqual([
      { from: 'biz-c', to: 'home-001' },
      { from: 'home-002', to: 'biz-c' },
      { from: 'biz-b', to: 'home-story-ana' },
      { from: 'biz-a', to: 'home-001' },
      { from: 'home-001', to: 'biz-a' },
      { from: 'biz-b', to: 'home-002' },
      { from: 'home-002', to: 'biz-b' },
      { from: 'biz-a', to: 'home-story-ana' },
      { from: 'home-story-ana', to: 'biz-a' },
    ]);
  });

  it('leaves out every business → business stretch and the commutes of an employee who carries nothing', () => {
    const keys = carrierCommutePairs(plans, employees).map(({ from, to }) => pairKey(from, to));
    expect(keys).not.toContain('biz-a|biz-c');
    expect(keys).not.toContain('biz-c|biz-b');
    expect(keys).not.toContain('biz-a|biz-b');
    expect(keys.filter((key) => key.includes('home-003'))).toEqual([]);
    for (const key of keys) expect(key).toMatch(/home-/);
  });

  it('adds no pair to what the fetch already asks for: each one is a leg pair or a baseline commute', () => {
    const already = new Set([...planLegPairs(plans), ...commutePairs(employees)].map(({ from, to }) => pairKey(from, to)));
    const carriers = carrierCommutePairs(plans, employees);
    for (const { from, to } of carriers) expect(already.has(pairKey(from, to)), pairKey(from, to)).toBe(true);
    const all = [...commutePairs(employees), ...planLegPairs(plans)];
    expect(planPolylines([...all, ...carriers], emptyPolylines())).toEqual(planPolylines(all, emptyPolylines()));
  });

  it('knows a home by the employees, not by the spelling of its ID', () => {
    const odd = [{ id: 'emp-9', businessId: 'biz-a', homeId: 'flat-9' }];
    expect(carrierCommutePairs([{ legs: [{ employeeId: 'emp-9', placeIds: ['biz-a', 'biz-b', 'flat-9'] }] }], odd)).toEqual([
      { from: 'biz-b', to: 'flat-9' },
      { from: 'biz-a', to: 'flat-9' },
      { from: 'flat-9', to: 'biz-a' },
    ]);
  });

  it('feeds planPolylines: only the lines the cache lacks, each once', () => {
    const polylines = emptyPolylines();
    polylines.polylines['biz-c|home-001'] = 'cached';
    polylines.polylines['home-002|biz-b'] = 'cached';
    const twice = [...plans, ...plans];
    expect(planPolylines(carrierCommutePairs(twice, employees), polylines)).toEqual([
      { from: 'biz-a', to: 'home-001' },
      { from: 'biz-a', to: 'home-story-ana' },
      { from: 'biz-b', to: 'home-002' },
      { from: 'biz-b', to: 'home-story-ana' },
      { from: 'home-001', to: 'biz-a' },
      { from: 'home-002', to: 'biz-c' },
      { from: 'home-story-ana', to: 'biz-a' },
    ]);
  });

  it('is empty when there is no plan', () => {
    expect(carrierCommutePairs([], employees)).toEqual([]);
  });
});
