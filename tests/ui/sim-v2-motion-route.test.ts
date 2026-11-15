import { describe, expect, it } from 'vitest';
import type { MapMover } from '../../client/src/components/map/types';
import {
  shouldSnapV2, tweenMovers, tweenPoint, type LngLat, type TweenClock,
} from '../../client/src/components/sim/v2/motion/routeTween';
import { JOURNEY_COMMUTE_STEP_MIN, JOURNEY_STEP_MS } from '../../client/src/components/sim/v2/motion/journeyPlayback';

// L-shaped route in Lower Manhattan: north along one street, then east.
const CORNER: LngLat = [-74.0, 40.71];
const L_PATH: LngLat[] = [[-74.0, 40.7], CORNER, [-73.99, 40.71]];
const START = { lng: -74.0, lat: 40.7 };
const END = { lng: -73.99, lat: 40.71 };

const vehicle = (id: string, p: { lat: number; lng: number }): MapMover => ({ id, kind: 'vehicle', label: id, ...p });
const pkg = (id: string, p: { lat: number; lng: number }): MapMover => ({ id, kind: 'package', label: id, ...p });

/** Meters from a point to a polyline (flat plane; fine for these tiny distances). */
function distToPath(p: { lat: number; lng: number }, path: LngLat[]): number {
  const kx = 111_320 * Math.cos((40.705 * Math.PI) / 180);
  const ky = 111_320;
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = [path[i][0] * kx, path[i][1] * ky];
    const [bx, by] = [path[i + 1][0] * kx, path[i + 1][1] * ky];
    const [px, py] = [p.lng * kx, p.lat * ky];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(ax + dx * t - px, ay + dy * t - py));
  }
  return best;
}

const pathOnly = (id: string) => (moverId: string) => (moverId === id ? L_PATH : null);

describe('tweenMovers along a route line', () => {
  const prev = [vehicle('v1', START)];
  const next = [vehicle('v1', END)];

  it('alpha 0.5 lies on the L-shaped path, not on the diagonal', () => {
    const [m] = tweenMovers({ prev, next, alpha: 0.5, pathFor: pathOnly('v1'), reducedMotion: false });
    expect(distToPath(m, L_PATH)).toBeLessThan(0.01);
    const diagonal: LngLat[] = [[START.lng, START.lat], [END.lng, END.lat]];
    expect(distToPath(m, diagonal)).toBeGreaterThan(100);
    // Half the length (≈ 1113 m north + 844 m east) is still on the first, northbound street.
    expect(m.lng).toBeCloseTo(-74.0, 9);
    expect(m.lat).toBeGreaterThan(40.7);
    expect(m.lat).toBeLessThan(40.71);
  });

  it('every alpha stays on the path', () => {
    for (let a = 0; a <= 1; a += 0.05) {
      const [m] = tweenMovers({ prev, next, alpha: a, pathFor: pathOnly('v1'), reducedMotion: false });
      expect(distToPath(m, L_PATH)).toBeLessThan(0.01);
    }
  });

  it('alpha 0 and 1 are the polled points', () => {
    const at0 = tweenMovers({ prev, next, alpha: 0, pathFor: pathOnly('v1'), reducedMotion: false })[0];
    const at1 = tweenMovers({ prev, next, alpha: 1, pathFor: pathOnly('v1'), reducedMotion: false })[0];
    expect([at0.lat, at0.lng]).toEqual([START.lat, START.lng]);
    expect([at1.lat, at1.lng]).toEqual([END.lat, END.lng]);
  });

  it('polled points slightly off the line still return exactly at alpha 0 and 1', () => {
    const a = { lat: 40.7 + 1e-6, lng: -74.0 + 2e-6 };
    const b = { lat: 40.71 - 1e-6, lng: -73.99 };
    expect(tweenPoint(a, b, 0, L_PATH)).toEqual(a);
    expect(tweenPoint(a, b, 1, L_PATH)).toEqual(b);
    expect(distToPath(tweenPoint(a, b, 0.5, L_PATH), L_PATH)).toBeLessThan(1);
  });

  it('never extrapolates: alpha is clamped to 0..1', () => {
    const over = tweenMovers({ prev, next, alpha: 1.7, pathFor: pathOnly('v1'), reducedMotion: false })[0];
    const under = tweenMovers({ prev, next, alpha: -3, pathFor: pathOnly('v1'), reducedMotion: false })[0];
    expect([over.lat, over.lng]).toEqual([END.lat, END.lng]);
    expect([under.lat, under.lng]).toEqual([START.lat, START.lng]);
  });

  it('no path: the straight-line midpoint', () => {
    const [m] = tweenMovers({ prev, next, alpha: 0.5, pathFor: () => null, reducedMotion: false });
    expect(m.lat).toBeCloseTo(40.705, 12);
    expect(m.lng).toBeCloseTo(-73.995, 12);
  });

  it('a path the mover is not on (> 100 m away) falls back to the straight line', () => {
    const far: LngLat[] = [[-73.95, 40.75], [-73.94, 40.76]];
    const [m] = tweenMovers({ prev, next, alpha: 0.5, pathFor: () => far, reducedMotion: false });
    expect(m.lat).toBeCloseTo(40.705, 12);
    expect(m.lng).toBeCloseTo(-73.995, 12);
  });

  it('a vehicle stopped for handling stays put', () => {
    const [m] = tweenMovers({ prev: next, next, alpha: 0.4, pathFor: pathOnly('v1'), reducedMotion: false });
    expect([m.lat, m.lng]).toEqual([END.lat, END.lng]);
  });
});

