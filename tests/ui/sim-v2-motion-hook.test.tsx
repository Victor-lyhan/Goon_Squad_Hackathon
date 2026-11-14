import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MapMover } from '../../client/src/components/map/types';
import type { LngLat, TweenClock } from '../../client/src/components/sim/v2/motion/routeTween';
import {
  MAX_TWEEN_MS, advanceMoverFrames, initialMoverFrames, moverFramePositions, useTweenedMovers,
} from '../../client/src/components/sim/v2/motion/useTweenedMovers';

const PATH: LngLat[] = [[-74.0, 40.7], [-74.0, 40.71], [-73.99, 40.71]];
const pathFor = () => PATH;
const v = (lat: number, lng: number): MapMover[] => [{ id: 'v1', kind: 'vehicle', label: 'Ana', lat, lng }];
const clock = (timeMin: number, over: Partial<TweenClock> = {}): TweenClock =>
  ({ runId: 'run-1', timeMin, playing: true, speed: 30, ...over });

describe('advanceMoverFrames (the pure step run during render)', () => {
  const first = initialMoverFrames(v(40.7, -74.0), clock(1000), 0);

  it('a normal poll starts a tween from the position on screen (alpha 0)', () => {
    const f = advanceMoverFrames(first, v(40.71, -73.99), clock(1030), pathFor, 1000, false);
    expect(f.tween).toBe(true);
    expect(f.alpha).toBe(0);
    expect(f.durationMs).toBe(1000);
    const [shown] = moverFramePositions(f, pathFor, false);
    expect([shown.lat, shown.lng]).toEqual([40.7, -74.0]);
  });

  it('an equal poll (new objects, same values) keeps the same state, so the tween is not restarted', () => {
    const f = advanceMoverFrames(first, v(40.71, -73.99), clock(1030), pathFor, 1000, false);
    const mid = { ...f, alpha: 0.5 };
    expect(advanceMoverFrames(mid, v(40.71, -73.99), clock(1030), pathFor, 1200, false)).toBe(mid);
  });

  it('a poll mid-tween continues from the point drawn now, never ahead of the newest poll', () => {
    const f = { ...advanceMoverFrames(first, v(40.71, -74.0), clock(1030), pathFor, 1000, false), alpha: 0.5 };
    const [drawn] = moverFramePositions(f, pathFor, false);
    const g = advanceMoverFrames(f, v(40.71, -73.99), clock(1060), pathFor, 2000, false);
    expect(g.prev[0].lat).toBeCloseTo(drawn.lat, 12);
    expect(g.prev[0].lng).toBeCloseTo(drawn.lng, 12);
    expect(g.alpha).toBe(0);
  });

  it('snaps on reduced motion, a seek, a pause and a run change', () => {
    const snaps = [
      advanceMoverFrames(first, v(40.71, -73.99), clock(1030), pathFor, 1000, true),
      advanceMoverFrames(first, v(40.71, -73.99), clock(1500), pathFor, 1000, false),
      advanceMoverFrames(first, v(40.71, -73.99), clock(1000, { playing: false }), pathFor, 1000, false),
      advanceMoverFrames(first, v(40.71, -73.99), clock(1030, { runId: 'run-2' }), pathFor, 1000, false),
    ];
    for (const f of snaps) {
      expect(f.tween).toBe(false);
      expect(f.alpha).toBe(1);
      expect(moverFramePositions(f, pathFor, false)[0]).toMatchObject({ lat: 40.71, lng: -73.99 });
    }
  });

  it('Play journey steps on a paused clock tween', () => {
    const paused = initialMoverFrames(v(40.7, -74.0), clock(1035, { playing: false }), 0);
    const f = advanceMoverFrames(paused, v(40.701, -74.0), clock(1039, { playing: false }), pathFor, 1000, false, { journey: true });
    expect(f.tween).toBe(true);
  });

  it('the tween length follows the real time between polls, within bounds', () => {
    const f = advanceMoverFrames(first, v(40.71, -73.99), clock(1030), pathFor, 60_000, false);
    expect(f.durationMs).toBe(MAX_TWEEN_MS);
  });
});

describe('useTweenedMovers', () => {
  it('renders the newest poll on the first render (no rAF on the server)', () => {
    function Probe() {
      const movers = useTweenedMovers(v(40.705, -74.0), clock(1000), pathFor);
      return <span>{movers.map((m) => `${m.id}@${m.lat},${m.lng}`).join(';')}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toBe('<span>v1@40.705,-74</span>');
  });
});
