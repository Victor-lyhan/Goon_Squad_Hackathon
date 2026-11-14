// #496: the map's movers between polls on the simulator page. Each mover slides along the decoded
// route line of its leg (moverPaths.ts) through useTweenedMovers' frame step; never ahead of the
// newest poll; snaps on a seek, a pause, a run change and under reduced motion; the straight line
// through the leg's places when a leg has no cached line (#553). Play journey's 2-minute steps tween, its jumps over gaps snap.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MapResponse } from '../../shared/v2/api';
import type { MapMover } from '../../client/src/components/map/types';
import { buildMoverLines, legLine, pathForMovers } from '../../client/src/components/sim/v2/compose/moverPaths';
import type { LngLat, TweenClock } from '../../client/src/components/sim/v2/motion/routeTween';
import {
  advanceMoverFrames, initialMoverFrames, moverFramePositions,
} from '../../client/src/components/sim/v2/motion/useTweenedMovers';
import { COORD, decoded, map, plans } from './sim-v2-journey-sample';

const lines = buildMoverLines(plans, map);
const ll = (id: string): LngLat => [COORD[id][1], COORD[id][0]];

/** Distance in metres from a point to a polyline (flat plane, fine at this scale). */
function distToPath(p: { lat: number; lng: number }, path: LngLat[]): number {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 111_320;
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = [path[i][0] * kx, path[i][1] * ky];
    const [bx, by] = [path[i + 1][0] * kx, path[i + 1][1] * ky];
    const [x, y] = [p.lng * kx, p.lat * ky];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}

describe('the route line of each mover (moverPaths)', () => {
  it("a vehicle's line is its leg's decoded polylines, place pair by place pair", () => {
    const path = pathForMovers(lines, 1050)('emp-3');
    expect(path).toEqual([...decoded('biz-dumbo', 'biz-roast'), ...decoded('biz-roast', 'home-007').slice(1)]);
  });

  it('a pair with no cached line is the straight line between its places (pass 44)', () => {
    const path = pathForMovers(lines, 1960)('emp-2');
    expect(path).toEqual([...decoded('home-story-ben', 'biz-roast'), ll('biz-etsy')]);
  });

  it("a package follows the leg that carries it: leg 1 in the evening, leg 2 after it", () => {
    const at = (t: number) => pathForMovers(lines, t)('shp-2');
    expect(at(1050)).toBe(pathForMovers(lines, 1050)('emp-3'));
    expect(at(1960)).toBe(pathForMovers(lines, 1960)('emp-2'));
    expect(at(2100)).toBe(pathForMovers(lines, 1960)('emp-2')); // after the last leg: the last line
  });

  it('a leg with no cached line at all: the straight line through its places in order (#553)', () => {
    const bare: MapResponse = { ...map, polylines: [] };
    expect(legLine(plans[0].legs[0], bare)).toEqual(plans[0].legs[0].placeIds.map(ll));
    // The relay leg passes through its stop: start, relay point, end.
    expect(pathForMovers(buildMoverLines(plans, bare), 1050)('emp-3'))
      .toEqual([ll('biz-dumbo'), ll('biz-roast'), ll('home-007')]);
    // Every line encoded as null (the server knows the pair, Google's line is not there yet): the same.
    const nulls: MapResponse = { ...map, polylines: map.polylines.map((p) => ({ ...p, encoded: null })) };
    expect(legLine(plans[0].legs[0], nulls)).toEqual(legLine(plans[0].legs[0], bare));
  });

  it('a leg with a place that has no coordinates, or a mover on no leg: null (the straight line between polls)', () => {
    const noHome: MapResponse = { ...map, polylines: [], homes: map.homes.filter((h) => h.id !== 'home-007') };
    expect(legLine(plans.find((p) => p.shipmentId === 'shp-2')!.legs[0], noHome)).toBeNull();
    expect(pathForMovers(buildMoverLines(plans, noHome), 1050)('emp-3')).toBeNull();
    expect(pathForMovers(lines, 1050)('emp-9')).toBeNull();
    expect(buildMoverLines(plans, null).size).toBe(0);
  });

  it('the same line object for every poll, so the tween keeps its per-path cache', () => {
    expect(pathForMovers(lines, 1050)('emp-3')).toBe(pathForMovers(lines, 1052)('emp-3'));
  });
});

