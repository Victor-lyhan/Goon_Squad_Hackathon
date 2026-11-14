// The travel-cache report: what `fixtures/nyc/matrix.json` + `polylines.json` cover, and which of Google's numbers
// look wrong. `scripts/fetch-routes.ts` prints it, and a human reads it before committing `fixtures/nyc/`
// (SPEC "MVP II" human checkpoint), so a bad geocode is caught before the whole demo is matched on it.
// Report only: nothing here changes, estimates or fills in a travel time or a distance (SPEC "MVP II" rule 2).
// Pure: plain cache objects in, plain data and text lines out. No fs, no environment, no network, no logging.

import { pairKey } from '../../shared/v2/types';
import type { Home, LatLng, NetworkBusiness, PolylinesFile, TravelMatrixFile } from '../../shared/v2/types';

// ---------- Thresholds (each one is a rule of thumb for "a human should look at this") ----------

/** Bounding box of the five boroughs. It also holds a strip of New Jersey and Nassau, so the address check backs it up. */
export const NYC_BOX = { south: 40.4774, west: -74.2591, north: 40.9176, east: -73.7004 } as const;
/** Two businesses geocoded this close are the same point: the geocoder most likely fell back to a street or ZIP centre. */
export const SAME_POINT_M = 30;
/**
 * Google snaps both ends of a route to the nearest road, so a real route can be a little shorter than the line
 * between the two cached points. A driving distance is only "shorter than the straight line" beyond this slack.
 */
export const STRAIGHT_LINE_SLACK_M = 200;
/** Driving distance above this many times the straight line is flagged. */
export const MAX_DETOUR_RATIO = 6;
/** Implied average speed (distance / duration) outside this range is flagged. */
export const MIN_SPEED_KMH = 5;
export const MAX_SPEED_KMH = 110;
/** A → B and B → A durations that differ by more than this factor are flagged. */
export const MAX_ASYMMETRY_RATIO = 3;
/** No drive inside the five boroughs takes this long without traffic. */
export const MAX_DURATION_S = 3 * 60 * 60;
/** `formatCacheReport` lists at most this many lines per kind of problem, then "... and N more". */
export const MAX_LISTED = 20;

// ---------- Types ----------

/** An ordered place pair. A → B and B → A are different pairs. */
export interface PlacePair {
  from: string;
  to: string;
}

export interface CoverageSection<T> {
  /** How many the app needs. */
  needed: number;
  /** The needed ones the cache does not hold, de-duplicated, in code-unit order. */
  missing: T[];
}

export interface CoverageReport {
  /** Businesses with no coordinates in `matrix.places`. */
  businesses: CoverageSection<string>;
  /** Business → business, both directions, no self pairs. Sorted by `from`, then `to`. */
  businessPairs: CoverageSection<PlacePair>;
  /** Every home → business pair (sorted by home, then business), then every business → home pair. */
  homePairs: CoverageSection<PlacePair>;
  /** The requested polyline pairs (self pairs dropped). Sorted by `from`, then `to`. */
  polylines: CoverageSection<PlacePair>;
  /** Distinct homes that were checked. */
  homes: number;
}

export interface CoverageInput {
  matrix: TravelMatrixFile;
  polylines: PolylinesFile;
  businessIds: readonly string[];
  homes: readonly Pick<Home, 'id'>[];
  polylinePairs: readonly PlacePair[];
}

export type SanityLevel = 'error' | 'warn';

/** Every finding code, in the order `formatCacheReport` lists them. */
export const SANITY_CODES = [
  'outside-nyc',
  'address-not-new-york',
  'same-point',
  'non-positive',
  'shorter-than-straight-line',
  'too-long',
  'detour',
  'too-slow',
  'too-fast',
  'asymmetric',
] as const;
export type SanityCode = (typeof SANITY_CODES)[number];

/**
 * `error` = the value cannot be right (wrong place, impossible number): do not commit the cache.
 * `warn` = unusual but possible (one-way streets, a bridge detour): look at it.
 */
export const SANITY_LEVELS: Record<SanityCode, SanityLevel> = {
  'outside-nyc': 'error',
  'address-not-new-york': 'error',
  'same-point': 'error',
  'non-positive': 'error',
  'shorter-than-straight-line': 'error',
  'too-long': 'error',
  detour: 'warn',
  'too-slow': 'warn',
  'too-fast': 'warn',
  asymmetric: 'warn',
};

export interface SanityFinding {
  level: SanityLevel;
  code: SanityCode;
  /** One place for a place finding, `[from, to]` for a pair finding. */
  placeIds: string[];
  /** Uses business and neighborhood names; never coordinates. */
  message: string;
}

export type BusinessLabel = Pick<NetworkBusiness, 'id' | 'name' | 'neighborhood'>;

