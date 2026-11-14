import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pairKey, TravelDataMissingError } from '../../shared/v2/types';
import { gridCostsFrom, gridTravel, RELAY_FIXTURE_PLACES, relayFixtureTravel, type GridGraph } from './matching-v2-grid-helper';

const NONE = Infinity;
/**
 * These numbers come from `createRouter(fixture.graph).shortestPath` of
 * server/domain/routing.ts at commit d24ab87 (the commit issue #605 started
 * from), printed for every pair of the five places the three §9 tests use,
 * before those tests stopped importing the router. NONE is "no route".
 * [from, to, minutes, metres]
 */
const ROUTER_PAIRS: [string, string, number, number][] = [
  // The far corners of the grid: A (0,0), B (2,2), X (0,2), Y (2,0).
  ['biz-a', 'biz-b', 22, 7700], // A > H > B
  ['biz-b', 'biz-a', NONE, NONE],
  ['home-y', 'home-x', 22, 7700], // Y > H > X
  ['home-x', 'home-y', NONE, NONE],
  ['biz-a', 'home-x', 20, 7000], // the direct road, not A > H > X (22 min)
  ['home-x', 'biz-a', NONE, NONE],
  ['home-y', 'biz-b', 20, 7000], // the direct road, not Y > H > B (22 min)
  ['biz-b', 'home-y', NONE, NONE],
  ['biz-a', 'home-y', NONE, NONE],
  ['home-y', 'biz-a', NONE, NONE],
  ['biz-b', 'home-x', NONE, NONE],
  ['home-x', 'biz-b', NONE, NONE],
  // To and from the middle, H (1,1).
  ['biz-a', 'biz-h', 10, 3500],
  ['biz-h', 'biz-a', NONE, NONE],
  ['home-y', 'biz-h', 10, 3500],
  ['biz-h', 'home-y', NONE, NONE],
  ['biz-h', 'biz-b', 12, 4200],
  ['biz-b', 'biz-h', NONE, NONE],
  ['biz-h', 'home-x', 12, 4200],
  ['home-x', 'biz-h', NONE, NONE],
  // A place to itself.
  ['biz-a', 'biz-a', 0, 0],
  ['biz-b', 'biz-b', 0, 0],
  ['biz-h', 'biz-h', 0, 0],
  ['home-x', 'home-x', 0, 0],
  ['home-y', 'home-y', 0, 0],
];

describe('the §9 grid travel provider', () => {
  const travel = relayFixtureTravel();

  it.each(ROUTER_PAIRS)('%s -> %s is %d min and %d m, as the MVP 1 router had it', (from, to, durationMin, distanceM) => {
    expect(travel.pairs[pairKey(from, to)]).toEqual({ durationMin, distanceM });
    expect(travel.durationMin(from, to)).toBe(durationMin);
    expect(travel.distanceM(from, to)).toBe(distanceM);
  });

  it('holds every pair of the five places and nothing else', () => {
    const ids = Object.keys(RELAY_FIXTURE_PLACES);
    expect(ids).toEqual(['biz-a', 'biz-b', 'biz-h', 'home-x', 'home-y']);
    expect(Object.keys(travel.pairs).sort()).toEqual(ids.flatMap(from => ids.map(to => pairKey(from, to))).sort());
    expect(ROUTER_PAIRS.map(([from, to]) => pairKey(from, to)).sort()).toEqual(Object.keys(travel.pairs).sort());
    expect(() => travel.durationMin('biz-a', 'biz-z')).toThrow(TravelDataMissingError);
  });

  it('gives whole minutes and whole metres wherever there is a route', () => {
    for (const { durationMin, distanceM } of Object.values(travel.pairs)) {
      if (durationMin === Infinity) expect(distanceM).toBe(Infinity);
      else expect(Number.isInteger(durationMin) && Number.isInteger(distanceM)).toBe(true);
    }
  });

  it('returns a fresh table on every call', () => {
    const changed = relayFixtureTravel();
    changed.pairs[pairKey('biz-a', 'biz-h')].durationMin++;
    delete changed.pairs[pairKey('biz-h', 'biz-b')];
    expect(relayFixtureTravel().pairs).toEqual(travel.pairs);
  });
});

