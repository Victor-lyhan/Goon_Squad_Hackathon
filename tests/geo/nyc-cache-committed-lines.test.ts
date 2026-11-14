// Guard on the committed Google cache, part 2: fixtures/nyc/polylines.json (issue #498).
// Every stored route line must be a pair of the matrix, decode, stay inside the NYC box, join its two places and
// be about as long as the pair's distanceM, so a line left behind by a partial refetch or pasted under the wrong
// key is caught by CI and not as a marker driving through a river on stage.
// It does NOT assert which pairs have a line: the story is being retuned and a human fetches the missing lines
// afterwards, and a pair without a line is legal (DECISIONS pass 44: the marker then moves on the straight line).
// Part 1 (places and pairs) is nyc-cache-committed-matrix.test.ts. No network, no key, nothing written.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { decodePolyline, encodePolyline } from '../../server/domain/v2/polyline';
import type { TravelFiles } from '../../server/geo/cache';
import {
  COMMITTED_CACHE_TEST_TIMEOUT_MS,
  MAX_LINE_END_OFFSET_M,
  MAX_LINE_LENGTH_RATIO,
  MIN_LINE_LENGTH_RATIO,
  failureMessage,
  formatLineOutliers,
  lineReport,
  loadCommittedCache,
  ofCheck,
  polylinesFileExists,
  splitPairKey,
} from './nyc-cache-committed-helper';
import type { LineReport } from './nyc-cache-committed-helper';

vi.setConfig({ testTimeout: COMMITTED_CACHE_TEST_TIMEOUT_MS, hookTimeout: COMMITTED_CACHE_TEST_TIMEOUT_MS });

let files: TravelFiles;
let report: LineReport;

beforeAll(() => {
  files = loadCommittedCache();
  report = lineReport(files);
});

describe('committed NYC route lines (fixtures/nyc/polylines.json)', () => {
  it('every key is a pair that is in the matrix, between two cached places', () => {
    const problems = ofCheck(report.problems, 'line-pair');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });

  it('every line decodes to at least 2 points', () => {
    const problems = ofCheck(report.problems, 'line-decode');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });

  it('every point of every line is inside the NYC box', () => {
    const problems = ofCheck(report.problems, 'line-outside-box');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });

  it(`every line starts and ends within ${MAX_LINE_END_OFFSET_M} m of its two places`, () => {
    const problems = ofCheck(report.problems, 'line-ends');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });

  it(`every line is between ${MIN_LINE_LENGTH_RATIO} and ${MAX_LINE_LENGTH_RATIO} times as long as its pair's distanceM`, () => {
    const problems = ofCheck(report.problems, 'line-length');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });

  it('measures every stored line and prints the ones closest to each limit', () => {
    const stored = Object.keys(files.polylines.polylines).length;
    if (!polylinesFileExists()) console.log('fixtures/nyc/polylines.json is not there: no route line is drawn, which is legal.');
    const lines = formatLineOutliers(report.stats);
    console.log(lines.join('\n'));

    // A line is left out of the measurements only when an earlier check already failed for it.
    const unmeasured = ofCheck(report.problems, 'line-pair', 'line-decode').length;
    expect(report.stats).toHaveLength(stored - unmeasured);
    expect(lines.join('\n')).not.toMatch(/undefined|NaN|Infinity/);
  });
});

