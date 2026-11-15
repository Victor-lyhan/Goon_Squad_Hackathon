import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMMUTE_LOCKED, EMPLOYEE_NOT_FOUND, NYC_BOUNDS,
  homeIdForCoords, insideNyc, pairsToEnsure, resolveCommute,
} from '../../server/api/v2/commutePlan';
import { pairKey } from '../../shared/v2/types';
import {
  AGENCY, CAFE, HOME_1, HOME_2, NEW_HOME_ID, NEW_POINT, STREET_ADDRESSES, STUDIO,
  commuteBody, sampleRun,
} from './v2-commute-plan-sample';

const newHome = (overrides: Record<string, unknown> = {}) =>
  ({ home: { ...NEW_POINT, neighborhood: 'Astoria', ...overrides } });

describe('homeIdForCoords', () => {
  it('prints both numbers with exactly 5 decimals', () => {
    expect(homeIdForCoords(40.7642, -73.9235)).toBe('home-c-40.76420_-73.92350');
    expect(homeIdForCoords(40.5, -74)).toBe('home-c-40.50000_-74.00000');
  });

  it('rounds to 5 decimals, so nearby inputs give the same cache key', () => {
    expect(homeIdForCoords(40.764204, -73.923496)).toBe(NEW_HOME_ID);
    expect(homeIdForCoords(40.764196, -73.923504)).toBe(NEW_HOME_ID);
    expect(homeIdForCoords(40.76421, -73.9235)).not.toBe(NEW_HOME_ID);
  });

  it('never prints a negative zero', () => {
    expect(homeIdForCoords(-0.000001, -0)).toBe('home-c-0.00000_0.00000');
  });
});

