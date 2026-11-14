// Shared by tests/geo/nyc-cache-committed-*.test.ts: the committed Google cache (fixtures/nyc/matrix.json and
// polylines.json) read once, the places the fixtures say it must hold, and the checks as pure functions.
// The checks return a list of problems and never throw, so the same function runs on the committed files (the
// guard) and on a broken copy in memory (the proof that the guard bites). Nothing here writes a file, changes a
// number or fills one in (SPEC "MVP II" rule 2), and nothing here needs the network or a key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairKey } from '../../shared/v2/types';
import type { Home, LatLng, NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile } from '../../shared/v2/types';
import { generateHomePool } from '../../server/domain/v2/generator';
import { decodePolyline, pathLengthM } from '../../server/domain/v2/polyline';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { dropPlaces, hideEnteredIds } from '../../server/geo/cacheEdit';
import { NYC_BOX, STRAIGHT_LINE_SLACK_M, straightLineM } from '../../server/geo/cacheReport';
import { refetchCommand } from '../../server/geo/fetchScript';

/**
 * Explicit per-test limit, set at the top of each file with `vi.setConfig` (DECISIONS pass 17 and 19).
 * Reading and checking the whole cache takes about 50 ms locally, so this is a guard, not a need (pass 52: at
 * least 10x the local measurement).
 */
export const COMMITTED_CACHE_TEST_TIMEOUT_MS = 10_000;

// ---------- Limits for a stored route line (issue #498) ----------

/** A route line starts and ends on the road next to its place: Google snaps both ends to the nearest road. */
export const MAX_LINE_END_OFFSET_M = 300;
/**
 * The line's own length against the pair's `distanceM`. The two come from different Google calls (the route
 * matrix and computeRoutes), which usually pick the same road (when this was written, 262 of the 263 committed
 * lines were within 0.95x to 1.16x) but not always: for one committed pair the matrix says 20.6 km and the
 * line is 12.7 km (0.62x), about what the matrix says for the way back (13.5 km). That line joins its two
 * places and is 1.37 times the straight line between them, so it is a real route and the lower limit is 0.5
 * (issue #554, DECISIONS pass 58; it was 0.7). The simulation moves a marker along the line in proportion to
 * the pair's travel time, so a short line changes the marker's speed and no time, status or price.
 */
export const MIN_LINE_LENGTH_RATIO = 0.5;
export const MAX_LINE_LENGTH_RATIO = 1.5;
/** A line under this ratio passes, but the printed report lists it with both directions' `distanceM`. */
export const LISTED_LINE_LENGTH_RATIO = 0.7;
/**
 * The second half of the length rule: a line is not shorter than the straight line between its two places.
 * Both ends are snapped to the road, so a real line can be a few meters short of the line between the two
 * cached points (two committed lines are 8 m short, with ends 28 m and 40 m off their places). "Shorter" is
 * therefore the cache report's meaning for a driving distance: shorter by more than `STRAIGHT_LINE_SLACK_M`.
 */
export const LINE_STRAIGHT_SLACK_M = STRAIGHT_LINE_SLACK_M;

/** A failure message lists at most this many problems, then "... and N more". */
export const MAX_LISTED_PROBLEMS = 20;

// ---------- The committed files and what the fixtures expect of them ----------

export const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/nyc');

