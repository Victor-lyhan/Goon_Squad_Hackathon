// Round trip of dropPlaces with the real planner (server/geo/fetchPlan.ts): after a drop, the next fetch plans
// exactly the dropped place's entries and nothing else. No network, no key, no files.
import { describe, expect, it } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import type { TravelFiles } from '../../server/geo/cache';
import { dropPlaces } from '../../server/geo/cacheEdit';
import { batchPairs, commutePairs, planGeocodes, planMatrixPairs, planPolylines } from '../../server/geo/fetchPlan';
import { BUSINESSES, BUSINESS_IDS, EMPLOYEES, HOME_IDS, WANTED_LINES, completeFiles } from './cache-edit-helpers';

/** What the next `fetch:routes` run would ask Google for, as sorted keys. */
function plans(files: TravelFiles) {
  const matrix = planMatrixPairs({ businessIds: BUSINESS_IDS, homeIds: HOME_IDS }, files.matrix);
  const keys = (pairs: readonly { from: string; to: string }[]) => pairs.map((pair) => pairKey(pair.from, pair.to)).sort();
  return {
    geocodes: planGeocodes(BUSINESSES, files.matrix),
    pairs: keys(matrix.batches.flatMap(batchPairs)),
    missingPairs: matrix.missingPairs,
    cachedPairs: matrix.cachedPairs,
    commuteLines: keys(planPolylines(commutePairs(EMPLOYEES), files.polylines)),
    lines: keys(planPolylines(WANTED_LINES, files.polylines)),
  };
}

describe('dropPlaces → fetch plan round trip', () => {
  it('plans nothing on the complete cache', () => {
    expect(plans(completeFiles())).toEqual({ geocodes: [], pairs: [], missingPairs: 0, cachedPairs: 24, commuteLines: [], lines: [] });
  });

  it('after dropping one home, plans exactly that home\'s pairs and commute lines', () => {
    const { files } = dropPlaces(completeFiles(), ['home-story-harlem-2']);
    const home = 'home-story-harlem-2';

    expect(plans(files)).toEqual({
      geocodes: [],
      pairs: [`biz-a|${home}`, `biz-b|${home}`, `biz-c|${home}`, `${home}|biz-a`, `${home}|biz-b`, `${home}|biz-c`],
      missingPairs: 6,
      cachedPairs: 18,
      // Two employees live there: biz-c and biz-a, both directions each.
      commuteLines: [`biz-a|${home}`, `biz-c|${home}`, `${home}|biz-a`, `${home}|biz-c`],
      lines: [`biz-a|${home}`, `biz-c|${home}`, `${home}|biz-a`, `${home}|biz-c`],
    });
  });

  it('after dropping home-1, plans nothing for home-10', () => {
    const { files } = dropPlaces(completeFiles(), ['home-1']);
    const after = plans(files);

    expect(after.pairs).toEqual(['biz-a|home-1', 'biz-b|home-1', 'biz-c|home-1', 'home-1|biz-a', 'home-1|biz-b', 'home-1|biz-c']);
    expect(after.commuteLines).toEqual(['biz-a|home-1', 'home-1|biz-a']);
    expect(after.geocodes).toEqual([]);
  });

  it('after dropping one business, lists it for geocoding again, with exactly its pairs and lines', () => {
    const { files } = dropPlaces(completeFiles(), ['biz-b']);

    expect(plans(files)).toEqual({
      geocodes: [{ id: 'biz-b', address: '2 Bravo St, Brooklyn, NY' }],
      pairs: [
        'biz-a|biz-b', 'biz-b|biz-a', 'biz-b|biz-c', 'biz-b|home-1', 'biz-b|home-10', 'biz-b|home-story-harlem-2',
        'biz-c|biz-b', 'home-10|biz-b', 'home-1|biz-b', 'home-story-harlem-2|biz-b', // code-unit order: "0" sorts before "|"
      ],
      missingPairs: 10,
      cachedPairs: 14,
      commuteLines: ['biz-b|home-10', 'home-10|biz-b'],
      lines: ['biz-a|biz-b', 'biz-b|home-10', 'home-10|biz-b'],
    });
  });

  it('plans what the removed counts say: as many pairs and lines as were dropped', () => {
    const { files, removed } = dropPlaces(completeFiles(), ['home-10', 'biz-c']);
    const after = plans(files);
    expect(after.missingPairs).toBe(removed.pairs);
    expect(after.pairs).toHaveLength(removed.pairs);
    expect(after.lines).toHaveLength(removed.polylines);
    expect(after.geocodes.map((target) => target.id)).toEqual(['biz-c']);
  });

  it('an unknown ID leaves the plans empty', () => {
    const { files } = dropPlaces(completeFiles(), ['home-999']);
    expect(plans(files)).toEqual(plans(completeFiles()));
  });
});
