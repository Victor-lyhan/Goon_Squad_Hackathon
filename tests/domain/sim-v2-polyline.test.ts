import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  cumulativeM,
  decodePolyline,
  encodePolyline,
  pathLengthM,
  pointAlong,
  positionBetween,
  type LatLng,
} from '../../server/domain/v2/polyline';

const NYC_PATH: LatLng[] = Array.from({ length: 300 }, (_, index) => ({
  lat: 40.68 + index * 0.00035 + Math.sin(index / 7) * 0.00004,
  lng: -74.03 + index * 0.0003 + Math.cos(index / 9) * 0.00004,
}));
const NYC_POLYLINE = encodePolyline(NYC_PATH);

describe('v2 polyline geometry', () => {
  it('decodes Google’s documented polyline and round-trips five-decimal points', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);

    const source = NYC_PATH.slice(0, 200);
    expect(decodePolyline(encodePolyline(source))).toEqual(source.map((point) => ({
      lat: Number(point.lat.toFixed(5)), lng: Number(point.lng.toFixed(5)),
    })));
  }, 10_000);

  it('measures paths and follows their segments rather than their chord', () => {
    const lShape = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }];
    const middle = pointAlong(lShape, 0.5);
    expect(middle.lat).toBeCloseTo(0, 8);
    expect(middle.lng).toBeCloseTo(1, 8);
    expect(pathLengthM(lShape)).toBeCloseTo(cumulativeM(lShape)[2]!, 8);
    expect(() => pointAlong([], 0.5)).toThrow('empty path');
    expect(pointAlong([{ lat: 1, lng: 2 }], 0.3)).toEqual({ lat: 1, lng: 2 });
    expect(pointAlong([{ lat: 1, lng: 2 }, { lat: 1, lng: 2 }], 0.5)).toEqual({ lat: 1, lng: 2 });
  }, 10_000);

  it('clamps travel time, moves monotonically, and falls back to a straight marker line', () => {
    const encoded = encodePolyline([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }]);
    const input = { encoded, from: { lat: 0, lng: 0 }, to: { lat: 1, lng: 1 }, departMin: 10, arriveMin: 20 };
    expect(positionBetween({ ...input, timeMin: 5 })).toEqual({ lat: 0, lng: 0 });
    expect(positionBetween({ ...input, timeMin: 20 })).toEqual({ lat: 1, lng: 1 });
    expect(positionBetween({ ...input, timeMin: 25 })).toEqual({ lat: 1, lng: 1 });
    expect(positionBetween({ ...input, arriveMin: 10, timeMin: 10 })).toEqual({ lat: 1, lng: 1 });

    const travelled = [10, 12, 14, 16, 18, 20].map((timeMin) => pathLengthM([
      input.from, positionBetween({ ...input, timeMin }),
    ]));
    for (let index = 1; index < travelled.length; index += 1) {
      expect(travelled[index]!).toBeGreaterThanOrEqual(travelled[index - 1]!);
    }

    expect(positionBetween({ ...input, encoded: null, timeMin: 15 })).toEqual({ lat: 0.5, lng: 0.5 });
  }, 10_000);

  it('serves 10,000 cached-polyline positions within the animation budget', () => {
    const input = {
      encoded: NYC_POLYLINE,
      from: NYC_PATH[0]!,
      to: NYC_PATH[NYC_PATH.length - 1]!,
      departMin: 900,
      arriveMin: 1_200,
    };
    positionBetween({ ...input, timeMin: 900 }); // Populate the decode memo before measuring frames.
    const startedAt = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      positionBetween({ ...input, timeMin: 900 + (index % 301) });
    }
    const elapsedMs = performance.now() - startedAt;

    // Measured locally at under 30 ms; 100 ms leaves more than 3x headroom.
    expect(elapsedMs).toBeLessThan(100);
  }, 10_000);
});
