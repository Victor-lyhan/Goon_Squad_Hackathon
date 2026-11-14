// Shared by the key-check tests: a fake FetchClient that records its calls, and Google errors as googleClient.ts builds them.
import type { FetchClient } from '../../server/geo/fetchRunner';
import { GEOCODE_URL, GoogleApiError, ROUTES_URL, ROUTE_MATRIX_URL } from '../../server/geo/googleClient';
import type { GeocodeResult, LatLng, RouteMatrixResult, RoutePolyline } from '../../server/geo/googleClient';

export const ADDRESS = '350 5th Ave, New York, NY 10118';
export const FROM: LatLng = { lat: 40.7484, lng: -73.9857 };
export const TO: LatLng = { lat: 40.7033, lng: -73.9881 };

export const GEOCODE_OK: GeocodeResult[] = [{ lat: 40.7484, lng: -73.9857, formattedAddress: '350 5th Ave, New York, NY 10118, USA', neighborhood: 'Midtown' }];
export const MATRIX_OK: RouteMatrixResult = { elements: [{ originIndex: 0, destinationIndex: 0, durationS: 734, distanceM: 6120 }], failures: [] };
export const ROUTE_OK: RoutePolyline = { encoded: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', durationS: 734, distanceM: 6120 };

export const ENDPOINT = { geocoding: GEOCODE_URL, route_matrix: ROUTE_MATRIX_URL, routes: ROUTES_URL } as const;
export type Api = keyof typeof ENDPOINT;
export const APIS: Api[] = ['geocoding', 'route_matrix', 'routes'];

export function googleError(api: Api, status: number, googleStatus: string | null, message: string): GoogleApiError {
  return new GoogleApiError({ status, googleStatus, endpoint: ENDPOINT[api], message });
}

export type Call =
  | { fn: 'geocodeAddress'; address: string }
  | { fn: 'computeRouteMatrix'; origins: LatLng[]; destinations: LatLng[] }
  | { fn: 'computeRoutePolyline'; origin: LatLng; destination: LatLng };

type Answer<T> = T | (() => T);

/** Answers every call with a good result unless a test gives another answer; a function answer may throw. */
export function fakeClient(answers: { geocoding?: Answer<GeocodeResult[]>; route_matrix?: Answer<RouteMatrixResult>; routes?: Answer<RoutePolyline> } = {}) {
  const calls: Call[] = [];
  const give = <T>(answer: Answer<T> | undefined, fallback: T): T =>
    answer === undefined ? fallback : typeof answer === 'function' ? (answer as () => T)() : answer;
  const client: FetchClient = {
    async geocodeAddress(address) {
      calls.push({ fn: 'geocodeAddress', address });
      return give(answers.geocoding, GEOCODE_OK);
    },
    async computeRouteMatrix(origins, destinations) {
      calls.push({ fn: 'computeRouteMatrix', origins, destinations });
      return give(answers.route_matrix, MATRIX_OK);
    },
    async computeRoutePolyline(origin, destination) {
      calls.push({ fn: 'computeRoutePolyline', origin, destination });
      return give(answers.routes, ROUTE_OK);
    },
  };
  return { client, calls };
}

/** A client where the one call of `api` throws `err` and the other two work. */
export function failing(api: Api, err: unknown) {
  return fakeClient({
    [api]: () => {
      throw err;
    },
  });
}
