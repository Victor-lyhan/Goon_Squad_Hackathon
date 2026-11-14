// 503 bodies for MVP II (SPEC "MVP II" rule 2): a missing key or missing travel data is a clear error
// the UI can show. Travel times are never invented, and no message here can hold a key: every message
// is built from fixed text, place IDs and Google's status code, never from an upstream error message.
import type express from 'express';
import type { TravelUnavailable } from '../../../shared/v2/api';
import { TravelDataMissingError } from '../../../shared/v2/types';
import { GoogleApiError, GoogleKeyMissingError } from '../../geo/googleClient';

export const TRAVEL_NOT_LOADED_MESSAGE =
  'NYC travel data is not loaded. Run npm run fetch:routes and commit fixtures/nyc/.';

export function travelUnavailable(code: TravelUnavailable['code'], message: string): TravelUnavailable {
  return { error: message, code };
}

/** The 503 body for a travel error, or null if `err` is something else. */
export function travelErrorBody(err: unknown): TravelUnavailable | null {
  if (err instanceof TravelDataMissingError) {
    const what = err.what === 'polyline' ? 'route line' : 'travel time';
    return travelUnavailable(
      'travel_data_missing',
      `No ${what} is cached for ${err.from} to ${err.to}. Run npm run fetch:routes and commit fixtures/nyc/.`,
    );
  }
  if (err instanceof GoogleKeyMissingError) {
    return travelUnavailable(
      'google_key_missing',
      'The Google Maps server key is not set. Add GOOGLE_MAPS_SERVER_KEY to .env and restart the server.',
    );
  }
  if (err instanceof GoogleApiError) {
    const detail = err.status === 0 ? 'no response' : `HTTP ${err.status}`;
    return travelUnavailable('google_unavailable', `Google Maps is unavailable right now (${detail}). Try again in a moment.`);
  }
  return null;
}

/** Answers 503 TravelUnavailable and returns true for a travel error; returns false (nothing sent) otherwise. */
export function sendTravelError(res: express.Response, err: unknown): boolean {
  const body = travelErrorBody(err);
  if (!body) return false;
  res.status(503).json(body);
  return true;
}