describe('tweenMovers snap rules per mover', () => {
  it('reduced motion draws the newest poll', () => {
    const out = tweenMovers({ prev: [vehicle('v1', START)], next: [vehicle('v1', END)], alpha: 0.5, pathFor: pathOnly('v1'), reducedMotion: true });
    expect([out[0].lat, out[0].lng]).toEqual([END.lat, END.lng]);
  });

  it('a new mover appears where it is; a gone mover is not drawn', () => {
    const out = tweenMovers({
      prev: [vehicle('gone', START)],
      next: [vehicle('fresh', END)],
      alpha: 0.3, pathFor: () => L_PATH, reducedMotion: false,
    });
    expect(out.map((m) => m.id)).toEqual(['fresh']);
    expect([out[0].lat, out[0].lng]).toEqual([END.lat, END.lng]);
  });

  it('keeps the order and labels of the newest poll', () => {
    const out = tweenMovers({
      prev: [pkg('p1', START), vehicle('v1', START)],
      next: [vehicle('v1', END), pkg('p1', END)],
      alpha: 0.5, pathFor: () => null, reducedMotion: false,
    });
    expect(out.map((m) => `${m.kind}:${m.id}`)).toEqual(['vehicle:v1', 'package:p1']);
  });
});

describe('a package glued to its carrier', () => {
  it('stays exactly on the vehicle in every frame, even when only the vehicle has a path', () => {
    const prev = [vehicle('v1', START), pkg('p1', START)];
    const next = [vehicle('v1', END), pkg('p1', END)];
    for (let a = 0; a <= 1; a += 0.1) {
      const out = tweenMovers({ prev, next, alpha: a, pathFor: pathOnly('v1'), reducedMotion: false });
      const v = out.find((m) => m.id === 'v1')!;
      const p = out.find((m) => m.id === 'p1')!;
      expect([p.lat, p.lng]).toEqual([v.lat, v.lng]);
    }
  });

  it('a package waiting at the pickup does not jump onto the arriving vehicle', () => {
    const prev = [vehicle('v1', START), pkg('p1', END)];
    const next = [vehicle('v1', END), pkg('p1', END)];
    const out = tweenMovers({ prev, next, alpha: 0.5, pathFor: pathOnly('v1'), reducedMotion: false });
    const p = out.find((m) => m.id === 'p1')!;
    expect([p.lat, p.lng]).toEqual([END.lat, END.lng]);
  });
});

describe('shouldSnapV2', () => {
  const at = (timeMin: number, over: Partial<TweenClock> = {}): TweenClock =>
    ({ runId: 'run-1', timeMin, playing: true, speed: 30, ...over });

  it('a normal poll while playing tweens', () => {
    expect(shouldSnapV2(at(1000), at(1030), 1000)).toBe(false);
    expect(shouldSnapV2(at(1000), at(1600), 1000, false)).toBe(true); // 600 min in 1 s at speed 30
    expect(shouldSnapV2(at(1000, { speed: 600 }), at(1600, { speed: 600 }), 1000)).toBe(false);
  });

  it('snaps when the run changed', () => {
    expect(shouldSnapV2(at(1000), at(1030, { runId: 'run-2' }), 1000)).toBe(true);
  });

  it('snaps when the clock is paused', () => {
    expect(shouldSnapV2(at(1000), at(1000, { playing: false }), 1000)).toBe(true);
    expect(shouldSnapV2(at(1000, { playing: false }), at(1030, { playing: false }), 1000)).toBe(true);
  });

  it('snaps when time went backwards (rewind, reset)', () => {
    expect(shouldSnapV2(at(1030), at(1029), 1000)).toBe(true);
  });

  it('snaps on a seek or jump larger than a normal poll at the current speed', () => {
    expect(shouldSnapV2(at(1000), at(1061), 1000)).toBe(true);
    expect(shouldSnapV2(at(1000), at(1900), 1000)).toBe(true);
  });

  it('Play journey: small seek steps on a paused clock tween, the jumps over gaps snap', () => {
    const paused = (t: number) => at(t, { playing: false });
    expect(shouldSnapV2(paused(1035), paused(1039), 1000, true)).toBe(false);
    expect(shouldSnapV2(paused(1080), paused(1905), 1000, true)).toBe(true);
    expect(shouldSnapV2(paused(930), paused(1035), 1000, true)).toBe(true);
    expect(shouldSnapV2(paused(1039), paused(1035), 1000, true)).toBe(true);
    expect(shouldSnapV2(paused(1035), at(1039, { playing: false, runId: 'run-2' }), 1000, true)).toBe(true);
  });

  it('Play journey: the larger steps of a commute without the package (#761) tween too, at any step timing', () => {
    const paused = (t: number) => at(t, { playing: false });
    for (const elapsedMs of [0, 100, JOURNEY_STEP_MS, 2 * JOURNEY_STEP_MS, 3 * JOURNEY_STEP_MS]) {
      // One step, and the steps that fit in that time when the page drew none of them in between.
      const steps = Math.max(1, Math.ceil(elapsedMs / JOURNEY_STEP_MS));
      expect(shouldSnapV2(paused(1056), paused(1056 + JOURNEY_COMMUTE_STEP_MIN), elapsedMs, true)).toBe(false);
      expect(shouldSnapV2(paused(1056), paused(1056 + steps * JOURNEY_COMMUTE_STEP_MIN), elapsedMs, true)).toBe(false);
    }
    // The night is still a jump.
    expect(shouldSnapV2(paused(1079), paused(1939), 1000, true)).toBe(true);
  });
});

