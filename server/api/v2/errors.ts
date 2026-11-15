// 503 bodies for MVP II (SPEC "MVP II" rule 2): a missing key or missing travel data is a clear error
// the UI can show. Travel times are never invented, and no message here can hold a key: every message
// is built from fixed text and place IDs, never from an upstream error message.
// Copy (#888): each text starts with one plain sentence a page can show. A setup error then names the
// command or the .env key for the person running the server; place IDs come only after that command.
import type express from 'express';
import type { TravelUnavailable } from '../../../shared/v2/api';
import { TravelDataMissingError } from '../../../shared/v2/types';
import { GoogleApiError, GoogleKeyMissingError } from '../../geo/googleClient';

export const TRAVEL_NOT_LOADED_MESSAGE =
  'NYC travel data is not loaded. Run npm run fetch:routes and commit fixtures/nyc/.';

export const GOOGLE_KEY_MISSING_MESSAGE =
  'The Google Maps server key is not set. Add GOOGLE_MAPS_SERVER_KEY to .env and restart the server.';
export const GOOGLE_UNAVAILABLE_MESSAGE = 'Google Maps is not answering right now, so try again in a moment.';

export function travelUnavailable(code: TravelUnavailable['code'], message: string): TravelUnavailable {
  return { error: message, code };
}

/** The 503 body for a travel error, or null if `err` is something else. */
export function travelErrorBody(err: unknown): TravelUnavailable | null {
  if (err instanceof TravelDataMissingError) {
    const what = err.what === 'polyline' ? 'route line' : 'travel time';
    return travelUnavailable(
      'travel_data_missing',
      `A ${what} is missing on this server. Run npm run fetch:routes and commit fixtures/nyc/ (${err.from} to ${err.to}).`,
    );
  }
  if (err instanceof GoogleKeyMissingError) {
    return travelUnavailable('google_key_missing', GOOGLE_KEY_MISSING_MESSAGE);
  }
  if (err instanceof GoogleApiError) {
    // Google's status code stays out of the text: a page shows this sentence as it is.
    return travelUnavailable('google_unavailable', GOOGLE_UNAVAILABLE_MESSAGE);
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