export interface SanityInput {
  matrix: TravelMatrixFile;
  businesses: readonly BusinessLabel[];
  homes: readonly Home[];
}

export interface FormatInput {
  coverage: CoverageReport;
  sanity: readonly SanityFinding[];
  /** Optional: lets missing places and pairs be shown by business name instead of ID. */
  businesses?: readonly BusinessLabel[];
  /** Optional: lets a home be shown with its neighborhood. */
  homes?: readonly Pick<Home, 'id' | 'neighborhood'>[];
  /** Lines listed per kind of problem. Default `MAX_LISTED`. */
  maxListed?: number;
}

// ---------- Small helpers ----------

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** De-duplicated, in code-unit order (not locale order, which can differ between machines). */
const sortedUnique = (ids: readonly string[]) => [...new Set(ids)].sort();

const isPoint = (value: unknown): value is LatLng =>
  typeof value === 'object' && value !== null && Number.isFinite((value as LatLng).lat) && Number.isFinite((value as LatLng).lng);

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle (haversine) distance in meters. Only ever compared against Google's numbers, never used in their place. */
export function straightLineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// A commute-editor home ID is `home-c-<lat>_<lng>` (shared/v2/types.ts), so the ID itself must not be printed.
const safeId = (id: string) => (id.startsWith('home-c-') ? 'home-c (entered address)' : id);