describe('performance', () => {
  // A route of n points (a long Google polyline) zig-zagging north through Manhattan.
  const zigzag = (n: number): LngLat[] => Array.from({ length: n }, (_, i) => [-74.0 + (i % 2) * 0.0005, 40.7 + i * 0.0003]);
  const short = zigzag(40);
  const long = zigzag(400);

  /** 5,000 tweens on `path`; the polled points sit on the first 7/8 of it, 1/8 of its length apart. */
  const run = (path: LngLat[]) => {
    const pathFor = () => path;
    const span = (path.length * 3) / 4;
    const gap = path.length / 8;
    let sink = 0;
    for (let i = 0; i < 5000; i++) {
      const a = path[(i * 7) % span];
      const b = path[((i * 7) % span) + gap];
      const out = tweenMovers({
        prev: [vehicle('v1', { lng: a[0], lat: a[1] })],
        next: [vehicle('v1', { lng: b[0], lat: b[1] })],
        alpha: (i % 100) / 100, pathFor, reducedMotion: false,
      });
      sink += out[0].lat;
    }
    return sink;
  };
  const time = (path: LngLat[]) => {
    const t0 = performance.now();
    expect(run(path)).toBeGreaterThan(0);
    return performance.now() - t0;
  };

  // A wall-clock limit only catches an order-of-magnitude slowdown (DECISIONS pass 52): CI runners
  // are 1.5x–3.5x slower than a laptop and a busy parallel run adds more. Measured on an M-series
  // laptop: 62–65 ms with this file alone, 68–161 ms inside the full parallel `vitest run`.
  // Limit = 10x the slowest of those. The scaling check below is the one that does not depend on the machine.
  // Best of three timed runs, so one GC pause does not count.
  it('5,000 calls on a 400-point path take under 1,600 ms (order-of-magnitude check only)', { timeout: 15_000 }, () => {
    const LIMIT_MS = 1600;
    run(long); // warm-up (JIT), not measured
    const best = Math.min(time(long), time(long), time(long));
    expect(best).toBeLessThan(LIMIT_MS);
  });

  // Same machine, same moment: the ratio cancels out how fast the runner is. Each call projects two
  // points onto the path, which is linear in its length, plus a fixed per-call cost (Maps, objects),
  // so 10x the points costs a little under 10x the time. Measured ratio (400 / 40 points, best of
  // three each, M-series laptop): 8.65–8.76 with this file alone (≈ 7 ms vs ≈ 60 ms), 8.72–9.30 inside
  // the full parallel `vitest run`. Bound = 28, 3x the highest. A change that makes the cost grow faster
  // than the path length (e.g. a projection that is quadratic in the points) gives a ratio near 100 on
  // any runner.
  it('the cost grows no faster than the path length (40 vs 400 points, same test)', { timeout: 15_000 }, () => {
    const MAX_RATIO = 28;
    run(short); run(long); // warm-up (JIT), not measured
    let bestShort = Infinity;
    let bestLong = Infinity;
    // Interleaved, so a burst of load from another test file hits both sizes alike.
    for (let k = 0; k < 3; k++) {
      bestShort = Math.min(bestShort, time(short));
      bestLong = Math.min(bestLong, time(long));
    }
    expect(bestLong / bestShort).toBeLessThan(MAX_RATIO);
  });
});
