// sanity() of server/geo/cacheReport.ts: one test per rule, each on a clean hand-built matrix with one thing wrong.
import { describe, expect, it } from 'vitest';
import {
  MAX_ASYMMETRY_RATIO,
  MAX_DETOUR_RATIO,
  MAX_DURATION_S,
  MAX_SPEED_KMH,
  MIN_SPEED_KMH,
  NYC_BOX,
  SAME_POINT_M,
  SANITY_CODES,
  SANITY_LEVELS,
  STRAIGHT_LINE_SLACK_M,
  sanity,
  straightLineM,
} from '../../server/geo/cacheReport';
import type { SanityFinding } from '../../server/geo/cacheReport';
import type { TravelMatrixFile } from '../../shared/v2/types';
import { BUSINESSES, HOMES, cleanPlaces, fullMatrix, pairValue } from './cache-report-helpers';

const run = (matrix: TravelMatrixFile) => sanity({ matrix, businesses: BUSINESSES, homes: HOMES });
const codes = (findings: SanityFinding[]) => [...new Set(findings.map((finding) => finding.code))];

describe('cache report: sanity', () => {
  it('finds nothing in a clean matrix', () => {
    expect(run(fullMatrix())).toEqual([]);
  });

  it('states every threshold as a constant', () => {
    expect(NYC_BOX).toEqual({ south: 40.4774, west: -74.2591, north: 40.9176, east: -73.7004 });
    expect(SAME_POINT_M).toBe(30);
    expect(MAX_DETOUR_RATIO).toBe(6);
    expect(MIN_SPEED_KMH).toBe(5);
    expect(MAX_SPEED_KMH).toBe(110);
    expect(MAX_ASYMMETRY_RATIO).toBe(3);
    expect(MAX_DURATION_S).toBe(3 * 60 * 60);
    expect(STRAIGHT_LINE_SLACK_M).toBeGreaterThan(0);
    expect(Object.keys(SANITY_LEVELS).sort()).toEqual([...SANITY_CODES].sort());
  });

  it('flags a place outside the five-borough box (outside-nyc)', () => {
    const places = cleanPlaces();
    places['biz-a'] = { ...places['biz-a'], lat: 40.95, lng: -73.87 }; // north of the Bronx, still a New York address
    const findings = run(fullMatrix(places));

    expect(codes(findings)).toEqual(['outside-nyc']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: 'error', placeIds: ['biz-a'] });
    expect(findings[0].message).toContain('Alpha Press (Midtown)');
    expect(findings[0].message).toContain('north');
  });

  it('flags a home outside the box too, by ID and neighborhood', () => {
    const places = cleanPlaces();
    places['home-001'] = { lat: 40.76, lng: -74.4 };
    const findings = run(fullMatrix(places));

    expect(codes(findings)).toEqual(['outside-nyc']);
    expect(findings[0].message).toContain('home-001 (Astoria)');
    expect(findings[0].message).toContain('west');
  });

  it('flags a business whose geocoded address does not mention New York (address-not-new-york)', () => {
    const matrix = fullMatrix();
    matrix.places['biz-b'].formattedAddress = '2 Bravo St, Boston, MA 02124, USA';
    const findings = run(matrix);

    expect(codes(findings)).toEqual(['address-not-new-york']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: 'error', placeIds: ['biz-b'] });
    expect(findings[0].message).toContain('Bravo Books (DUMBO)');
    expect(findings[0].message).toContain('Boston, MA');
  });

  it('flags a business with no geocoder address at all, but never a home (homes have none)', () => {
    const matrix = fullMatrix();
    delete matrix.places['biz-c'].formattedAddress;
    const findings = run(matrix);

    expect(findings.map((finding) => [finding.code, finding.placeIds])).toEqual([['address-not-new-york', ['biz-c']]]);
  });

  it('flags two businesses geocoded to the same point (same-point)', () => {
    const places = cleanPlaces();
    places['biz-b'] = { ...places['biz-b'], lat: places['biz-a'].lat + 0.0001, lng: places['biz-a'].lng }; // about 11 m away
    expect(straightLineM(places['biz-a'], places['biz-b'])).toBeLessThan(SAME_POINT_M);
    const findings = run(fullMatrix(places));

    expect(codes(findings)).toEqual(['same-point']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: 'error', placeIds: ['biz-a', 'biz-b'] });
  });

  it('does not flag a home next to a business as the same point', () => {
    const places = cleanPlaces();
    places['home-001'] = { lat: places['biz-c'].lat + 0.0001, lng: places['biz-c'].lng };
    const matrix = fullMatrix(places);

    expect(codes(run(matrix))).not.toContain('same-point');
  });

  it.each([
    ['durationS', 0],
    ['durationS', -5],
    ['distanceM', 0],
    ['distanceM', Number.NaN],
  ] as const)('flags a pair between different places with %s = %s (non-positive)', (field, value) => {
    const matrix = fullMatrix();
    matrix.pairs['biz-a|biz-b'][field] = value;
    const findings = run(matrix);

    expect(codes(findings)).toEqual(['non-positive']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: 'error', placeIds: ['biz-a', 'biz-b'] });
    expect(findings[0].message).not.toMatch(/NaN|undefined/);
  });

  it('flags a driving distance shorter than the straight line (shorter-than-straight-line)', () => {
    const matrix = fullMatrix();
    const { places } = matrix;
    matrix.pairs['biz-a|biz-b'] = pairValue(places['biz-a'], places['biz-b'], 0.5);
    const findings = run(matrix);

    expect(codes(findings)).toEqual(['shorter-than-straight-line']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: 'error', placeIds: ['biz-a', 'biz-b'] });
  });

  it('allows a driving distance a little under the straight line (Google snaps both ends to a road)', () => {
    const matrix = fullMatrix();
    const straight = straightLineM(matrix.places['biz-a'], matrix.places['biz-b']);
    matrix.pairs['biz-a|biz-b'].distanceM = Math.round(straight - STRAIGHT_LINE_SLACK_M / 2);

    expect(run(matrix)).toEqual([]);
  });

  it('flags a driving distance of more than 6x the straight line (detour)', () => {
    const matrix = fullMatrix();
    const { places } = matrix;
    // Both directions, so the two durations still agree with each other.
    matrix.pairs['biz-a|biz-c'] = pairValue(places['biz-a'], places['biz-c'], MAX_DETOUR_RATIO + 1);
    matrix.pairs['biz-c|biz-a'] = pairValue(places['biz-c'], places['biz-a'], MAX_DETOUR_RATIO + 1);
    const findings = run(matrix);

    expect(codes(findings)).toEqual(['detour']);
    expect(findings.map((finding) => finding.placeIds)).toEqual([['biz-a', 'biz-c'], ['biz-c', 'biz-a']]);
    expect(findings[0].level).toBe('warn');
  });

  it('flags an implied average speed under 5 km/h (too-slow)', () => {
    const matrix = fullMatrix();
    const { places } = matrix;
    matrix.pairs['biz-a|biz-c'] = pairValue(places['biz-a'], places['biz-c'], undefined, 4);
    matrix.pairs['biz-c|biz-a'] = pairValue(places['biz-c'], places['biz-a'], undefined, 4);
    const findings = run(matrix);

    expect(codes(findings)).toEqual(['too-slow']);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ level: 'warn', placeIds: ['biz-a', 'biz-c'] });
    expect(findings[0].message).toContain('4 km/h');
  });

  it('flags an implied average speed over 110 km/h (too-fast)', () => {
    const matrix = fullMatrix();
    const { places } = matrix;
    matrix.pairs['home-002|biz-a'] = pairValue(places['home-002'], places['biz-a'], undefined, 130);
    matrix.pairs['biz-a|home-002'] = pairValue(places['biz-a'], places['home-002'], undefined, 130);
    const findings = run(matrix);

    expect(codes(findings)).toEqual(['too-fast']);
    expect(findings).toHaveLength(2);
    expect(findings[0].level).toBe('warn');
    expect(findings[0].message).toContain('home-002 (Park Slope)');
  });

  it('flags A → B and B → A durations that differ by more than 3x, once per pair (asymmetric)', () => {
    const matrix = fullMatrix();
    matrix.pairs['biz-b|biz-a'].durationS = Math.round(matrix.pairs['biz-a|biz-b'].durationS * 3.5);
    const findings = run(matrix);

    expect(codes(findings)).toEqual(['asymmetric']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: 'warn', placeIds: ['biz-a', 'biz-b'] });
  });

  it('does not flag durations that differ by less than 3x', () => {
    const matrix = fullMatrix();
    matrix.pairs['biz-b|biz-a'].durationS = Math.round(matrix.pairs['biz-a|biz-b'].durationS * 2.5);

    expect(run(matrix)).toEqual([]);
  });

  it('flags a duration over 3 hours (too-long)', () => {
    // Two far corners of the box, so 3 hours is neither a crawl nor a detour.
    const places = cleanPlaces();
    places['biz-a'] = { ...places['biz-a'], lat: 40.51, lng: -74.24 };
    places['biz-b'] = { ...places['biz-b'], lat: 40.9, lng: -73.82 };
    const matrix = fullMatrix(places);
    expect(run(matrix)).toEqual([]);
    matrix.pairs['biz-a|biz-b'].durationS = MAX_DURATION_S + 600;
    const findings = run(matrix);

    expect(codes(findings)).toEqual(['too-long']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: 'error', placeIds: ['biz-a', 'biz-b'] });
    expect(findings[0].message).toContain('3 h 10 min');
  });

  it('checks pairs of places it was not told about (a commute-editor home) without printing the ID', () => {
    const matrix = fullMatrix();
    const id = 'home-c-40.76420_-73.92350';
    matrix.places[id] = { lat: 40.7642, lng: -73.9235 };
    matrix.pairs[`${id}|biz-a`] = { durationS: 0, distanceM: 0 };
    const findings = run(matrix);

    expect(findings.map((finding) => [finding.code, finding.placeIds])).toEqual([['non-positive', [id, 'biz-a']]]);
    expect(findings[0].message).not.toMatch(/40\.76|73\.92/);
  });

  it('is deterministic and does not change the matrix', () => {
    const matrix = fullMatrix();
    matrix.pairs['biz-a|biz-b'].durationS = 0;
    matrix.places['biz-c'].formattedAddress = 'Somewhere, NJ';
    const before = JSON.stringify(matrix);
    const first = run(matrix);

    expect(run(matrix)).toEqual(first);
    expect(JSON.stringify(matrix)).toBe(before);
    expect(first.map((finding) => finding.code)).toEqual(['address-not-new-york', 'non-positive']);
  });
});