describe('tween between two polls on the page', () => {
  const leg = pathForMovers(lines, 1050)('emp-3')!;
  // Two points on leg 1's line, as two polls 2 simulated minutes apart would place the carrier.
  const a = { lng: leg[1][0], lat: leg[1][1] };
  const b = { lng: leg[3][0], lat: leg[3][1] };
  const v = (p: { lat: number; lng: number }): MapMover[] => [{ id: 'emp-3', kind: 'vehicle', label: 'Cy Lam', ...p }];
  const clock = (timeMin: number, over: Partial<TweenClock> = {}): TweenClock =>
    ({ runId: 'run-1', timeMin, playing: false, speed: 120, ...over });
  const pathFor = (t: number) => pathForMovers(lines, t);
  const start = initialMoverFrames(v(a), clock(1048), 0);

  it('a Play journey step (2 minutes, paused clock) moves along the route line, not the straight line', () => {
    const f = advanceMoverFrames(start, v(b), clock(1050), pathFor(1050), 600, false, { journey: true });
    expect(f.tween).toBe(true);
    for (const alpha of [0.25, 0.5, 0.75]) {
      const [p] = moverFramePositions({ ...f, alpha }, pathFor(1050), false);
      expect(distToPath(p, leg)).toBeLessThan(1);
    }
    // The straight midpoint is off the line (the sample's polyline bends), so the line was used.
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    expect(distToPath(mid, leg)).toBeGreaterThan(5);
  });

  it('never ahead of the newest poll: alpha is clamped, and 1 is exactly the polled point', () => {
    const f = advanceMoverFrames(start, v(b), clock(1050), pathFor(1050), 600, false, { journey: true });
    expect(moverFramePositions({ ...f, alpha: 1 }, pathFor(1050), false)).toEqual(v(b));
    expect(moverFramePositions({ ...f, alpha: 3 }, pathFor(1050), false)).toEqual(v(b));
    expect(moverFramePositions({ ...f, alpha: 0 }, pathFor(1050), false)).toEqual(v(a));
  });

  it('snaps on the jump over a gap, a seek, a pause, a run change and under reduced motion', () => {
    const playing = initialMoverFrames(v(a), clock(1048, { playing: true }), 0);
    const snaps = [
      advanceMoverFrames(start, v(b), clock(1949), pathFor(1949), 600, false, { journey: true }), // overnight jump
      advanceMoverFrames(playing, v(b), clock(1400, { playing: true }), pathFor(1400), 1000, false), // seek
      advanceMoverFrames(playing, v(b), clock(1050), pathFor(1050), 1000, false), // pause
      advanceMoverFrames(playing, v(b), clock(1050, { playing: true, runId: 'run-2' }), pathFor(1050), 1000, false),
      advanceMoverFrames(start, v(b), clock(1050), pathFor(1050), 600, true, { journey: true }), // reduced motion
    ];
    for (const f of snaps) {
      expect(f.tween).toBe(false);
      expect(moverFramePositions(f, pathFor(1050), false)).toEqual(v(b));
    }
    // Reduced motion: even a frame caught mid-tween is drawn at the newest poll.
    const mid = { ...advanceMoverFrames(start, v(b), clock(1050), pathFor(1050), 600, false, { journey: true }), alpha: 0.5 };
    expect(moverFramePositions(mid, pathFor(1050), true)).toEqual(v(b));
  });

  it('with no cached line the marker moves on the straight line through the places, round the relay stop (#553)', () => {
    const none = pathForMovers(buildMoverLines(plans, { ...map, polylines: [] }), 1050);
    const straightLeg = [ll('biz-dumbo'), ll('biz-roast'), ll('home-007')];
    const on = (from: LngLat, to: LngLat, t: number) => ({ lng: from[0] + (to[0] - from[0]) * t, lat: from[1] + (to[1] - from[1]) * t });
    // Two polls the server places on the straight line (no polyline): before and after the relay stop.
    const p0 = on(straightLeg[0], straightLeg[1], 0.5);
    const p1 = on(straightLeg[1], straightLeg[2], 0.05);
    const s0 = initialMoverFrames(v(p0), clock(1048), 0);
    const f = advanceMoverFrames(s0, v(p1), clock(1050), none, 600, false, { journey: true });
    expect(f.tween).toBe(true);
    let nearest = Infinity;
    for (let i = 0; i <= 20; i++) {
      const [p] = moverFramePositions({ ...f, alpha: i / 20 }, none, false);
      expect(distToPath(p, straightLeg)).toBeLessThan(1);
      nearest = Math.min(nearest, distToPath(p, [straightLeg[1], straightLeg[1]]));
    }
    expect(nearest).toBeLessThan(20); // it passes the relay point
    // The cut between the two polls would miss the corner.
    const cut = { lat: (p0.lat + p1.lat) / 2, lng: (p0.lng + p1.lng) / 2 };
    expect(distToPath(cut, straightLeg)).toBeGreaterThan(5);
  });
});

describe('the page body uses the tween', () => {
  const src = readFileSync(resolve(__dirname, '../../client/src/components/sim/v2/compose/SimPageBody.tsx'), 'utf8');

  it('the map movers come from useTweenedMovers (frames chosen during render), with the journey option', () => {
    expect(src).toMatch(/useTweenedMovers\(\s*ready \? ready\.map\.movers/);
    expect(src).toMatch(/journey: journeyPlay\.state\.status === 'running'/);
    expect(src).toMatch(/movers=\{movers\}/);
    expect(src).toMatch(/movers=\{movers \?\? view\.map\.movers\}/);
    // No passive effect stores the movers to draw (DECISIONS pass 43).
    expect(src).not.toMatch(/useEffect\([^)]*setMovers/);
    expect(src).not.toMatch(/useState<MapMover\[\]>/);
  });
});
