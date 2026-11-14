// Which route lines GET /api/v2/map asks for (server/api/v2/mapLines.ts, issue #536, DECISIONS pass 57):
// the pure pair selection, and the per-server-run rules of the fetcher without HTTP.
import { describe, expect, it } from 'vitest';
import {
  createMapLineFetcher, MAP_LINE_PAIRS_PER_REQUEST, MAP_LINE_TRIES, missingLinePairs,
} from '../../server/api/v2/mapLines';
import { mapResponse } from '../../server/api/v2/views';
import type { RoutePolyline } from '../../shared/v2/api';
import { cachedPolylines, sampleRun, sampleTravel } from './v2-sample';
import { bigRun, fakeEnsure, keyOf, lineTravel, type Pair } from './v2-map-lines-helper';

const asPairs = (pairs: { from: string; to: string }[]): Pair[] => pairs.map(({ from, to }) => [from, to]);
const nullLines = (pairs: Pair[]): RoutePolyline[] => pairs.map(([from, to]) => ({ from, to, encoded: null }));

/** The polylines of the sample run's map when nothing is cached. */
const sampleAllMissing = mapResponse(sampleRun, lineTravel().travel).polylines;

describe('missingLinePairs', () => {
  it('the numbers of the issue', () => {
    expect(MAP_LINE_PAIRS_PER_REQUEST).toBe(60);
    expect(MAP_LINE_TRIES).toBe(2);
  });

  it('plan legs first, in plan, leg and travel order; then the commutes of the carriers in trip order', () => {
    expect(sampleAllMissing).toHaveLength(12);
    expect(asPairs(missingLinePairs(sampleRun, sampleAllMissing))).toEqual([
      // shp-1 relay, leg 0 (Sam, evening) and leg 1 (Ana, morning)
      ['biz-studio', 'biz-cafe'], ['biz-cafe', 'home-001'],
      ['home-story-ana', 'biz-cafe'], ['biz-cafe', 'biz-agency'],
      // shp-2 direct (Ana, evening)
      ['biz-agency', 'biz-studio'], ['biz-studio', 'home-story-ana'],
      // commutes of Sam and Ana, who carry a plan: evening, then morning
      ['biz-studio', 'home-001'], ['home-001', 'biz-studio'],
      ['biz-agency', 'home-story-ana'], ['home-story-ana', 'biz-agency'],
    ]);
  });

  it('the commutes of an employee with no plan are never listed', () => {
    const listed = missingLinePairs(sampleRun, sampleAllMissing).map(({ from, to }) => `${from}|${to}`);
    // Lee (emp-3, home-002) has two commutes and no job.
    expect(listed).not.toContain('biz-studio|home-002');
    expect(listed).not.toContain('home-002|biz-studio');
    expect(sampleAllMissing.filter((p) => p.encoded === null).map((p) => `${p.from}|${p.to}`)).toContain('home-002|biz-studio');
  });

  it('a pair with a cached line is left out: on the sample only one leg pair is missing', () => {
    const { polylines } = mapResponse(sampleRun, sampleTravel().travel);
    // The sample lacks two lines: Ana's last leg pair and Lee's morning commute (Lee carries nothing).
    expect(polylines.filter((p) => p.encoded === null)).toHaveLength(2);
    expect(asPairs(missingLinePairs(sampleRun, polylines))).toEqual([['biz-studio', 'home-story-ana']]);
  });

  it('nothing missing, or an empty answer: no pair', () => {
    const every = Object.fromEntries(sampleAllMissing.map((p) => [`${p.from}|${p.to}`, 'abc']));
    expect(missingLinePairs(sampleRun, mapResponse(sampleRun, lineTravel(every).travel).polylines)).toEqual([]);
    expect(missingLinePairs(sampleRun, [])).toEqual([]);
    expect(missingLinePairs({ trips: [], assignments: { plans: [], unmatched: [], computeMs: 0 } }, sampleAllMissing)).toEqual([]);
  });

  it('only pairs the map answered are listed, each once, where it comes first', () => {
    // Two legs share Studio -> Cafe; a leg pair that is also a carrier's commute stays with the legs.
    const [relay, direct] = sampleRun.assignments.plans;
    const run = {
      trips: sampleRun.trips,
      assignments: {
        ...sampleRun.assignments,
        plans: [
          relay,
          { ...direct, legs: [{ ...direct.legs[0], placeIds: ['biz-studio', 'biz-cafe', 'biz-agency', 'home-story-ana'] }] },
        ],
      },
    };
    const { polylines } = mapResponse({ ...sampleRun, ...run }, lineTravel().travel);
    const pairs = asPairs(missingLinePairs(run, polylines));
    expect(pairs).toEqual([
      ['biz-studio', 'biz-cafe'], ['biz-cafe', 'home-001'], ['home-story-ana', 'biz-cafe'], ['biz-cafe', 'biz-agency'],
      ['biz-agency', 'home-story-ana'], // the direct leg's last pair, which is also Ana's evening commute
      ['biz-studio', 'home-001'], ['home-001', 'biz-studio'], ['home-story-ana', 'biz-agency'],
    ]);
    expect(new Set(pairs.map(keyOf)).size).toBe(pairs.length);

    // A missing pair the answer does not hold is not asked for.
    const withoutCafe = polylines.filter((p) => p.from !== 'biz-cafe' && p.to !== 'biz-cafe');
    expect(asPairs(missingLinePairs(run, withoutCafe)).flat()).not.toContain('biz-cafe');
  });

  it('is pure: the frozen run and the answer are not changed, and two calls agree', () => {
    const polylines = Object.freeze(sampleAllMissing.map((p) => Object.freeze({ ...p })));
    const before = JSON.stringify(polylines);
    expect(missingLinePairs(sampleRun, polylines)).toEqual(missingLinePairs(sampleRun, polylines));
    expect(JSON.stringify(polylines)).toBe(before);
    expect(Object.keys(cachedPolylines)).toHaveLength(10); // the sample table is untouched too
  });
});