/** "Etsy (DUMBO)" for a business, "home-007 (Astoria)" for a home, the ID for anything else. Never coordinates. */
function placeLabeler(businesses: readonly BusinessLabel[], homes: readonly Pick<Home, 'id' | 'neighborhood'>[]) {
  const labels = new Map<string, string>();
  for (const home of homes) labels.set(home.id, `${safeId(home.id)} (${home.neighborhood})`);
  for (const business of businesses) labels.set(business.id, `${business.name} (${business.neighborhood})`);
  return (id: string) => labels.get(id) ?? safeId(id);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function fmtDistance(meters: unknown): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return 'no value';
  return Math.abs(meters) < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function fmtDuration(seconds: unknown): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'no value';
  if (Math.abs(seconds) < 120) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 120 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const fmtRatio = (ratio: number) => `${ratio.toFixed(1)}x`;

// ---------- Coverage ----------

/** What the app needs from the cache and what is not there. It only looks at what is present, never at the values. */
export function coverage(input: CoverageInput): CoverageReport {
  const { matrix, polylines } = input;
  const businessIds = sortedUnique(input.businessIds);
  const homeIds = sortedUnique(input.homes.map((home) => home.id));
  const hasPair = (from: string, to: string) => has(matrix.pairs, pairKey(from, to));

  const businessPairs: PlacePair[] = [];
  for (const from of businessIds) for (const to of businessIds) if (from !== to) businessPairs.push({ from, to });

  const homePairs: PlacePair[] = [];
  for (const home of homeIds) for (const business of businessIds) if (home !== business) homePairs.push({ from: home, to: business });
  for (const business of businessIds) for (const home of homeIds) if (home !== business) homePairs.push({ from: business, to: home });

  const wanted = new Map<string, PlacePair>();
  for (const { from, to } of input.polylinePairs) if (from !== to) wanted.set(pairKey(from, to), { from, to });
  const polylinePairs = [...wanted.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  const hasPolyline = ({ from, to }: PlacePair) => {
    const key = pairKey(from, to);
    return has(polylines.polylines, key) && typeof polylines.polylines[key] === 'string' && polylines.polylines[key] !== '';
  };

  return {
    businesses: {
      needed: businessIds.length,
      missing: businessIds.filter((id) => !(has(matrix.places, id) && isPoint(matrix.places[id]))),
    },
    businessPairs: { needed: businessPairs.length, missing: businessPairs.filter((pair) => !hasPair(pair.from, pair.to)) },
    homePairs: { needed: homePairs.length, missing: homePairs.filter((pair) => !hasPair(pair.from, pair.to)) },
    polylines: { needed: polylinePairs.length, missing: polylinePairs.filter((pair) => !hasPolyline(pair)) },
    homes: homeIds.length,
  };
}

// ---------- Sanity ----------

/** "too far north" etc. for a point outside the box, so the message needs no coordinates. Null when inside. */
function outsideBox(point: LatLng): string | null {
  const sides: string[] = [];
  if (point.lat > NYC_BOX.north) sides.push('north');
  if (point.lat < NYC_BOX.south) sides.push('south');
  if (point.lng > NYC_BOX.east) sides.push('east');
  if (point.lng < NYC_BOX.west) sides.push('west');
  return sides.length === 0 ? null : `too far ${sides.join(' and ')}`;
}

/** Google writes "..., New York, NY 10019, USA" or "..., Brooklyn, NY 11201, USA": the state code counts as a mention. */
const mentionsNewYork = (address: string) => /\bNew York\b/i.test(address) || /\bNY\b/.test(address);

/**
 * Checks every cached place and every cached pair. A pair is measured between the points the cache holds
 * (the ones Google routed between); a home that is not in `matrix.places` falls back to its own point.
 * Order: place findings by place ID, same-point findings, then pair findings by pair key.
 */
export function sanity(input: SanityInput): SanityFinding[] {
  const { matrix } = input;
  const label = placeLabeler(input.businesses, input.homes);
  const findings: SanityFinding[] = [];
  const add = (code: SanityCode, placeIds: string[], message: string) =>
    findings.push({ level: SANITY_LEVELS[code], code, placeIds, message });

  const points = new Map<string, LatLng>();
  for (const home of input.homes) if (isPoint(home)) points.set(home.id, { lat: home.lat, lng: home.lng });
  for (const id of Object.keys(matrix.places)) {
    const place = matrix.places[id];
    if (isPoint(place)) points.set(id, { lat: place.lat, lng: place.lng });
  }

  // Places: inside the five boroughs?
  for (const id of Object.keys(matrix.places).sort()) {
    const point = matrix.places[id];
    if (!isPoint(point)) continue; // coverage reports a business without coordinates
    const side = outsideBox(point);
    if (side) add('outside-nyc', [id], `${label(id)} is outside the five boroughs (${side})`);
  }

  // Businesses: did the geocoder land in New York, and on distinct points?
  const businessIds = sortedUnique(input.businesses.map((business) => business.id));
  for (const id of businessIds) {
    if (!has(matrix.places, id) || !isPoint(matrix.places[id])) continue;
    const address = matrix.places[id].formattedAddress;
    if (typeof address !== 'string' || address.trim() === '') {
      add('address-not-new-york', [id], `${label(id)} has no address from the geocoder, so it cannot be checked against New York`);
    } else if (!mentionsNewYork(address)) {
      add('address-not-new-york', [id], `${label(id)} was geocoded to "${address.trim()}", which does not mention New York`);
    }
  }
  for (let i = 0; i < businessIds.length; i++) {
    for (let j = i + 1; j < businessIds.length; j++) {
      const a = points.get(businessIds[i]);
      const b = points.get(businessIds[j]);
      if (!a || !b) continue;
      const apart = straightLineM(a, b);
      if (apart <= SAME_POINT_M) {
        add('same-point', [businessIds[i], businessIds[j]], `${label(businessIds[i])} and ${label(businessIds[j])} are geocoded to the same point (${fmtDistance(apart)} apart)`);
      }
    }
  }

  // Pairs: Google's numbers against each other and against the straight line.
  for (const key of Object.keys(matrix.pairs).sort()) {
    const cut = key.indexOf('|');
    if (cut < 0) continue;
    const from = key.slice(0, cut);
    const to = key.slice(cut + 1);
    if (from === to) continue;
    const route = `${label(from)} → ${label(to)}`;
    const value = matrix.pairs[key] as Partial<{ durationS: number; distanceM: number }> | null | undefined;
    const durationS = value?.durationS;
    const distanceM = value?.distanceM;

    if (typeof durationS !== 'number' || typeof distanceM !== 'number' || !(durationS > 0) || !(distanceM > 0)) {
      add('non-positive', [from, to], `${route} has no positive travel values (duration ${fmtDuration(durationS)}, distance ${fmtDistance(distanceM)})`);
      continue; // the checks below would divide by it
    }

    const a = points.get(from);
    const b = points.get(to);
    if (a && b) {
      const straight = straightLineM(a, b);
      if (distanceM + STRAIGHT_LINE_SLACK_M < straight) {
        add('shorter-than-straight-line', [from, to], `${route} is ${fmtDistance(distanceM)} by road but ${fmtDistance(straight)} in a straight line`);
      } else if (distanceM > MAX_DETOUR_RATIO * straight) {
        const ratio = straight > 0 ? ` (${fmtRatio(distanceM / straight)})` : '';
        add('detour', [from, to], `${route} is ${fmtDistance(distanceM)} by road for ${fmtDistance(straight)} in a straight line${ratio}`);
      }
    }

    if (durationS > MAX_DURATION_S) add('too-long', [from, to], `${route} takes ${fmtDuration(durationS)}`);

    const speedKmh = (distanceM / durationS) * 3.6;
    if (speedKmh < MIN_SPEED_KMH || speedKmh > MAX_SPEED_KMH) {
      add(speedKmh < MIN_SPEED_KMH ? 'too-slow' : 'too-fast', [from, to], `${route} averages ${Math.round(speedKmh)} km/h (${fmtDistance(distanceM)} in ${fmtDuration(durationS)})`);
    }

    // Once per unordered pair: only when this is the direction whose key sorts first.
    if (from < to && has(matrix.pairs, pairKey(to, from))) {
      const backS = (matrix.pairs[pairKey(to, from)] as { durationS?: number } | null)?.durationS;
      if (typeof backS === 'number' && backS > 0) {
        const ratio = Math.max(durationS, backS) / Math.min(durationS, backS);
        if (ratio > MAX_ASYMMETRY_RATIO) {
          add('asymmetric', [from, to], `${route} takes ${fmtDuration(durationS)} but the way back takes ${fmtDuration(backS)} (${fmtRatio(ratio)})`);
        }
      }
    }
  }

  return findings;
}

// ---------- Text ----------

// Belt and braces: the report prints names, IDs and one geocoder address, none of which should hold a key or a
// coordinate. Anything that looks like one anyway is removed from every line.
const KEY_LIKE = /AIza[0-9A-Za-z_-]{20,}|\bkey=[^\s&"']+/g;
const COORDINATE_LIKE = /-?\d{1,3}\.\d{4,}/g;
const scrub = (line: string) => line.replace(KEY_LIKE, '[redacted]').replace(COORDINATE_LIKE, '[coordinate]');

/** `lines` capped at `max`, with one "... and N more" line. */
function capped(lines: string[], max: number, what: string): string[] {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `... and ${lines.length - max} more ${what}`];
}

/**
 * The report as text lines: totals first, then errors (cache gaps the app would fail on + sanity errors), then
 * warnings (missing polylines, which only cost a drawn route line, + sanity warnings), then a one-line result.
 */
export function formatCacheReport(input: FormatInput): string[] {
  const { coverage: cov } = input;
  const label = placeLabeler(input.businesses ?? [], input.homes ?? []);
  const max = Math.max(1, input.maxListed ?? MAX_LISTED);
  const route = (pair: PlacePair) => `${label(pair.from)} → ${label(pair.to)}`;
  const total = (section: CoverageSection<unknown>) => {
    const missing = section.missing.length;
    return `${section.needed - missing} of ${section.needed}${missing > 0 ? ` (${missing} missing)` : ''}`;
  };

  const sanityErrors = input.sanity.filter((finding) => finding.level === 'error');
  const sanityWarnings = input.sanity.filter((finding) => finding.level !== 'error');
  const errorCount = cov.businesses.missing.length + cov.businessPairs.missing.length + cov.homePairs.missing.length + sanityErrors.length;
  const warningCount = cov.polylines.missing.length + sanityWarnings.length;

  /** Findings grouped by code in `SANITY_CODES` order, each group capped. */
  const findingLines = (findings: readonly SanityFinding[]) =>
    SANITY_CODES.flatMap((code) =>
      capped(
        findings.filter((finding) => finding.code === code).map((finding) => `  [${code}] ${finding.message}`),
        max,
        `[${code}]`,
      ),
    );

  const lines: string[] = [
    'Travel cache report',
    `  Businesses geocoded: ${total(cov.businesses)}`,
    `  Business → business pairs: ${total(cov.businessPairs)}`,
    `  Home ↔ business pairs (${plural(cov.homes, 'home')}): ${total(cov.homePairs)}`,
    `  Route polylines: ${total(cov.polylines)}`,
    `  Sanity checks: ${plural(sanityErrors.length, 'error')}, ${plural(sanityWarnings.length, 'warning')}`,
  ];

  lines.push(errorCount === 0 ? 'Errors: none' : `Errors (${errorCount})`);
  lines.push(...capped(cov.businesses.missing.map((id) => `  [not-geocoded] ${label(id)} has no geocoded place`), max, '[not-geocoded]'));
  lines.push(...capped(cov.businessPairs.missing.map((pair) => `  [missing-pair] ${route(pair)} has no travel time`), max, '[missing-pair] between businesses'));
  lines.push(...capped(cov.homePairs.missing.map((pair) => `  [missing-pair] ${route(pair)} has no travel time`), max, '[missing-pair] between homes and businesses'));
  lines.push(...findingLines(sanityErrors));

  lines.push(warningCount === 0 ? 'Warnings: none' : `Warnings (${warningCount})`);
  lines.push(...capped(cov.polylines.missing.map((pair) => `  [missing-polyline] ${route(pair)} has no route line`), max, '[missing-polyline]'));
  lines.push(...findingLines(sanityWarnings));

  if (errorCount > 0) lines.push(`Result: ${plural(errorCount, 'error')}. Fix the data or fetch again before committing fixtures/nyc/.`);
  else if (warningCount > 0) lines.push(`Result: no errors. Read the ${plural(warningCount, 'warning')} above before committing fixtures/nyc/.`);
  else lines.push('Result: the cache covers everything and nothing looks wrong.');

  return lines.map(scrub);
}