function readFixtureText(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

export interface Expected {
  businessIds: string[];
  /** `home-001` … `home-120`, from the generator's fixed seed. */
  poolHomes: Home[];
  /** The featured employees' homes of demoStory.json, each ID once. */
  storyHomes: Home[];
  /** Pool first, then story: every home the fetch caches against all businesses, each ID once. */
  homes: Home[];
  /** Every `home-story-*` ID that appears anywhere in the text of demoStory.json, sorted. */
  storyHomeIdsInText: string[];
}

/** What the fixtures say the cache must hold. Reads businesses.json, neighborhoods.json and demoStory.json. */
export function loadExpected(): Expected {
  const businessesFile = JSON.parse(readFixtureText('businesses.json')) as NycBusinessesFile;
  const neighborhoodsFile = JSON.parse(readFixtureText('neighborhoods.json')) as NycNeighborhoodsFile;
  const storyText = readFixtureText('demoStory.json');
  const storyFile = JSON.parse(storyText) as NycDemoStoryFile;

  const poolHomes = generateHomePool(neighborhoodsFile.neighborhoods);
  // The same rule as the fetch command: an ID is one home, and the pool's point wins if a story home reuses it.
  const byId = new Map<string, Home>(poolHomes.map((home) => [home.id, home]));
  const storyHomes: Home[] = [];
  for (const { home } of storyFile.featuredEmployees) {
    if (byId.has(home.id)) continue;
    byId.set(home.id, home);
    storyHomes.push(home);
  }
  return {
    businessIds: businessesFile.businesses.map((business) => business.id),
    poolHomes,
    storyHomes,
    homes: [...byId.values()],
    storyHomeIdsInText: [...new Set(storyText.match(/home-story-[a-z0-9-]+/g) ?? [])].sort(),
  };
}

/**
 * The committed cache, through the reader the server uses (it rejects a wrong `schemaVersion` or shape).
 * A missing matrix.json throws: the whole NYC demo reads it, so "no cache" is a failure here, not a skip.
 */
export function loadCommittedCache(): TravelFiles {
  const files = readTravelFiles(fixturesDir);
  if (files === null) {
    throw new Error(
      `fixtures/nyc/${MATRIX_FILE} is not there. The NYC demo reads it and cannot start without it. ` +
        'Restore it from git (`git checkout main -- fixtures/nyc/`); only a human run of `npm run fetch:routes` creates it.',
    );
  }
  return files;
}

/** True when polylines.json is on disk. A cache without it is legal (no route line is drawn), but worth printing. */
export const polylinesFileExists = () => fs.existsSync(path.join(fixturesDir, POLYLINES_FILE));

// ---------- Problems ----------

export type MatrixCheck = 'place-missing' | 'home-moved' | 'outside-box' | 'pair-missing' | 'pair-value';
export type LineCheck = 'line-pair' | 'line-decode' | 'line-outside-box' | 'line-ends' | 'line-length';

export interface Problem<Check extends string = string> {
  check: Check;
  /** The place ID or the pair key the problem is about. */
  subject: string;
  /** One sentence. Place IDs, meters and counts only: no coordinates. */
  what: string;
  /**
   * The places a human drops and fetches again with `--refetch`. Empty when a plain `npm run fetch:routes` is
   * the fix: the gap is something missing, and `--refetch` refuses an ID the cache holds nothing for.
   */
  refetch: string[];
}

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);
const isHomeId = (id: string) => id.startsWith('home-');
const meters = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)} m`;

const insideBox = (point: LatLng) =>
  point.lat >= NYC_BOX.south && point.lat <= NYC_BOX.north && point.lng >= NYC_BOX.west && point.lng <= NYC_BOX.east;

/** `from|to` split at the first `|`, or null when the key is not a pair key. */
export function splitPairKey(key: string): { from: string; to: string } | null {
  const cut = key.indexOf('|');
  if (cut <= 0 || cut === key.length - 1) return null;
  return { from: key.slice(0, cut), to: key.slice(cut + 1) };
}

/**
 * The end of a pair to drop when the pair itself is wrong. A home costs 36 matrix pairs to fetch again and a
 * business 294, so the home end goes first; between two businesses it is the origin.
 */
const endToRefetch = (from: string, to: string) => (isHomeId(from) ? from : isHomeId(to) ? to : from);

// ---------- Places ----------

/**
 * Every business and every home is in `matrix.places`, inside the NYC box, and each home is exactly where the
 * fixtures put it. The cache is keyed by place ID (DECISIONS pass 46), so a home that moved after the fetch
 * still has the old point's travel times. A business cannot be compared: businesses.json holds no coordinates.
 */
export function placeProblems(files: TravelFiles, expected: Pick<Expected, 'businessIds' | 'homes'>): Problem<MatrixCheck>[] {
  const { places } = files.matrix;
  const problems: Problem<MatrixCheck>[] = [];
  const check = (id: string, home: Home | null) => {
    if (!has(places, id)) {
      // Leftover pairs or lines of a place whose `places` entry is gone are stale, and `--refetch` clears them.
      const leftovers = dropPlaces(files, [id]).dropped.length > 0;
      problems.push({
        check: 'place-missing',
        subject: id,
        what: leftovers
          ? `${id} is not in matrix.json "places", but pairs or route lines of it still are`
          : `${id} is not in matrix.json "places"`,
        refetch: leftovers ? [id] : [],
      });
      return;
    }
    const cached = places[id];
    if (!insideBox(cached)) {
      problems.push({ check: 'outside-box', subject: id, what: `${id} is cached at a point outside the NYC box`, refetch: [id] });
    }
    if (home !== null && (cached.lat !== home.lat || cached.lng !== home.lng)) {
      problems.push({
        check: 'home-moved',
        subject: id,
        what: `${id} is cached ${meters(straightLineM(cached, home))} from where the fixtures put it, so its travel times are for the old point`,
        refetch: [id],
      });
    }
  };
  for (const id of expected.businessIds) check(id, null);
  for (const home of expected.homes) check(home.id, home);
  return problems;
}

// ---------- Pairs ----------

/** Every ordered pair the app needs: home → business and business → home for every home, then business ↔ business. */
export function neededPairs(expected: Pick<Expected, 'businessIds' | 'homes'>): { from: string; to: string }[] {
  const pairs: { from: string; to: string }[] = [];
  for (const home of expected.homes) {
    for (const business of expected.businessIds) {
      pairs.push({ from: home.id, to: business });
      pairs.push({ from: business, to: home.id });
    }
  }
  for (const from of expected.businessIds) for (const to of expected.businessIds) if (from !== to) pairs.push({ from, to });
  return pairs;
}

const isPositive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Every needed pair is in `matrix.pairs` with a positive `durationS` and `distanceM`. */
export function pairProblems(files: TravelFiles, expected: Pick<Expected, 'businessIds' | 'homes'>): Problem<MatrixCheck>[] {
  const { pairs } = files.matrix;
  const problems: Problem<MatrixCheck>[] = [];
  for (const { from, to } of neededPairs(expected)) {
    const key = pairKey(from, to);
    if (!has(pairs, key)) {
      problems.push({ check: 'pair-missing', subject: key, what: `${from} → ${to} has no travel time`, refetch: [] });
      continue;
    }
    const value = pairs[key] as { durationS?: unknown; distanceM?: unknown } | null;
    if (!isPositive(value?.durationS) || !isPositive(value?.distanceM)) {
      problems.push({
        check: 'pair-value',
        subject: key,
        what: `${from} → ${to} has durationS ${String(value?.durationS)} and distanceM ${String(value?.distanceM)}; both must be above 0`,
        refetch: [endToRefetch(from, to)],
      });
    }
  }
  return problems;
}

export interface CacheCounts {
  places: number;
  businesses: number;
  poolHomes: number;
  storyHomes: number;
  /** Places the fixtures do not list, for example a home entered in the commute editor. Legal. */
  otherPlaces: number;
  pairs: number;
  homePairs: number;
  businessPairs: number;
  otherPairs: number;
  lines: number;
}

/** What the cache holds, split by what the fixtures ask for. Counts only what is present. */
export function cacheCounts(files: TravelFiles, expected: Expected): CacheCounts {
  const { places, pairs } = files.matrix;
  const present = (ids: readonly string[]) => ids.filter((id) => has(places, id)).length;
  const businesses = present(expected.businessIds);
  const poolHomes = present(expected.poolHomes.map((home) => home.id));
  const storyHomes = present(expected.storyHomes.map((home) => home.id));
  const needed = neededPairs(expected);
  const homePairCount = expected.homes.length * expected.businessIds.length * 2;
  const held = (list: readonly { from: string; to: string }[]) => list.filter(({ from, to }) => has(pairs, pairKey(from, to))).length;
  const homePairs = held(needed.slice(0, homePairCount));
  const businessPairs = held(needed.slice(homePairCount));
  const placeTotal = Object.keys(places).length;
  const pairTotal = Object.keys(pairs).length;
  return {
    places: placeTotal,
    businesses,
    poolHomes,
    storyHomes,
    otherPlaces: placeTotal - businesses - poolHomes - storyHomes,
    pairs: pairTotal,
    homePairs,
    businessPairs,
    otherPairs: pairTotal - homePairs - businessPairs,
    lines: Object.keys(files.polylines.polylines).length,
  };
}

export function formatCounts(counts: CacheCounts): string {
  return (
    `NYC travel cache (committed): ${counts.places} places ` +
    `(${counts.businesses} businesses, ${counts.poolHomes} pool homes, ${counts.storyHomes} story homes, ${counts.otherPlaces} other), ` +
    `${counts.pairs} pairs (${counts.homePairs} home ↔ business, ${counts.businessPairs} business ↔ business, ${counts.otherPairs} other), ` +
    `${counts.lines} route lines`
  );
}

// ---------- Route lines ----------

export interface LineStat {
  key: string;
  points: number;
  /** First point to the origin's cached point, in meters. */
  startM: number;
  /** Last point to the destination's cached point, in meters. */
  endM: number;
  /** The line's own length in meters. */
  lengthM: number;
  /** The pair's `distanceM`. */
  distanceM: number;
  /** `lengthM / distanceM`. */
  ratio: number;
  /** The straight line between the two cached places, in meters. */
  straightM: number;
  /** `distanceM` of the pair the other way round, or null when the matrix does not hold it. */
  reverseDistanceM: number | null;
}

export interface LineReport {
  problems: Problem<LineCheck>[];
  /** One row per line that has a pair, both places and at least 2 decoded points: the measured ones. */
  stats: LineStat[];
}

/**
 * Checks every stored route line and no other pair: which pairs have a line is not this check's business
 * (a pair without a line is legal, DECISIONS pass 44). A line is measured against the points `matrix.places`
 * holds, the ones Google routed between, with the decoder the simulation moves its markers with.
 */
export function lineReport(files: TravelFiles): LineReport {
  const { places, pairs } = files.matrix;
  const problems: Problem<LineCheck>[] = [];
  const stats: LineStat[] = [];

  for (const key of Object.keys(files.polylines.polylines).sort()) {
    const ends = splitPairKey(key);
    if (ends === null) {
      problems.push({ check: 'line-pair', subject: key, what: `route line key "${key}" is not "<from>|<to>"`, refetch: [] });
      continue;
    }
    const { from, to } = ends;
    const drop = [endToRefetch(from, to)];
    const route = `route line ${from} → ${to}`;

    const pair = has(pairs, key) ? pairs[key] : null;
    const missingPlaces = [from, to].filter((id) => !has(places, id));
    if (pair === null || missingPlaces.length > 0) {
      const reasons = [
        ...(pair === null ? ['its pair is not in matrix.json "pairs"'] : []),
        ...missingPlaces.map((id) => `${id} is not in matrix.json "places"`),
      ];
      problems.push({ check: 'line-pair', subject: key, what: `${route}: ${reasons.join(' and ')}`, refetch: drop });
      continue;
    }

    let points: LatLng[];
    try {
      points = decodePolyline(files.polylines.polylines[key]);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      problems.push({ check: 'line-decode', subject: key, what: `${route} does not decode (${reason})`, refetch: drop });
      continue;
    }
    if (points.length < 2) {
      problems.push({ check: 'line-decode', subject: key, what: `${route} decodes to ${points.length} point(s); a line needs at least 2`, refetch: drop });
      continue;
    }

    const outside = points.filter((point) => !insideBox(point)).length;
    if (outside > 0) {
      problems.push({ check: 'line-outside-box', subject: key, what: `${route} has ${outside} of ${points.length} points outside the NYC box`, refetch: drop });
    }

    const startM = straightLineM(points[0], places[from]);
    const endM = straightLineM(points[points.length - 1], places[to]);
    if (startM > MAX_LINE_END_OFFSET_M || endM > MAX_LINE_END_OFFSET_M) {
      problems.push({
        check: 'line-ends',
        subject: key,
        what: `${route} starts ${meters(startM)} from ${from} and ends ${meters(endM)} from ${to}; the limit is ${MAX_LINE_END_OFFSET_M} m`,
        refetch: drop,
      });
    }

    const lengthM = pathLengthM(points);
    const ratio = lengthM / pair.distanceM;
    const straightM = straightLineM(places[from], places[to]);
    const reverseKey = pairKey(to, from);
    const reverse = has(pairs, reverseKey) ? (pairs[reverseKey] as { distanceM?: unknown } | null) : null;
    const reverseDistanceM = typeof reverse?.distanceM === 'number' ? reverse.distanceM : null;
    // One problem per line, with every reason. `!(a && b)` and not `a || b`: a NaN (a pair with no usable
    // distance) must count as a problem.
    const reasons: string[] = [];
    if (!(lengthM + LINE_STRAIGHT_SLACK_M >= straightM)) {
      reasons.push(
        `its two places are ${meters(straightM)} apart in a straight line, and a road cannot be shorter ` +
          `(${LINE_STRAIGHT_SLACK_M} m is allowed for the two ends on the road)`,
      );
    }
    if (!(ratio >= MIN_LINE_LENGTH_RATIO && ratio <= MAX_LINE_LENGTH_RATIO)) {
      reasons.push(
        `the pair's distanceM is ${String(pair.distanceM)} (${ratio.toFixed(2)}x; allowed ${MIN_LINE_LENGTH_RATIO} to ${MAX_LINE_LENGTH_RATIO}` +
          `${reverseDistanceM === null ? '' : `; the way back's distanceM is ${reverseDistanceM}`})`,
      );
    }
    if (reasons.length > 0) {
      problems.push({ check: 'line-length', subject: key, what: `${route} is ${meters(lengthM)} long but ${reasons.join(', and ')}`, refetch: drop });
    }

    stats.push({ key, points: points.length, startM, endM, lengthM, distanceM: pair.distanceM, ratio, straightM, reverseDistanceM });
  }
  return { problems, stats };
}