describe('createMapLineFetcher (no HTTP)', () => {
  const city = bigRun(40, 5); // 80 leg pairs, 80 carrier commutes, 10 commutes of employees with no plan
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  it('the made-up city has more missing lines than one request may ask for', () => {
    expect(city.legPairs).toHaveLength(80);
    expect(city.carrierCommutes).toHaveLength(80);
    expect(city.idleCommutes).toHaveLength(10);
    expect(new Set([...city.wanted, ...city.idleCommutes].map(keyOf)).size).toBe(170);
  });

  it('asks for at most 60 pairs, as two-place legs, in order, and returns nothing', () => {
    const { lines } = lineTravel();
    const fake = fakeEnsure(lines, 'fail');
    const fetchMissing = createMapLineFetcher(fake.ensureLegPolylines);
    expect(fetchMissing(city.run, nullLines([...city.idleCommutes, ...city.carrierCommutes, ...city.legPairs]))).toBeUndefined();
    expect(fake.calls).toEqual([city.wanted.slice(0, 60)]);
    expect(fake.shapes).toEqual([Array(60).fill(2)]);
  });

  it('without the function it does nothing', () => {
    const fetchMissing = createMapLineFetcher(undefined);
    expect(() => fetchMissing(city.run, nullLines(city.wanted))).not.toThrow();
  });

  it.each(['throw', 'reject'] as const)('a fetch that %ss is dropped, and the next call may fetch again', async (mode) => {
    const fake = fakeEnsure({}, mode);
    const fetchMissing = createMapLineFetcher(fake.ensureLegPolylines);
    const polylines = nullLines(city.wanted);
    expect(() => fetchMissing(city.run, polylines)).not.toThrow();
    await tick();
    fetchMissing(city.run, polylines);
    await tick();
    // The failed try counts: both tries of the first 60 are used, so the third call moves on.
    fetchMissing(city.run, polylines);
    expect(fake.calls).toEqual([city.wanted.slice(0, 60), city.wanted.slice(0, 60), city.wanted.slice(60, 120)]);
  });

  it('a function that returns no promise does not break the caller', async () => {
    const calls: number[] = [];
    const fetchMissing = createMapLineFetcher(((legs: unknown[]) => { calls.push(legs.length); }) as never);
    expect(() => fetchMissing(city.run, nullLines(city.wanted))).not.toThrow();
    await tick();
    fetchMissing(city.run, nullLines(city.wanted));
    expect(calls).toEqual([60, 60]);
  });

  it('two fetchers do not share their tries (the counts belong to one server run)', async () => {
    const pairs = nullLines(city.wanted.slice(0, 3));
    for (let serverRun = 0; serverRun < 2; serverRun++) {
      const fake = fakeEnsure({}, 'fail');
      const fetchMissing = createMapLineFetcher(fake.ensureLegPolylines);
      for (let i = 0; i < 4; i++) {
        fetchMissing(city.run, pairs);
        await tick();
      }
      expect(fake.calls).toEqual([city.wanted.slice(0, 3), city.wanted.slice(0, 3)]);
    }
  });
});
