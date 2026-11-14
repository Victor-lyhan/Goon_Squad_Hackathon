// GET /api/v2/geocode?q= : the employee address search (SPEC "MVP II" rules 1, 2 and 6).
// Built unregistered (DECISIONS pass 6); the /api/v2 mount passes `key` and `neighborhoodFor`.
//
// Privacy: this file never logs the query, a result label, a coordinate or the key. The only log line is the
// HTTP status and Google's status word when Google fails. Error bodies are fixed sentences.
//
// Time: the whole search has one deadline (`GEOCODE_DEADLINE_MS`), counted from the request, so the page gets
// this route's 503 before its own 8 s limit (DECISIONS pass 61). A deadline is a failure, never a guess.
import type { Request, Response } from 'express';
import type { GeocodeResponse, TravelUnavailable } from '../../shared/v2/api';
import { GeocodeQuery, type ApiError } from '../../shared/v2/schemas';
import type { Borough, Neighborhood } from '../../shared/v2/types';
import { GoogleApiError, GoogleKeyMissingError, geocodeAddress, type FetchLike, type GeocodeResult } from '../geo/googleClient';

/**
 * The five boroughs' extent: Google's own viewport for "New York, NY", rounded to 4 decimals.
 * South and west edges are Staten Island's, the north edge is the top of the Bronx, the east edge is the Queens/Nassau line.
 * A box also covers the Hudson shore of New Jersey, Mount Vernon, southern Yonkers and Nassau's Five Towns, so it is
 * only the second check: the first is the borough Google names (`boroughOf`).
 */
export const NYC_BOUNDS = { south: 40.4774, west: -74.2591, north: 40.9176, east: -73.7002 } as const;
export const MAX_GEOCODE_RESULTS = 5;
/** Added to a query that does not already end in New York, so "30th Ave, Astoria" is not matched in another state. */
export const NYC_SUFFIX = ', New York, NY';
/**
 * The whole search answers within this, counted from the request: the page gives up at 8 s (client/src/api/client.ts),
 * so it gets this route's 503 and not its own timeout. Given to the Google client as `msLeft`, like the live
 * limits of server/geo/travelService.ts.
 */
export const GEOCODE_DEADLINE_MS = 7_000;
/**
 * One address lookup may take this long per attempt. Two attempts and the client's 0.5 s backoff are 6.5 s, so a
 * silent Google is answered before the deadline and the retry gets as long as the first attempt.
 */
export const GEOCODE_TIMEOUT_MS = 3_000;
/** A search retries a failed Google call once (after the client's 0.5 s backoff), then answers 503. */
export const GEOCODE_MAX_RETRIES = 1;

export const KEY_MISSING_MESSAGE = 'Address search needs GOOGLE_MAPS_SERVER_KEY on the server.';
export const GOOGLE_UNAVAILABLE_MESSAGE = 'Address search is unavailable right now. Try again in a moment.';
const FAILED_MESSAGE = 'Address search failed.';

// The end of the query names New York: "..., New York, NY 10118, USA", "... NYC", "... ny".
const ENDS_IN_NEW_YORK =
  /(^|[\s,])(new york(\s+city)?|nyc|ny)(\s*,?\s*\d{5}(-\d{4})?)?(\s*,?\s*(usa|us|united states))?[\s,.]*$/i;
// Google's formatted addresses carry the state: "..., Brooklyn, NY 11201, USA".
const IN_NEW_YORK_STATE = /,\s*NY(\s|,|$)/;

// The five boroughs by the name of Google's `sublocality_level_1` address component ("Brooklyn", "The Bronx"),
// and by the name of its `administrative_area_level_2` component: each borough is one county of New York State.
const BOROUGH_BY_SUBLOCALITY: Record<string, Borough> = {
  manhattan: 'Manhattan',
  brooklyn: 'Brooklyn',
  queens: 'Queens',
  'the bronx': 'Bronx',
  bronx: 'Bronx',
  'staten island': 'Staten Island',
};
const BOROUGH_BY_COUNTY: Record<string, Borough> = {
  'new york county': 'Manhattan',
  'kings county': 'Brooklyn',
  'queens county': 'Queens',
  'bronx county': 'Bronx',
  'richmond county': 'Staten Island',
};

export interface GeocodeDeps {
  /** The server key, read per request (`serverKey` from server/geo/env.ts), or null when there is none. */
  key: () => string | null;
  /** Defaults to the real Google client. */
  geocode?: typeof geocodeAddress;
  /** Passed to the Google client; tests give a fake so nothing touches the network. */
  fetchImpl?: FetchLike;
  /** Neighborhood name for a point when Google gives none (see `nycNeighborhoodLookup`). */
  neighborhoodFor?: (lat: number, lng: number) => string | null;
  /** The clock of the deadline, in milliseconds. Defaults to `performance.now()`; tests give a virtual one. */
  now?: () => number;
  /** The Google client's backoff sleep. Defaults to a real timer; tests give a virtual one. */
  sleep?: (ms: number) => Promise<void>;
}

/** What is sent to Google: the query, with ", New York, NY" added unless it already ends in New York. */
export function withNycHint(q: string): string {
  const text = q.trim().replace(/[\s,]+$/, '');
  return ENDS_IN_NEW_YORK.test(text) ? text : text + NYC_SUFFIX;
}