/**
 * The lines closest to each limit, as text lines: what a human looks at first when a limit is ever crossed.
 * Then every line that passes under `LISTED_LINE_LENGTH_RATIO`, with both directions' `distanceM` and the
 * straight line: the lines where Google's matrix and its route line took different roads. A measured line is
 * never under an entered home's ID in the committed cache (its own guard test), and if one ever is, the ID is
 * not printed here: it holds the coordinates.
 */
export function formatLineOutliers(stats: readonly LineStat[], listed = 3): string[] {
  if (stats.length === 0) return ['Route lines: none stored, so there is nothing to measure.'];
  const byKey = (a: LineStat, b: LineStat) => (a.key < b.key ? -1 : 1);
  const top = (score: (stat: LineStat) => number) => [...stats].sort((a, b) => score(b) - score(a) || byKey(a, b)).slice(0, listed);
  const length = (stat: LineStat) => `${stat.key}  ${stat.ratio.toFixed(3)}x  (line ${Math.round(stat.lengthM)} m, distanceM ${stat.distanceM})`;
  const short = stats.filter((stat) => stat.ratio < LISTED_LINE_LENGTH_RATIO).sort((a, b) => a.ratio - b.ratio || byKey(a, b));
  const shortRows = short.slice(0, MAX_LISTED_PROBLEMS).map(
    (stat) =>
      `    ${stat.key}  ${stat.ratio.toFixed(3)}x  (line ${Math.round(stat.lengthM)} m, distanceM ${stat.distanceM}, ` +
      `the way back's distanceM ${stat.reverseDistanceM ?? 'not cached'}, straight line ${Math.round(stat.straightM)} m)`,
  );
  if (short.length > MAX_LISTED_PROBLEMS) shortRows.push(`    ... and ${short.length - MAX_LISTED_PROBLEMS} more`);
  const lines = [
    `Route lines: ${stats.length} measured. Closest to each limit:`,
    `  farthest end from its place (limit ${MAX_LINE_END_OFFSET_M} m):`,
    ...top((stat) => Math.max(stat.startM, stat.endM)).map((stat) => `    ${stat.key}  start ${meters(stat.startM)}, end ${meters(stat.endM)}`),
    `  longest against distanceM (limit ${MAX_LINE_LENGTH_RATIO}x):`,
    ...top((stat) => stat.ratio).map((stat) => `    ${length(stat)}`),
    `  shortest against distanceM (limit ${MIN_LINE_LENGTH_RATIO}x):`,
    ...top((stat) => -stat.ratio).map((stat) => `    ${length(stat)}`),
    `  shortest against the straight line between its two places (limit: the straight line less ${LINE_STRAIGHT_SLACK_M} m):`,
    ...top((stat) => stat.straightM - stat.lengthM).map((stat) => `    ${stat.key}  line ${Math.round(stat.lengthM)} m, straight line ${Math.round(stat.straightM)} m`),
    '  fewest points (limit 2):',
    ...top((stat) => -stat.points).map((stat) => `    ${stat.key}  ${stat.points} points`),
    short.length === 0
      ? `  under ${LISTED_LINE_LENGTH_RATIO}x of distanceM (these pass; the limit is ${MIN_LINE_LENGTH_RATIO}x): none`
      : `  under ${LISTED_LINE_LENGTH_RATIO}x of distanceM (these pass; the limit is ${MIN_LINE_LENGTH_RATIO}x): ${short.length}. ` +
        "Google's matrix and its route line took different roads:",
    ...shortRows,
  ];
  return lines.map(hideEnteredIds);
}

