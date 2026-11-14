// formatCacheReport() of server/geo/cacheReport.ts: the text the fetch script prints and a human reads.
import { describe, expect, it } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import type { Home } from '../../shared/v2/types';
import { MAX_LISTED, coverage, formatCacheReport, sanity } from '../../server/geo/cacheReport';
import { BUSINESSES, BUSINESS_IDS, HOMES, emptyMatrix, emptyPolylines, fullMatrix } from './cache-report-helpers';

// Not a real key: only shaped like a Google one, to prove the report would not print it.
const FAKE_KEY = 'AIzaSyFAKE-not-a-real-key_0123456789abcde';

const POLYLINE_PAIRS = [
  { from: 'home-001', to: 'biz-a' },
  { from: 'biz-a', to: 'biz-b' },
];

const report = (args: { matrix?: ReturnType<typeof fullMatrix>; polylines?: ReturnType<typeof emptyPolylines>; homes?: Home[]; maxListed?: number }) => {
  const matrix = args.matrix ?? fullMatrix();
  const polylines = args.polylines ?? emptyPolylines();
  const homes = args.homes ?? HOMES;
  return formatCacheReport({
    coverage: coverage({ matrix, polylines, businessIds: BUSINESS_IDS, homes, polylinePairs: POLYLINE_PAIRS }),
    sanity: sanity({ matrix, businesses: BUSINESSES, homes }),
    businesses: BUSINESSES,
    homes,
    maxListed: args.maxListed,
  });
};

function fullPolylines() {
  const polylines = emptyPolylines();
  for (const pair of POLYLINE_PAIRS) polylines.polylines[pairKey(pair.from, pair.to)] = 'abc';
  return polylines;
}

/** A cache with one of nearly everything wrong, plus a key and coordinates hidden where a careless report would print them. */
function messyCase() {
  const matrix = fullMatrix();
  const editorHome: Home = { id: 'home-c-40.76420_-73.92350', neighborhood: 'Astoria', lat: 40.7642, lng: -73.9235 };
  matrix.places[editorHome.id] = { lat: editorHome.lat, lng: editorHome.lng };
  matrix.pairs[`${editorHome.id}|biz-a`] = { durationS: Number.NaN, distanceM: undefined as unknown as number };
  matrix.places['biz-b'].formattedAddress = `2 Bravo St, Boston, MA 02124, USA ${FAKE_KEY} https://example.test/?key=${FAKE_KEY}`;
  matrix.places['biz-c'] = { ...matrix.places['biz-c'], lat: 41.2 };
  (matrix as unknown as Record<string, unknown>).apiKey = FAKE_KEY;
  delete matrix.pairs['biz-a|biz-b'];
  delete matrix.pairs['home-002|biz-a'];
  matrix.pairs['biz-c|biz-a'].durationS = matrix.pairs['biz-a|biz-c'].durationS * 4;
  return { matrix, homes: [...HOMES, editorHome] };
}

