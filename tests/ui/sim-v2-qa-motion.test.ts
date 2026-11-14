// #479: under prefers-reduced-motion: reduce the map movers snap to each poll instead of tweening.
// The tween maths is not touched here; this only pins the reduced-motion path of useTweenedMovers.
// (The CSS side, no animation or transition under reduced motion, is in sim-v2-qa-css.test.ts.)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MapMover } from '../../client/src/components/map/types';
import { REDUCED_MOTION_QUERY } from '../../client/src/components/sim/v2/motion/motionMath';
import type { LngLat, TweenClock } from '../../client/src/components/sim/v2/motion/routeTween';
import {
  advanceMoverFrames, initialMoverFrames, moverFramePositions,
} from '../../client/src/components/sim/v2/motion/useTweenedMovers';

const PATH: LngLat[] = [[-74.0, 40.7], [-74.0, 40.71], [-73.99, 40.71]];
const pathFor = () => PATH;
const v = (lat: number, lng: number): MapMover[] => [{ id: 'v1', kind: 'vehicle', label: 'Ana', lat, lng }];
const clock = (timeMin: number, over: Partial<TweenClock> = {}): TweenClock =>
  ({ runId: 'run-1', timeMin, playing: true, speed: 30, ...over });

describe('reduced motion: movers snap', () => {
  const first = initialMoverFrames(v(40.7, -74.0), clock(1000), 0);

  it('listens to the standard media query', () => {
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });

  it('a normal poll that would tween snaps instead (no rAF loop: tween false, alpha 1)', () => {
    expect(advanceMoverFrames(first, v(40.71, -73.99), clock(1030), pathFor, 1000, false).tween).toBe(true);
    const f = advanceMoverFrames(first, v(40.71, -73.99), clock(1030), pathFor, 1000, true);
    expect(f.tween).toBe(false);
    expect(f.alpha).toBe(1);
    expect(moverFramePositions(f, pathFor, true)).toEqual(v(40.71, -73.99));
  });

  it('Play journey steps snap too', () => {
    const paused = initialMoverFrames(v(40.7, -74.0), clock(1035, { playing: false }), 0);
    const f = advanceMoverFrames(paused, v(40.701, -74.0), clock(1039, { playing: false }), pathFor, 1000, true, { journey: true });
    expect(f.tween).toBe(false);
    expect(f.alpha).toBe(1);
  });

  it('a frame caught mid-tween is drawn at the newest poll, never in between', () => {
    const mid = { ...advanceMoverFrames(first, v(40.71, -73.99), clock(1030), pathFor, 1000, false), alpha: 0.5 };
    const [between] = moverFramePositions(mid, pathFor, false);
    expect([between.lat, between.lng]).not.toEqual([40.71, -73.99]);
    expect(moverFramePositions(mid, pathFor, true)).toEqual(v(40.71, -73.99));
  });

  it('the hook feeds the media query into both the frame step and the drawn positions', () => {
    const src = readFileSync(resolve(__dirname, '../../client/src/components/sim/v2/motion/useTweenedMovers.ts'), 'utf8');
    expect(src).toMatch(/matchMedia\(REDUCED_MOTION_QUERY\)/);
    expect(src).toMatch(/advanceMoverFrames\([^)]*reducedMotion/);
    expect(src).toMatch(/frames\.tween && !reducedMotion/);
    expect(src).toMatch(/return moverFramePositions\(frames, pathFor, reducedMotion\)/);
  });
});
