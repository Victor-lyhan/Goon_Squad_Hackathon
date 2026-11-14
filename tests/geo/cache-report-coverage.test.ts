// coverage() of server/geo/cacheReport.ts: what the app needs from the travel cache and what is missing.
import { describe, expect, it } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { coverage } from '../../server/geo/cacheReport';
import { BUSINESS_IDS, HOMES, emptyMatrix, emptyPolylines, fullMatrix } from './cache-report-helpers';

const POLYLINE_PAIRS = [
  { from: 'home-001', to: 'biz-a' },
  { from: 'biz-a', to: 'home-001' },
  { from: 'biz-a', to: 'biz-b' },
];

describe('cache report: coverage', () => {
  it('reports 6 + 12 missing pairs for an empty cache with 3 businesses and 2 homes', () => {
    const report = coverage({ matrix: emptyMatrix(), polylines: emptyPolylines(), businessIds: BUSINESS_IDS, homes: HOMES, polylinePairs: POLYLINE_PAIRS });

    expect(report.businesses).toEqual({ needed: 3, missing: ['biz-a', 'biz-b', 'biz-c'] });
    expect(report.businessPairs.needed).toBe(6);
    expect(report.businessPairs.missing).toHaveLength(6);
    expect(report.homePairs.needed).toBe(12);
    expect(report.homePairs.missing).toHaveLength(12);
    expect(report.polylines.needed).toBe(3);
    expect(report.polylines.missing).toHaveLength(3);
    expect(report.homes).toBe(2);
  });

  it('lists the missing pairs in a fixed order: business pairs by from then to; home → business, then business → home', () => {
    const report = coverage({ matrix: emptyMatrix(), polylines: emptyPolylines(), businessIds: BUSINESS_IDS, homes: HOMES, polylinePairs: [] });

    expect(report.businessPairs.missing.map((p) => pairKey(p.from, p.to))).toEqual([
      'biz-a|biz-b', 'biz-a|biz-c', 'biz-b|biz-a', 'biz-b|biz-c', 'biz-c|biz-a', 'biz-c|biz-b',
    ]);
    expect(report.homePairs.missing.map((p) => pairKey(p.from, p.to))).toEqual([
      'home-001|biz-a', 'home-001|biz-b', 'home-001|biz-c', 'home-002|biz-a', 'home-002|biz-b', 'home-002|biz-c',
      'biz-a|home-001', 'biz-a|home-002', 'biz-b|home-001', 'biz-b|home-002', 'biz-c|home-001', 'biz-c|home-002',
    ]);
  });

  it('reports nothing missing for a full cache', () => {
    const polylines = emptyPolylines();
    for (const pair of POLYLINE_PAIRS) polylines.polylines[pairKey(pair.from, pair.to)] = 'abc';
    const report = coverage({ matrix: fullMatrix(), polylines, businessIds: BUSINESS_IDS, homes: HOMES, polylinePairs: POLYLINE_PAIRS });

    expect(report.businesses.missing).toEqual([]);
    expect(report.businessPairs).toEqual({ needed: 6, missing: [] });
    expect(report.homePairs).toEqual({ needed: 12, missing: [] });
    expect(report.polylines).toEqual({ needed: 3, missing: [] });
  });

  it('lists exactly the missing places, pairs and polylines of a partial cache', () => {
    const matrix = fullMatrix();
    delete matrix.places['biz-b'];
    delete matrix.pairs['biz-c|biz-a'];
    delete matrix.pairs['home-002|biz-b'];
    delete matrix.pairs['biz-a|home-001'];
    const polylines = emptyPolylines();
    polylines.polylines['home-001|biz-a'] = 'abc';
    polylines.polylines['biz-a|biz-b'] = ''; // an empty line is not a route line
    const report = coverage({ matrix, polylines, businessIds: BUSINESS_IDS, homes: HOMES, polylinePairs: POLYLINE_PAIRS });

    expect(report.businesses).toEqual({ needed: 3, missing: ['biz-b'] });
    expect(report.businessPairs).toEqual({ needed: 6, missing: [{ from: 'biz-c', to: 'biz-a' }] });
    expect(report.homePairs).toEqual({
      needed: 12,
      missing: [{ from: 'home-002', to: 'biz-b' }, { from: 'biz-a', to: 'home-001' }],
    });
    expect(report.polylines).toEqual({
      needed: 3,
      missing: [{ from: 'biz-a', to: 'biz-b' }, { from: 'biz-a', to: 'home-001' }],
    });
  });

  it('gives the same report whatever the input order, and ignores duplicates and self pairs', () => {
    const matrix = fullMatrix();
    delete matrix.pairs['biz-b|biz-c'];
    delete matrix.pairs['home-001|biz-c'];
    const args = { matrix, polylines: emptyPolylines() };
    const sorted = coverage({ ...args, businessIds: BUSINESS_IDS, homes: HOMES, polylinePairs: POLYLINE_PAIRS });
    const shuffled = coverage({
      ...args,
      businessIds: ['biz-c', 'biz-a', 'biz-b', 'biz-a'],
      homes: [HOMES[1], HOMES[0], HOMES[1]],
      polylinePairs: [...POLYLINE_PAIRS].reverse().concat(POLYLINE_PAIRS[0], { from: 'biz-a', to: 'biz-a' }),
    });

    expect(shuffled).toEqual(sorted);
    expect(sorted.polylines.needed).toBe(3);
  });

  it('counts a business whose cached place has no usable coordinates as not geocoded', () => {
    const matrix = fullMatrix();
    (matrix.places['biz-a'] as { lat: unknown }).lat = null;
    const report = coverage({ matrix, polylines: emptyPolylines(), businessIds: BUSINESS_IDS, homes: HOMES, polylinePairs: [] });

    expect(report.businesses.missing).toEqual(['biz-a']);
  });

  it('does not change the cache it reads', () => {
    const matrix = fullMatrix();
    const polylines = emptyPolylines();
    const before = JSON.stringify({ matrix, polylines });
    coverage({ matrix, polylines, businessIds: BUSINESS_IDS, homes: HOMES, polylinePairs: POLYLINE_PAIRS });

    expect(JSON.stringify({ matrix, polylines })).toBe(before);
  });
});

describe('cache report: module rules', () => {
  it('imports only the shared v2 contracts and touches no file system, environment or console', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../../server/geo/cacheReport.ts'), 'utf8');
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);

    expect([...new Set(imports)]).toEqual(['../../shared/v2/types']);
    expect(source).not.toMatch(/\bconsole\.|process\.env|\brequire\(|\bimport\(/);
  });
});