// The guard has to bite. Each case breaks a copy of the committed cache in memory and reads the message a red
// CI run would show. The cases pick their lines from whatever is stored, so they survive a refetch of the story.
describe('committed NYC route lines: the checks catch a broken copy', () => {
  const copy = () => structuredClone(files);
  /** The stored line with the most points, so there is something to cut, reverse and bend. */
  const longest = () => [...report.stats].sort((a, b) => b.points - a.points || (a.key < b.key ? -1 : 1))[0];
  const only = (broken: TravelFiles) => lineReport(broken).problems;

  it('has stored lines to break (if this fails the committed polylines.json is empty; fetch the lines first)', () => {
    expect(report.stats.length).toBeGreaterThan(0);
    expect(longest().points).toBeGreaterThanOrEqual(4);
  });

  it('a pair without a line is legal: a cache with no lines at all has no line problem', () => {
    const none = copy();
    none.polylines.polylines = {};
    expect(lineReport(none)).toEqual({ problems: [], stats: [] });
    expect(formatLineOutliers([])).toEqual(['Route lines: none stored, so there is nothing to measure.']);
  });

  it('a line whose pair was dropped from the matrix fails with the pair and the --refetch command', () => {
    const { key } = longest();
    const broken = copy();
    delete broken.matrix.pairs[key];

    const problems = only(broken);

    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([['line-pair', key]]);
    const message = failureMessage(problems);
    expect(message).toContain('its pair is not in matrix.json "pairs"');
    expect(message.split('\n')).toContain(`  npm run fetch:routes -- --refetch ${problems[0].refetch[0]}`);
    expect(key.split('|')).toContain(problems[0].refetch[0]);
  });

  it('a line between places the cache does not hold fails', () => {
    const broken = copy();
    broken.polylines.polylines[pairKey('home-story-nowhere-1', 'biz-nobody')] = files.polylines.polylines[longest().key];

    const problems = only(broken);

    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([['line-pair', 'home-story-nowhere-1|biz-nobody']]);
    expect(problems[0].what).toContain('home-story-nowhere-1 is not in matrix.json "places"');
  });

  it('a truncated line and a one-point line fail to decode', () => {
    const [first, second] = [...report.stats].sort((a, b) => b.points - a.points || (a.key < b.key ? -1 : 1));
    const broken = copy();
    // Cut off the last number (a longitude), so the last point has a latitude and nothing after it. Inside a
    // number every character but the last has the "more follows" bit (0x20).
    const encoded = files.polylines.polylines[first.key];
    let cut = encoded.length - 1;
    while (cut > 0 && encoded.charCodeAt(cut - 1) - 63 >= 0x20) cut -= 1;
    expect(cut).toBeGreaterThan(0);
    broken.polylines.polylines[first.key] = encoded.slice(0, cut);
    broken.polylines.polylines[second.key] = encodePolyline(decodePolyline(files.polylines.polylines[second.key]).slice(0, 1));

    const problems = only(broken);

    expect(problems.map((problem) => [problem.check, problem.subject]).sort()).toEqual(
      [
        ['line-decode', first.key],
        ['line-decode', second.key],
      ].sort(),
    );
    expect(problems.map((problem) => problem.what).join('\n')).toMatch(/does not decode \(Invalid encoded polyline/);
    expect(problems.map((problem) => problem.what).join('\n')).toContain('decodes to 1 point(s)');
  });

  it('a line stored the wrong way round does not join its two places', () => {
    const { key } = longest();
    const broken = copy();
    broken.polylines.polylines[key] = encodePolyline(decodePolyline(files.polylines.polylines[key]).reverse());

    const problems = only(broken);

    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([['line-ends', key]]);
    expect(problems[0].what).toContain(`the limit is ${MAX_LINE_END_OFFSET_M} m`);
    expect(failureMessage(problems)).toContain('npm run fetch:routes -- --refetch ');
  });

  it('a line that runs there, back and there again, or whose pair is three times as far, is the wrong length for its pair', () => {
    const { key } = longest();
    const points = decodePolyline(files.polylines.polylines[key]);
    const { from, to } = splitPairKey(key)!;

    // There, back and there again: it still joins its two places, but it is three times the road.
    const outAndBack = copy();
    outAndBack.polylines.polylines[key] = encodePolyline([...points, ...[...points].reverse(), ...points]);
    expect(only(outAndBack).map((problem) => [problem.check, problem.subject])).toEqual([['line-length', key]]);
    expect(only(outAndBack)[0].what).toContain(`allowed ${MIN_LINE_LENGTH_RATIO} to ${MAX_LINE_LENGTH_RATIO}`);

    // The same line against a pair whose distance says the trip is three times as long: a third, under 0.7.
    const stretched = copy();
    stretched.matrix.pairs[key].distanceM *= 3;
    const problems = only(stretched);
    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([['line-length', key]]);
    expect([from, to]).toContain(problems[0].refetch[0]);
  });

  it('a line that leaves the NYC box fails', () => {
    const { key } = longest();
    const points = decodePolyline(files.polylines.polylines[key]);
    const broken = copy();
    // One point far north of the box in the middle of the line; the ends stay on their places.
    const middle = Math.floor(points.length / 2);
    broken.polylines.polylines[key] = encodePolyline([...points.slice(0, middle), { lat: 41.5, lng: points[middle].lng }, ...points.slice(middle)]);

    const checks = only(broken).map((problem) => problem.check);

    expect(checks).toContain('line-outside-box');
    expect(only(broken).find((problem) => problem.check === 'line-outside-box')!.what).toMatch(/has 1 of \d+ points outside the NYC box/);
  });

  it('none of the cases above changed the committed cache in memory', () => {
    expect(lineReport(files).problems).toEqual(report.problems);
  });
});