describe('resolveCommute', () => {
  it('unknown employee: 404', () => {
    expect(resolveCommute(sampleRun(), 'emp-99', commuteBody())).toEqual({
      ok: false, status: 404, error: 'Employee not found',
    });
    expect(EMPLOYEE_NOT_FOUND).toBe('Employee not found');
  });

  it('locked run: 409, even for a valid request', () => {
    const run = sampleRun();
    run.clock.phase = 'locked';
    expect(resolveCommute(run, 'emp-1', commuteBody())).toEqual({
      ok: false, status: 409, error: 'The simulation is playing. Press Back to start in the simulator to edit commutes.',
    });
    expect(COMMUTE_LOCKED).toBe('The simulation is playing. Press Back to start in the simulator to edit commutes.');
  });

  it('an unknown employee is a 404 in a locked run too', () => {
    const run = sampleRun();
    run.clock.phase = 'locked';
    expect(resolveCommute(run, 'emp-99', commuteBody())).toMatchObject({ ok: false, status: 404 });
  });

  it('unknown businessId: 400 with fieldErrors.businessId only', () => {
    const result = resolveCommute(sampleRun(), 'emp-1', commuteBody({ businessId: 'biz-nowhere' }));
    expect(result).toEqual({
      ok: false, status: 400, error: 'Invalid commute', fieldErrors: { businessId: 'Unknown business' },
    });
  });

  it('a home ID is not a business ID', () => {
    const result = resolveCommute(sampleRun(), 'emp-1', commuteBody({ businessId: HOME_1 }));
    expect(result).toMatchObject({ ok: false, status: 400, fieldErrors: { businessId: 'Unknown business' } });
  });

  it('home.homeId that is not in scenario.homes: 400 with fieldErrors.home only', () => {
    const result = resolveCommute(sampleRun(), 'emp-1', commuteBody({ home: { homeId: 'home-120' } }));
    expect(result).toEqual({
      ok: false, status: 400, error: 'Invalid commute', fieldErrors: { home: 'Unknown home' },
    });
  });

  it('a business ID is not a home ID', () => {
    const result = resolveCommute(sampleRun(), 'emp-1', commuteBody({ home: { homeId: CAFE } }));
    expect(result).toMatchObject({ ok: false, status: 400, fieldErrors: { home: 'Unknown home' } });
  });

  it('reports both field errors at once', () => {
    const result = resolveCommute(sampleRun(), 'emp-1', commuteBody({ businessId: 'biz-nowhere', home: { homeId: 'home-120' } }));
    expect(result).toMatchObject({
      ok: false, status: 400, fieldErrors: { businessId: 'Unknown business', home: 'Unknown home' },
    });
  });

  it('saved home: returns the stored home, the updated employee and isNewHome false', () => {
    const run = sampleRun();
    const result = resolveCommute(run, 'emp-1', commuteBody({
      businessId: AGENCY, home: { homeId: HOME_2 },
      eveningDepartureMin: 1100, morningDepartureMin: 1900, availableEvening: false, availableMorning: true, maxExtraMin: 12,
    }));
    expect(result).toEqual({
      ok: true,
      isNewHome: false,
      home: { id: HOME_2, neighborhood: 'Harlem', lat: 40.8116, lng: -73.9465 },
      employee: {
        id: 'emp-1', name: 'Sam', businessId: AGENCY, homeId: HOME_2,
        eveningDepartureMin: 1100, morningDepartureMin: 1900, maxExtraMin: 12,
        availableEvening: false, availableMorning: true,
      },
    });
  });

  it('new home: rounded coordinates, trimmed neighborhood, derived ID and isNewHome true', () => {
    const result = resolveCommute(sampleRun(), 'emp-1', commuteBody(
      newHome({ lat: 40.764204, lng: -73.923496, neighborhood: '  Astoria ' }),
    ));
    expect(result).toMatchObject({
      ok: true,
      isNewHome: true,
      home: { id: NEW_HOME_ID, neighborhood: 'Astoria', lat: 40.7642, lng: -73.9235 },
      employee: { id: 'emp-1', name: 'Sam', businessId: STUDIO, homeId: NEW_HOME_ID },
    });
    if (!result.ok) throw new Error('expected ok');
    // Only { id, neighborhood, lat, lng } is kept (DECISIONS pass 44): no label, no address.
    expect(Object.keys(result.home).sort()).toEqual(['id', 'lat', 'lng', 'neighborhood']);
    expect(Object.keys(result.employee).sort()).toEqual([
      'availableEvening', 'availableMorning', 'businessId', 'eveningDepartureMin', 'homeId', 'id',
      'maxExtraMin', 'morningDepartureMin', 'name',
    ]);
  });

  it('new coordinates equal to a commute-editor home already in the scenario: reuses the stored home', () => {
    const run = sampleRun();
    const stored = { id: NEW_HOME_ID, neighborhood: 'Astoria', lat: 40.7642, lng: -73.9235 };
    run.scenario.homes.push(stored);
    run.scenario.employees[1].homeId = NEW_HOME_ID;
    // Same point within rounding, typed with another neighborhood label: the stored home wins.
    const result = resolveCommute(run, 'emp-1', commuteBody(
      newHome({ lat: 40.764201, lng: -73.923499, neighborhood: 'Ditmars' }),
    ));
    expect(result).toMatchObject({ ok: true, isNewHome: false, employee: { homeId: NEW_HOME_ID } });
    if (!result.ok) throw new Error('expected ok');
    expect(result.home).toBe(stored);
  });

  it('coordinates of a pool home are a new commute-editor home (IDs follow the home-c- convention)', () => {
    const result = resolveCommute(sampleRun(), 'emp-1', commuteBody(
      newHome({ lat: 40.6722, lng: -73.9772, neighborhood: 'Park Slope' }),
    ));
    expect(result).toMatchObject({ ok: true, isNewHome: true, home: { id: 'home-c-40.67220_-73.97720' } });
  });

  it.each([
    ['south', { lat: NYC_BOUNDS.south - 0.001, lng: -73.95 }],
    ['north', { lat: NYC_BOUNDS.north + 0.001, lng: -73.95 }],
    ['west (New Jersey)', { lat: 40.73, lng: NYC_BOUNDS.west - 0.001 }],
    ['east (Nassau County)', { lat: 40.73, lng: NYC_BOUNDS.east + 0.001 }],
    ['far away', { lat: 51.5074, lng: -0.1278 }],
  ])('outside the NYC box (%s): 400 with fieldErrors.home', (_side, point) => {
    const result = resolveCommute(sampleRun(), 'emp-1', commuteBody(newHome(point)));
    expect(result).toEqual({
      ok: false, status: 400, error: 'Invalid commute', fieldErrors: { home: 'Choose a home inside New York City' },
    });
  });

  it('the corners of the NYC box are inside', () => {
    for (const lat of [NYC_BOUNDS.south, NYC_BOUNDS.north]) {
      for (const lng of [NYC_BOUNDS.west, NYC_BOUNDS.east]) {
        expect(resolveCommute(sampleRun(), 'emp-1', commuteBody(newHome({ lat, lng })))).toMatchObject({ ok: true, isNewHome: true });
      }
    }
  });

  it('the NYC box is the geocode handler\'s (#343)', () => {
    expect(NYC_BOUNDS).toEqual({ south: 40.4774, west: -74.2591, north: 40.9176, east: -73.7002 });
    expect(insideNyc(40.7642, -73.9235)).toBe(true);
    expect(insideNyc(Number.NaN, -73.9235)).toBe(false);
    expect(insideNyc(40.7642, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('never changes the run', () => {
    const run = sampleRun();
    const before = structuredClone(run);
    resolveCommute(run, 'emp-1', commuteBody(newHome()));
    resolveCommute(run, 'emp-1', commuteBody({ businessId: AGENCY, home: { homeId: HOME_2 } }));
    resolveCommute(run, 'emp-1', commuteBody({ businessId: 'biz-nowhere' }));
    expect(run).toEqual(before);
  });

  it('no result or error contains a street address or echoes the request', () => {
    const run = sampleRun();
    const results = [
      resolveCommute(run, 'emp-99', commuteBody()),
      resolveCommute(run, 'emp-1', commuteBody({ businessId: '350 5th Ave, New York' })),
      resolveCommute(run, 'emp-1', commuteBody({ home: { homeId: '350 5th Ave, New York' } })),
      resolveCommute(run, 'emp-1', commuteBody(newHome({ lat: 10, neighborhood: '350 5th Ave, New York' }))),
      resolveCommute(run, 'emp-1', commuteBody({ businessId: AGENCY, home: { homeId: HOME_2 } })),
      resolveCommute(run, 'emp-1', commuteBody(newHome())),
    ];
    const text = JSON.stringify(results);
    for (const address of [...STREET_ADDRESSES, '350 5th Ave']) expect(text).not.toContain(address);
  });
});

describe('pairsToEnsure', () => {
  const eighteen = Array.from({ length: 18 }, (_, i) => `biz-${String(i + 1).padStart(2, '0')}`);
  const home = { id: NEW_HOME_ID };

  it('18 businesses: 36 matrix pairs and 2 polyline pairs, no duplicates', () => {
    const { matrix, polylines } = pairsToEnsure(home, 'biz-07', eighteen);
    expect(matrix).toHaveLength(36);
    expect(new Set(matrix.map((p) => pairKey(p.from, p.to))).size).toBe(36);
    for (const id of eighteen) {
      expect(matrix).toContainEqual({ from: NEW_HOME_ID, to: id });
      expect(matrix).toContainEqual({ from: id, to: NEW_HOME_ID });
    }
    expect(polylines).toEqual([
      { from: 'biz-07', to: NEW_HOME_ID },
      { from: NEW_HOME_ID, to: 'biz-07' },
    ]);
  });

  it('gives the same order on every call: home to each business by ID, then each business to home', () => {
    const first = pairsToEnsure(home, 'biz-07', eighteen);
    expect(pairsToEnsure(home, 'biz-07', eighteen)).toEqual(first);
    expect(first.matrix.slice(0, 18)).toEqual(eighteen.map((id) => ({ from: NEW_HOME_ID, to: id })));
    expect(first.matrix.slice(18)).toEqual(eighteen.map((id) => ({ from: id, to: NEW_HOME_ID })));
  });

  it('does not depend on the order of the business IDs and drops repeated IDs', () => {
    const shuffled = [...eighteen].reverse();
    expect(pairsToEnsure(home, 'biz-07', [...shuffled, 'biz-03', 'biz-18'])).toEqual(pairsToEnsure(home, 'biz-07', eighteen));
  });

  it('does not change the list it is given', () => {
    const ids = [AGENCY, STUDIO, CAFE];
    pairsToEnsure(home, STUDIO, ids);
    expect(ids).toEqual([AGENCY, STUDIO, CAFE]);
  });

  it('always covers the commute pair, even if the workplace is missing from the list', () => {
    const { matrix, polylines } = pairsToEnsure(home, STUDIO, [AGENCY, CAFE]);
    expect(matrix).toEqual([
      { from: NEW_HOME_ID, to: AGENCY }, { from: NEW_HOME_ID, to: CAFE }, { from: NEW_HOME_ID, to: STUDIO },
      { from: AGENCY, to: NEW_HOME_ID }, { from: CAFE, to: NEW_HOME_ID }, { from: STUDIO, to: NEW_HOME_ID },
    ]);
    expect(polylines).toHaveLength(2);
  });

  it('takes a full Home and never pairs a place with itself', () => {
    const full = { id: NEW_HOME_ID, neighborhood: 'Astoria', ...NEW_POINT };
    const { matrix } = pairsToEnsure(full, STUDIO, [STUDIO, NEW_HOME_ID]);
    expect(matrix).toEqual([{ from: NEW_HOME_ID, to: STUDIO }, { from: STUDIO, to: NEW_HOME_ID }]);
  });
});

describe('commutePlan.ts is pure', () => {
  it('imports only shared contracts and buildTrips; no fs, network, env, clock or randomness', () => {
    const source = readFileSync(new URL('../../server/api/v2/commutePlan.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../../../shared/v2/schemas', '../../../shared/v2/types', '../../domain/v2/trips']);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('export function applyCommute');
    expect(code).not.toMatch(/process\.|\bfetch\(|require\(|import\(|Date\.now|new Date|Math\.random|console\./);
  });
});