describe('the shortest-path code of the grid helper', () => {
  const edge = (from: string, to: string, durationMin: number, distanceM: number) => ({ from, to, durationMin, distanceM });
  const graph = (ids: string, edges: GridGraph['edges']): GridGraph => ({ nodes: [...ids].map(id => ({ id })), edges });

  it('takes a path through other nodes when it is faster than the direct road', () => {
    const g = graph('ABCD', [edge('A', 'D', 30, 100), edge('A', 'B', 5, 2000), edge('B', 'C', 5, 2000), edge('C', 'D', 5, 2000)]);
    expect(gridCostsFrom(g, 'A').get('D')).toEqual({ durationMin: 15, distanceM: 6000 });
  });

  it('breaks a tie on minutes with the fewest metres, whatever the order of the roads', () => {
    const roads = [edge('A', 'B', 4, 900), edge('B', 'D', 6, 900), edge('A', 'C', 5, 800), edge('C', 'D', 5, 800), edge('A', 'D', 10, 1700)];
    for (const edges of [roads, [...roads].reverse()]) {
      expect(gridCostsFrom(graph('ABCD', edges), 'A').get('D')).toEqual({ durationMin: 10, distanceM: 1600 });
    }
  });

  it('follows roads one way only and reports no cost for a node it cannot reach', () => {
    const g = graph('ABC', [edge('A', 'B', 3, 1000), edge('B', 'C', 4, 1500)]);
    expect([...gridCostsFrom(g, 'A')]).toEqual([
      ['A', { durationMin: 0, distanceM: 0 }], ['B', { durationMin: 3, distanceM: 1000 }], ['C', { durationMin: 7, distanceM: 2500 }],
    ]);
    expect([...gridCostsFrom(g, 'C')]).toEqual([['C', { durationMin: 0, distanceM: 0 }]]);
  });

  it('ignores a road to a node the graph does not list, and a start that is not a node', () => {
    const g = graph('AB', [edge('A', 'Q', 1, 1), edge('Q', 'B', 1, 1), edge('A', 'B', 9, 9)]);
    expect(gridCostsFrom(g, 'A').get('B')).toEqual({ durationMin: 9, distanceM: 9 });
    expect(gridCostsFrom(g, 'Q').size).toBe(0);
    expect(gridTravel(g, { 'biz-a': 'A', 'biz-b': 'B', 'biz-q': 'Q' }).pairs).toEqual({
      [pairKey('biz-a', 'biz-a')]: { durationMin: 0, distanceM: 0 },
      [pairKey('biz-a', 'biz-b')]: { durationMin: 9, distanceM: 9 },
      [pairKey('biz-a', 'biz-q')]: { durationMin: Infinity, distanceM: Infinity },
      [pairKey('biz-b', 'biz-a')]: { durationMin: Infinity, distanceM: Infinity },
      [pairKey('biz-b', 'biz-b')]: { durationMin: 0, distanceM: 0 },
      [pairKey('biz-b', 'biz-q')]: { durationMin: Infinity, distanceM: Infinity },
      [pairKey('biz-q', 'biz-a')]: { durationMin: Infinity, distanceM: Infinity },
      [pairKey('biz-q', 'biz-b')]: { durationMin: Infinity, distanceM: Infinity },
      [pairKey('biz-q', 'biz-q')]: { durationMin: Infinity, distanceM: Infinity },
    });
  });
});

describe('the §9 tests of the MVP II matcher stand without the MVP 1 router', () => {
  it.each([
    'tests/domain/matching-v2-fixture.test.ts',
    'tests/domain/matching-v2-plancheck.test.ts',
    'tests/domain/matching-v2-explain-matcher.test.ts',
    'tests/domain/matching-v2-grid-helper.ts',
  ])('%s does not import the router and builds its table with the helper', path => {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/domain\/routing/);
    expect(source).not.toMatch(/createRouter|shortestPath/);
    if (path.endsWith('.test.ts')) expect(source).toMatch(/= relayFixtureTravel\(\);/);
  });
});
