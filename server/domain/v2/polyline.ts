/** Geographic point used by the v2 simulation without depending on v2 contracts. */
export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;

/**
 * Decodes a Google encoded polyline at its standard five-decimal precision.
 * Invalid/truncated input is rejected rather than silently placing a marker at
 * a misleading position.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const decodeValue = (): number => {
    let result = 0;
    let shift = 0;
    while (true) {
      if (index >= encoded.length) throw new Error('Invalid encoded polyline: truncated coordinate');
      const value = encoded.charCodeAt(index) - 63;
      index += 1;
      if (value < 0 || value > 63) throw new Error('Invalid encoded polyline: invalid character');
      result |= (value & 0x1f) << shift;
      shift += 5;
      if (value < 0x20) break;
      if (shift > 30) throw new Error('Invalid encoded polyline: coordinate is too large');
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += decodeValue();
    lng += decodeValue();
    points.push({ lat: lat / 100_000, lng: lng / 100_000 });
  }
  return points;
}

function encodeValue(value: number): string {
  let remaining = value < 0 ? ~(value << 1) : value << 1;
  let encoded = '';
  while (remaining >= 0x20) {
    encoded += String.fromCharCode((0x20 | (remaining & 0x1f)) + 63);
    remaining >>= 5;
  }
  return encoded + String.fromCharCode(remaining + 63);
}

/** Encodes points with Google's standard five-decimal polyline precision. */
export function encodePolyline(points: LatLng[]): string {
  let previousLat = 0;
  let previousLng = 0;
  let encoded = '';
  for (const point of points) {
    const lat = Math.round(point.lat * 100_000);
    const lng = Math.round(point.lng * 100_000);
    encoded += encodeValue(lat - previousLat);
    encoded += encodeValue(lng - previousLng);
    previousLat = lat;
    previousLng = lng;
  }
  return encoded;
}

function distanceM(from: LatLng, to: LatLng): number {
  const toRadians = Math.PI / 180;
  const deltaLat = (to.lat - from.lat) * toRadians;
  const deltaLng = (to.lng - from.lng) * toRadians;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(from.lat * toRadians) * Math.cos(to.lat * toRadians) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Haversine length of each consecutive segment in meters. */
export function pathLengthM(points: LatLng[]): number {
  return cumulativeM(points).at(-1) ?? 0;
}

/** Running haversine distances, starting with zero for the first point. */
export function cumulativeM(points: LatLng[]): number[] {
  const distances: number[] = [];
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) total += distanceM(points[index - 1]!, points[index]!);
    distances.push(total);
  }
  return distances;
}

function clampFraction(fraction: number): number {
  return Math.min(1, Math.max(0, fraction));
}

/** Returns a point at a length-weighted fraction along a path. */
export function pointAlong(points: LatLng[], fraction: number): LatLng {
  if (points.length === 0) throw new Error('Cannot find a point along an empty path');
  if (points.length === 1) return { ...points[0]! };
  return pointAlongCumulative(points, cumulativeM(points), fraction);
}

function pointAlongCumulative(points: LatLng[], cumulative: number[], fraction: number): LatLng {
  const total = cumulative[cumulative.length - 1]!;
  if (total === 0) return { ...points[0]! };

  const target = total * clampFraction(fraction);
  let low = 1;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulative[middle]! < target) low = middle + 1;
    else high = middle;
  }

  let index = low;
  while (index < points.length && cumulative[index]! === cumulative[index - 1]!) index += 1;
  if (index < points.length) {
    const start = cumulative[index - 1]!;
    const segmentFraction = (target - start) / (cumulative[index]! - start);
    const from = points[index - 1]!;
    const to = points[index]!;
    return {
      lat: from.lat + (to.lat - from.lat) * segmentFraction,
      lng: from.lng + (to.lng - from.lng) * segmentFraction,
    };
  }
  return { ...points[points.length - 1]! };
}

export type PositionBetweenInput = {
  encoded: string | null;
  from: LatLng;
  to: LatLng;
  departMin: number;
  arriveMin: number;
  timeMin: number;
};

// The simulation asks for many frames on the same route. This implementation
// cache is invisible to callers and avoids decoding the route for every frame.
type DecodedPath = { points: LatLng[]; cumulative: number[] };

const decodedPaths = new Map<string, DecodedPath>();

function decodedPath(encoded: string): DecodedPath {
  const cached = decodedPaths.get(encoded);
  if (cached !== undefined) return cached;
  const points = decodePolyline(encoded);
  const path = { points, cumulative: cumulativeM(points) };
  decodedPaths.set(encoded, path);
  return path;
}

/**
 * Locates a vehicle during one travel leg. An uncached route has no geometry,
 * so it intentionally uses only a straight marker interpolation.
 */
export function positionBetween(input: PositionBetweenInput): LatLng {
  const { encoded, from, to, departMin, arriveMin, timeMin } = input;
  if (arriveMin <= departMin) return { ...to };

  const fraction = clampFraction((timeMin - departMin) / (arriveMin - departMin));
  if (encoded === null) {
    return {
      lat: from.lat + (to.lat - from.lat) * fraction,
      lng: from.lng + (to.lng - from.lng) * fraction,
    };
  }
  const path = decodedPath(encoded);
  if (path.points.length === 0) throw new Error('Cannot find a point along an empty path');
  if (path.points.length === 1) return { ...path.points[0]! };
  return pointAlongCumulative(path.points, path.cumulative, fraction);
}