describe('cache report: text', () => {
  it('says so in a few lines when the cache is complete and clean', () => {
    expect(report({ polylines: fullPolylines() })).toEqual([
      'Travel cache report',
      '  Businesses geocoded: 3 of 3',
      '  Business → business pairs: 6 of 6',
      '  Home ↔ business pairs (2 homes): 12 of 12',
      '  Route polylines: 2 of 2',
      '  Sanity checks: 0 errors, 0 warnings',
      'Errors: none',
      'Warnings: none',
      'Result: the cache covers everything and nothing looks wrong.',
    ]);
  });

  it('puts totals first, then errors, then warnings, then the result', () => {
    const lines = report(messyCase());
    const at = (start: string) => lines.findIndex((line) => line.startsWith(start));

    expect(lines[0]).toBe('Travel cache report');
    expect(at('  Businesses geocoded: 3 of 3')).toBe(1);
    expect(at('  Business → business pairs: 5 of 6 (1 missing)')).toBe(2);
    expect(at('  Home ↔ business pairs (3 homes): 12 of 18 (6 missing)')).toBe(3);
    expect(at('  Route polylines: 0 of 2 (2 missing)')).toBe(4);
    expect(at('Errors (')).toBeGreaterThan(4);
    expect(at('Warnings (')).toBeGreaterThan(at('Errors ('));
    expect(at('Result: ')).toBe(lines.length - 1);
    expect(lines[lines.length - 1]).toMatch(/error/);

    const errors = lines.slice(at('Errors (') + 1, at('Warnings ('));
    const warnings = lines.slice(at('Warnings (') + 1, -1);
    expect(errors.some((line) => line.includes('[missing-pair]'))).toBe(true);
    expect(errors.some((line) => line.includes('[outside-nyc]'))).toBe(true);
    expect(errors.some((line) => line.includes('[address-not-new-york]'))).toBe(true);
    expect(errors.some((line) => line.includes('[non-positive]'))).toBe(true);
    expect(errors.every((line) => !line.includes('[asymmetric]') && !line.includes('[missing-polyline]'))).toBe(true);
    expect(warnings.some((line) => line.includes('[missing-polyline]'))).toBe(true);
    expect(warnings.some((line) => line.includes('[asymmetric]'))).toBe(true);
  });

  it('counts errors and warnings in the section headers', () => {
    const { matrix, homes } = messyCase();
    const lines = report({ matrix, homes });
    const cov = coverage({ matrix, polylines: emptyPolylines(), businessIds: BUSINESS_IDS, homes, polylinePairs: POLYLINE_PAIRS });
    const findings = sanity({ matrix, businesses: BUSINESSES, homes });
    const errors = cov.businessPairs.missing.length + cov.homePairs.missing.length + findings.filter((f) => f.level === 'error').length;
    const warnings = cov.polylines.missing.length + findings.filter((f) => f.level === 'warn').length;

    expect(lines).toContain(`Errors (${errors})`);
    expect(lines).toContain(`Warnings (${warnings})`);
  });

  it('shows businesses by name and neighborhood, and a home by ID and neighborhood', () => {
    const text = report(messyCase()).join('\n');

    expect(text).toContain('[missing-pair] Alpha Press (Midtown) → Bravo Books (DUMBO) has no travel time');
    expect(text).toContain('[missing-pair] home-002 (Park Slope) → Alpha Press (Midtown) has no travel time');
    expect(text).toContain('[missing-polyline] home-001 (Astoria) → Alpha Press (Midtown) has no route line');
    expect(text).toContain('[outside-nyc] Charlie Coffee (Long Island City) is outside the five boroughs (too far north)');
    expect(text).toContain('Boston, MA');
  });

  it('never prints undefined, NaN, coordinates or anything key-like', () => {
    const { matrix, homes } = messyCase();
    const text = report({ matrix, homes }).join('\n');

    expect(text).not.toMatch(/undefined|NaN|null|\[object/);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toMatch(/AIza/);
    expect(text).not.toMatch(/-?\d{1,3}\.\d{3,}/); // no number with 3+ decimals: nothing that could be a coordinate
    for (const place of Object.values(matrix.places)) {
      expect(text).not.toContain(String(place.lat));
      expect(text).not.toContain(String(place.lng));
    }
    for (const home of homes) {
      expect(text).not.toContain(String(home.lat));
      expect(text).not.toContain(String(home.lng));
    }
    // The commute-editor home is still reported, without its coordinate-bearing ID.
    expect(text).toContain('[non-positive] home-c (entered address) (Astoria) → Alpha Press (Midtown)');
  });

  it('falls back to place IDs (never coordinates) when no names are passed', () => {
    const { matrix, homes } = messyCase();
    delete matrix.pairs['biz-a|home-c-40.76420_-73.92350'];
    const lines = formatCacheReport({
      coverage: coverage({ matrix, polylines: emptyPolylines(), businessIds: BUSINESS_IDS, homes, polylinePairs: POLYLINE_PAIRS }),
      sanity: [],
    });
    const text = lines.join('\n');

    expect(text).toContain('[missing-pair] biz-a → biz-b has no travel time');
    expect(text).toContain('[missing-pair] biz-a → home-c (entered address) has no travel time');
    expect(text).not.toMatch(/undefined|NaN|\d\.\d{3,}/);
  });

  it('caps each kind of problem and says how many more there are', () => {
    const all = report({ matrix: emptyMatrix() });
    expect(all.filter((line) => line.includes('[missing-pair]') && line.includes('→'))).toHaveLength(6 + 12);
    expect(MAX_LISTED).toBeGreaterThanOrEqual(6 + 12);

    const lines = report({ matrix: emptyMatrix(), maxListed: 2 });
    expect(lines).toContain('Errors (21)');
    expect(lines.filter((line) => line.startsWith('  [not-geocoded]'))).toHaveLength(2);
    expect(lines).toContain('... and 1 more [not-geocoded]');
    expect(lines).toContain('... and 4 more [missing-pair] between businesses');
    expect(lines).toContain('... and 10 more [missing-pair] between homes and businesses');
    expect(lines.filter((line) => line.startsWith('  [missing-polyline]'))).toHaveLength(2);
  });

  it('ends with a warnings-only result when there are no errors', () => {
    const lines = report({});

    expect(lines).toContain('Errors: none');
    expect(lines).toContain('Warnings (2)');
    expect(lines[lines.length - 1]).toBe('Result: no errors. Read the 2 warnings above before committing fixtures/nyc/.');
  });

  it('is the same text for the same input', () => {
    const a = messyCase();
    const b = messyCase();

    expect(report(a)).toEqual(report(b));
  });
});
