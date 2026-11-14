// GET /api/v2/geocode?q= : the employee address search (SPEC "MVP II" rules 1, 2 and 6).
// Built unregistered (DECISIONS pass 6); the /api/v2 mount passes `key` and `neighborhoodFor`.
//
// Privacy: this file never logs the query, a result label or the key. The only log line is the HTTP status and
// Google's status word when Google fails. Error bodies are fixed sentences.
import type { Request, Response } from 'express';
import type { GeocodeResponse, TravelUnavailable } from '../../shared/v2/api';
import { GeocodeQuery, type ApiError } from '../../shared/v2/schemas';
import type { Neighborhood } from '../../shared/v2/types';
import { GoogleApiError, GoogleKeyMissingError, geocodeAddress, type FetchLike } from '../geo/googleClient';

/**
 * The five boroughs' extent: Google's own viewport for "New York, NY", rounded to 4 decimals.
 * South and west edges are Staten Island's, the north edge is the top of the Bronx, the east edge is the Queens/Nassau line.
 * A box also covers the Hudson shore of New Jersey, so results must name New York State as well (`IN_NEW_YORK_STATE`).
 */
export const NYC_BOUNDS = { south: 40.4774, west: -74.2591, north: 40.9176, east: -73.7002 } as const;
export const MAX_GEOCODE_RESULTS = 5;
/** Added to a query that does not already end in New York, so "30th Ave, Astoria" is not matched in another state. */
export const NYC_SUFFIX = ', New York, NY';
/** One address lookup may take this long per attempt (the client default of 15 s is too long for a search box). */
export const GEOCODE_TIMEOUT_MS = 5_000;
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

export interface GeocodeDeps {
  /** The server key, read per request (`serverKey` from server/geo/env.ts), or null when there is none. */
  key: () => string | null;
  /** Defaults to the real Google client. */
  geocode?: typeof geocodeAddress;
  /** Passed to the Google client; tests give a fake so nothing touches the network. */
  fetchImpl?: FetchLike;
  /** Neighborhood name for a point when Google gives none (see `nycNeighborhoodLookup`). */
  neighborhoodFor?: (lat: number, lng: number) => string | null;
}

/** What is sent to Google: the query, with ", New York, NY" added unless it already ends in New York. */
export function withNycHint(q: string): string {
  const text = q.trim().replace(/[\s,]+$/, '');
  return ENDS_IN_NEW_YORK.test(text) ? text : text + NYC_SUFFIX;
}

export function insideNyc(lat: number, lng: number): boolean {
  return lat >= NYC_BOUNDS.south && lat <= NYC_BOUNDS.north && lng >= NYC_BOUNDS.west && lng <= NYC_BOUNDS.east;
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

/** Thrown out of the Google client's backoff sleep to stop its retries once the search's budget is used. */
class RetriesSpent extends Error {}

function retrySleep(): (ms: number) => Promise<void> {
  let retries = 0;
  return (ms) => {
    retries += 1;
    if (retries > GEOCODE_MAX_RETRIES) return Promise.reject(new RetriesSpent());
    return new Promise((resolve) => setTimeout(resolve, ms));
  };
}

/** One safe line for the operator: numbers and Google's status word only (never a message, URL, query or key). */
function warnGoogleFailure(err: unknown): void {
  if (err instanceof GoogleApiError) {
    const status = err.googleStatus !== null && /^[A-Z_]{1,40}$/.test(err.googleStatus) ? ` ${err.googleStatus}` : '';
    console.warn(`[geocode] Google Geocoding failed: HTTP ${err.status}${status}`);
  } else {
    console.warn('[geocode] Google Geocoding failed after a retry');
  }
}

export const getGeocode =
  (deps: GeocodeDeps) =>
  async (req: Request, res: Response<GeocodeResponse | ApiError | TravelUnavailable>): Promise<void> => {
    // Results hold street labels: keep them out of browser and proxy caches.
    res.set('Cache-Control', 'no-store');
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
        timeoutMs: GEOCODE_TIMEOUT_MS,
        sleep: retrySleep(),
      });

      const results: GeocodeResponse['results'] = [];
      const seen = new Set<string>();
      for (const item of found) {
        if (results.length >= MAX_GEOCODE_RESULTS) break;
        const lat = round5(item.lat);
        const lng = round5(item.lng);
        const label = item.formattedAddress.trim();
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
      } else if (err instanceof GoogleApiError || err instanceof RetriesSpent) {
        warnGoogleFailure(err);
        res.status(503).json({ error: GOOGLE_UNAVAILABLE_MESSAGE, code: 'google_unavailable' });
      } else {
        res.status(500).json({ error: FAILED_MESSAGE });
      }
    }
  };
