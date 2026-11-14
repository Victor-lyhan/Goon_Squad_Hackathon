// Guard on the committed Google cache, part 2: fixtures/nyc/polylines.json (issue #498).
// Every stored route line must be a pair of the matrix, decode, stay inside the NYC box, join its two places, be
// no shorter than the straight line between them and be 0.5 to 1.5 times the pair's distanceM (issue #554,
// DECISIONS pass 58), so a line left behind by a partial refetch or pasted under the wrong key is caught by CI
// and not as a marker driving through a river on stage.
// It does NOT assert which pairs have a line: the story is being retuned and a human fetches the missing lines
// afterwards, and a pair without a line is legal (DECISIONS pass 44: the marker then moves on the straight line).
// Part 1 (places and pairs) is nyc-cache-committed-matrix.test.ts. No network, no key, nothing written.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { decodePolyline, encodePolyline, pointAlong } from '../../server/domain/v2/polyline';
import type { TravelFiles } from '../../server/geo/cache';
import { straightLineM } from '../../server/geo/cacheReport';
import {
  COMMITTED_CACHE_TEST_TIMEOUT_MS,
  LINE_STRAIGHT_SLACK_M,
  LISTED_LINE_LENGTH_RATIO,
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

  it(`every line is between ${MIN_LINE_LENGTH_RATIO} and ${MAX_LINE_LENGTH_RATIO} times as long as its pair's distanceM, and not shorter than the straight line between its two places`, () => {
    const problems = ofCheck(report.problems, 'line-length');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });

  it(`a line under ${LISTED_LINE_LENGTH_RATIO} times its pair's distanceM passes, and the printed report lists it with both directions' distances`, () => {
    const text = formatLineOutliers(report.stats).join('\n');
    const short = report.stats.filter((stat) => stat.ratio < LISTED_LINE_LENGTH_RATIO);

    expect(text).toContain(`under ${LISTED_LINE_LENGTH_RATIO}x of distanceM (these pass; the limit is ${MIN_LINE_LENGTH_RATIO}x): ${short.length === 0 ? 'none' : `${short.length}.`}`);
    for (const stat of short) {
      // It joins its two places and is longer than the straight line between them: a real road, not a cut line.
      expect(Math.max(stat.startM, stat.endM)).toBeLessThanOrEqual(MAX_LINE_END_OFFSET_M);
      expect(stat.lengthM).toBeGreaterThanOrEqual(stat.straightM - LINE_STRAIGHT_SLACK_M);
      expect(text).toContain(
        `    ${stat.key}  ${stat.ratio.toFixed(3)}x  (line ${Math.round(stat.lengthM)} m, distanceM ${stat.distanceM}, ` +
          `the way back's distanceM ${stat.reverseDistanceM ?? 'not cached'}, straight line ${Math.round(stat.straightM)} m)`,
      );
    }
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
    // An entered home's ID holds its coordinates (DECISIONS pass 56): the report never prints one.
    expect(lines.join('\n')).not.toMatch(/home-c-/);
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

    // The same line against a pair whose distance says the trip is three times as long: a third, under 0.5.
    const stretched = copy();
    stretched.matrix.pairs[key].distanceM *= 3;
    const problems = only(stretched);
    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([['line-length', key]]);
    expect(problems[0].what).toMatch(/\(0\.3\dx; allowed 0\.5 to 1\.5/);
    expect([from, to]).toContain(problems[0].refetch[0]);
  });

  it(`the lower limit is ${MIN_LINE_LENGTH_RATIO}: a line at 0.6 times its pair's distanceM passes and is listed, one at 0.45 fails`, () => {
    const { key, lengthM } = longest();
    const { from, to } = splitPairKey(key)!;
    const backM: number | undefined = files.matrix.pairs[pairKey(to, from)]?.distanceM;
    const back = backM === undefined ? 'not cached' : String(backM);

    const listed = copy();
    listed.matrix.pairs[key].distanceM = Math.round(lengthM / 0.6);
    const passing = lineReport(listed);
    expect(passing.problems).toEqual(report.problems);
    expect(formatLineOutliers(passing.stats).join('\n')).toMatch(
      new RegExp(`\\n    ${key.replace('|', '\\|')}  0\\.60\\dx  \\(line \\d+ m, distanceM \\d+, the way back's distanceM ${back}, straight line \\d+ m\\)`),
    );

    const tooShort = copy();
    tooShort.matrix.pairs[key].distanceM = Math.round(lengthM / 0.45);
    const problems = only(tooShort);
    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([['line-length', key]]);
    expect(problems[0].what).toContain(`(0.45x; allowed ${MIN_LINE_LENGTH_RATIO} to ${MAX_LINE_LENGTH_RATIO}`);
    if (backM !== undefined) expect(problems[0].what).toContain(`the way back's distanceM is ${back})`);
    expect(failureMessage(problems)).toContain('npm run fetch:routes -- --refetch ');
  });

  it('a line cut in half does not reach its second place', () => {
    const { key } = longest();
    const points = decodePolyline(files.polylines.polylines[key]);
    const { to } = splitPairKey(key)!;
    const half = points.slice(0, Math.ceil(points.length / 2));
    const broken = copy();
    broken.polylines.polylines[key] = encodePolyline(half);

    const problems = only(broken);

    // Always the ends; the length too when the half is under 0.5x or shorter than the straight line.
    expect(problems.every((problem) => problem.subject === key)).toBe(true);
    expect(problems.map((problem) => problem.check).filter((check) => check !== 'line-length')).toEqual(['line-ends']);
    const gap = Math.round(straightLineM(half[half.length - 1], files.matrix.places[to]));
    expect(gap).toBeGreaterThan(MAX_LINE_END_OFFSET_M);
    expect(problems[0].what).toContain(`ends ${gap} m from ${to}; the limit is ${MAX_LINE_END_OFFSET_M} m`);
    expect(failureMessage(problems)).toContain('npm run fetch:routes -- --refetch ');
  });

  it('a line stored under the key of another pair does not join that pair\'s places', () => {
    const line = longest();
    const lineFrom = files.matrix.places[splitPairKey(line.key)!.from];
    const lineTo = files.matrix.places[splitPairKey(line.key)!.to];
    // Another stored pair whose two places are both far from the line's own ends.
    const other = report.stats.find((stat) => {
      const ends = splitPairKey(stat.key)!;
      return (
        straightLineM(files.matrix.places[ends.from], lineFrom) > 3 * MAX_LINE_END_OFFSET_M &&
        straightLineM(files.matrix.places[ends.to], lineTo) > 3 * MAX_LINE_END_OFFSET_M
      );
    });
    expect(other, 'no stored pair is far enough from the longest line to try this').toBeDefined();
    const broken = copy();
    broken.polylines.polylines[other!.key] = files.polylines.polylines[line.key];

    const problems = only(broken);

    expect(problems.every((problem) => problem.subject === other!.key)).toBe(true);
    expect(problems.map((problem) => problem.check).filter((check) => check !== 'line-length')).toEqual(['line-ends']);
    expect(problems[0].what).toMatch(/starts \d+ m from .+ and ends \d+ m from .+; the limit is 300 m/);
  });

  it('a line shorter than the straight line between its two places fails, whatever its pair says', () => {
    // The pair whose places are farthest apart, and a straight line that stops 250 m short of each: both ends
    // pass the end check (300 m), but no road is 500 m shorter than the straight line.
    const { key, straightM, lengthM } = [...report.stats].sort((a, b) => b.straightM - a.straightM || (a.key < b.key ? -1 : 1))[0];
    const { from, to } = splitPairKey(key)!;
    const ends = [files.matrix.places[from], files.matrix.places[to]];
    expect(straightM).toBeGreaterThan(2_000);
    const cut = [pointAlong(ends, 250 / straightM), pointAlong(ends, 1 - 250 / straightM)];
    const broken = copy();
    broken.polylines.polylines[key] = encodePolyline(cut);
    // A pair that agrees with the cut line, so the 0.5 to 1.5 rule alone would let it through.
    broken.matrix.pairs[key].distanceM = Math.round(straightM - 500);

    const problems = only(broken);

    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([['line-length', key]]);
    expect(problems[0].what).toMatch(/is \d+ m long but its two places are \d+ m apart in a straight line, and a road cannot be shorter \(200 m is allowed for the two ends on the road\)$/);
    expect(failureMessage(problems)).toContain('npm run fetch:routes -- --refetch ');

    // The slack is for the snapped ends only: the real line of this pair is not near it.
    expect(lengthM).toBeGreaterThan(straightM);
    expect(LINE_STRAIGHT_SLACK_M).toBeLessThan(2 * MAX_LINE_END_OFFSET_M);
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