export function insideNyc(lat: number, lng: number): boolean {
  return lat >= NYC_BOUNDS.south && lat <= NYC_BOUNDS.north && lng >= NYC_BOUNDS.west && lng <= NYC_BOUNDS.east;
}

/**
 * The borough Google places a result in, read from its address components, or null (Mount Vernon, Yonkers,
 * Nassau, New Jersey, or a result that names no borough at all).
 *
 * Google's Geocoding documentation gives Brooklyn as its example of a `sublocality_level_1` component, says
 * `administrative_area_level_2` is the county in the United States, and warns that any one component can be
 * missing: https://developers.google.com/maps/documentation/geocoding/requests-geocoding
 * So the borough's own component is read first and its county second. Names are matched whole, never as a part.
 */
export function boroughOf(item: Pick<GeocodeResult, 'sublocality' | 'county'>): Borough | null {
  const key = (name: string | null | undefined) => (name ?? '').trim().toLowerCase();
  const sublocality = key(item.sublocality);
  if (Object.hasOwn(BOROUGH_BY_SUBLOCALITY, sublocality)) return BOROUGH_BY_SUBLOCALITY[sublocality];
  const county = key(item.county);
  return Object.hasOwn(BOROUGH_BY_COUNTY, county) ? BOROUGH_BY_COUNTY[county] : null;
}

/** `(lat, lng) => name` of the first neighborhood box that contains the point, or null. */
export function nycNeighborhoodLookup(neighborhoods: Neighborhood[]): (lat: number, lng: number) => string | null {
  return (lat, lng) => {
    for (const { name, bbox } of neighborhoods) {
      if (lat >= bbox.south && lat <= bbox.north && lng >= bbox.west && lng <= bbox.east) return name;
    }
    return null;
  };
}

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

/** One safe line for the operator: numbers and Google's status word only (never a message, URL, query or key). */
function warnGoogleFailure(err: GoogleApiError): void {
  // Status 0: no HTTP answer at all (network failure, attempt timeout, or the deadline of the search).
  const answer = err.status === 0 ? 'no response' : `HTTP ${err.status}`;
  const status = err.googleStatus !== null && /^[A-Z_]{1,40}$/.test(err.googleStatus) ? ` ${err.googleStatus}` : '';
  console.warn(`[geocode] Google Geocoding failed: ${answer}${status}`);
}

export const getGeocode =
  (deps: GeocodeDeps) =>
  async (req: Request, res: Response<GeocodeResponse | ApiError | TravelUnavailable>): Promise<void> => {
    // Results hold street labels: keep them out of browser and proxy caches.
    res.set('Cache-Control', 'no-store');
    // No await between here and the Google call: the deadline starts with the request.
    const now = deps.now ?? (() => performance.now());
    const endMs = now() + GEOCODE_DEADLINE_MS;
    try {
      const parsed = GeocodeQuery.safeParse(req.query);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) fieldErrors[issue.path.join('.') || 'q'] ??= issue.message;
        res.status(400).json({ error: 'Invalid address search', fieldErrors });
        return;
      }

      const apiKey = deps.key()?.trim() ?? '';
      if (apiKey === '') {
        res.status(503).json({ error: KEY_MISSING_MESSAGE, code: 'google_key_missing' });
        return;
      }

      const found = await (deps.geocode ?? geocodeAddress)(withNycHint(parsed.data.q), {
        apiKey,
        fetchImpl: deps.fetchImpl,
        sleep: deps.sleep,
        timeoutMs: GEOCODE_TIMEOUT_MS,
        maxRetries: GEOCODE_MAX_RETRIES,
        msLeft: () => endMs - now(),
      });

      const results: GeocodeResponse['results'] = [];
      const seen = new Set<string>();
      for (const item of found) {
        if (results.length >= MAX_GEOCODE_RESULTS) break;
        const lat = round5(item.lat);
        const lng = round5(item.lng);
        const label = item.formattedAddress.trim();
        // A home is in one of the five boroughs (DECISIONS pass 61): Google must name the borough ...
        if (boroughOf(item) === null) continue;
        // ... and, as a second check, the point is in the city's box and the label in New York State.
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !insideNyc(lat, lng)) continue;
        if (label === '' || !IN_NEW_YORK_STATE.test(label)) continue;
        // A home must have a neighborhood label (SPEC MVP II rule 6), so a result without one is not offered.
        const neighborhood = (item.neighborhood ?? '').trim() || (deps.neighborhoodFor?.(lat, lng) ?? '').trim();
        if (neighborhood === '') continue;
        const id = `${label}|${lat}|${lng}`;
        if (seen.has(id)) continue;
        seen.add(id);
        results.push({ label, neighborhood, lat, lng });
      }
      res.json({ results });
    } catch (err) {
      // Never `next(err)` and never log `err` itself: Express's default handler prints the error, and an
      // unexpected one could carry the query.
      if (err instanceof GoogleKeyMissingError) {
        res.status(503).json({ error: KEY_MISSING_MESSAGE, code: 'google_key_missing' });
      } else if (err instanceof GoogleApiError) {
        warnGoogleFailure(err);
        res.status(503).json({ error: GOOGLE_UNAVAILABLE_MESSAGE, code: 'google_unavailable' });
      } else {
        res.status(500).json({ error: FAILED_MESSAGE });
      }
    }
  };