// ---------- The failure message ----------

/**
 * What a red test prints: the problems (capped), then the exact command for the human. With any place to drop
 * the command is `npm run fetch:routes -- --refetch <placeId>...`; it runs the normal fetch after the drop, so
 * it also fills whatever is only missing. With nothing to drop it is the plain run. Empty string for no problem.
 */
export function failureMessage(problems: readonly Problem[]): string {
  if (problems.length === 0) return '';
  const listed = problems.slice(0, MAX_LISTED_PROBLEMS).map((problem) => `  - ${problem.what}`);
  if (problems.length > MAX_LISTED_PROBLEMS) listed.push(`  ... and ${problems.length - MAX_LISTED_PROBLEMS} more`);
  const drop = [...new Set(problems.flatMap((problem) => problem.refetch))].sort();
  const fix =
    drop.length > 0
      ? [
          `Do not edit fixtures/nyc/ by hand. A human with the Google key drops ${drop.length === 1 ? 'this place' : 'these places'} and fetches again:`,
          `  ${refetchCommand(drop)}`,
        ]
      : [
          'Do not edit fixtures/nyc/ by hand. Nothing is stale, something is missing, so a human with the Google key runs the plain fetch (it skips what is cached):',
          '  npm run fetch:routes',
        ];
  // The empty last line keeps what vitest appends (": expected [...] to deeply equal []") off the command line.
  return [`The committed NYC travel cache (fixtures/nyc/) has ${problems.length} problem${problems.length === 1 ? '' : 's'}:`, ...listed, ...fix, ''].join('\n');
}

/** The problems of one check. */
export const ofCheck = <Check extends string>(problems: readonly Problem<Check>[], ...checks: Check[]) =>
  problems.filter((problem) => checks.includes(problem.check));
