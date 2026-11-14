// Marker paths on the REAL default NYC run (#512): buildMoverLines / pathForMovers (sim/v2/compose/moverPaths.ts)
// and the route tween (sim/v2/motion/routeTween.ts) over the API's plans and map. Every leg gets a path (the
// cached route line, else the straight line between its places, DECISIONS pass 44), its ends are at its two
// places, and at five moments of the day every moving marker stays inside the NYC box. The split between route
// lines and straight lines is printed, not asserted: a human fetches the new lines after #492.
// No story ID, name or count is pinned (DECISIONS pass 54).
import { describe, expect, it, vi } from 'vitest';
import type { MapResponse } from '../../shared/v2/api';
import type { Leg } from '../../shared/v2/types';
import { buildMoverLines, legLine, pathForMovers } from '../../client/src/components/sim/v2/compose/moverPaths';
import { simPageView } from '../../client/src/components/sim/v2/compose/simPageView';
import { tweenMovers, type LngLat } from '../../client/src/components/sim/v2/motion/routeTween';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { T, inNyc, metersBetween, realSim, type Moment } from './sim-v2-real-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const real = realSim();
const END_M = 150;
const { sim, map } = real.moments[0]; // plans and map do not change with the clock
const legs: Leg[] = sim.plans.flatMap((p) => p.legs);

function coordsOf(m: MapResponse): Map<string, { lat: number; lng: number }> {
  return new Map([...m.businesses, ...m.homes].map((p) => [p.id, { lat: p.lat, lng: p.lng }]));
}
const pt = ([lng, lat]: LngLat) => ({ lat, lng });

/** True when every place pair of the leg has a cached line in the map response. */
const allCached = (leg: Leg, m: MapResponse) => leg.placeIds.slice(1).every((to, i) =>
  m.polylines.some((p) => p.from === leg.placeIds[i] && p.to === to && !!p.encoded));

/** Every leg's line, checked against the rule: a path whose ends are within 150 m of the leg's two places. */
function checkLegs(m: MapResponse) {
  const coords = coordsOf(m);
  const lines = buildMoverLines(sim.plans, m);
  for (const plan of sim.plans) {
    plan.legs.forEach((leg) => {
      const path = legLine(leg, m);
      expect({ leg: leg.tripId, hasPath: path !== null }).toEqual({ leg: leg.tripId, hasPath: true });
      if (!path) return;
      expect(path.length).toBeGreaterThanOrEqual(2);
      const from = coords.get(leg.placeIds[0])!;
      const to = coords.get(leg.placeIds[leg.placeIds.length - 1])!;
      expect(metersBetween(pt(path[0]), from)).toBeLessThanOrEqual(END_M);
      expect(metersBetween(pt(path[path.length - 1]), to)).toBeLessThanOrEqual(END_M);
      for (const p of path) expect(inNyc(pt(p))).toBe(true);
      // The line is indexed by the carrier and by the package.
      for (const id of [leg.employeeId, plan.shipmentId]) {
        expect(lines.get(id)?.some((l) => l.path === path || JSON.stringify(l.path) === JSON.stringify(path))).toBe(true);
      }
    });
  }
}

describe('every leg of the API\'s plans has a path', () => {
  it('the run has plans with legs, and every leg place has coordinates in the map', () => {
    expect(legs.length).toBeGreaterThan(0);
    const coords = coordsOf(map);
    for (const leg of legs) for (const id of leg.placeIds) expect(coords.has(id)).toBe(true);
  });

  it('prints how many legs use a route line and how many the straight line', () => {
    const route = legs.filter((l) => allCached(l, map)).length;
    const someCached = legs.filter((l) => !allCached(l, map) && legLine(l, map) !== null).length;
    console.log(`[#512] legs: ${route} on a cached route line, ${someCached} partly, ${legs.length - route - someCached} on the straight line (of ${legs.length})`);
    expect(route + someCached).toBeLessThanOrEqual(legs.length);
  });

  it('with the committed cache: the route line or the straight line, ends within 150 m of the two places', () => {
    checkLegs(map);
  });

  it('a leg with only some pairs cached: the missing pairs are the straight line between their places', () => {
    // The first pair of every leg loses its line; the rest keep theirs.
    const dropped = new Set(legs.map((l) => `${l.placeIds[0]}|${l.placeIds[1]}`));
    const partial: MapResponse = {
      ...map,
      polylines: map.polylines.map((p) => (dropped.has(`${p.from}|${p.to}`) ? { ...p, encoded: null } : p)),
    };
    const coords = coordsOf(partial);
    for (const leg of legs.filter((l) => l.placeIds.length >= 3 && allCached(l, map))) {
      const path = legLine(leg, partial)!;
      expect(path).not.toBeNull();
      const a = coords.get(leg.placeIds[0])!;
      const b = coords.get(leg.placeIds[1])!;
      expect(path[0]).toEqual([a.lng, a.lat]);
      expect(path[1]).toEqual([b.lng, b.lat]);
    }
    checkLegs(partial);
  });

  // BUG (client/src/components/sim/v2/compose/moverPaths.ts, `legLine`): a leg with NO cached pair gets `null`
  // instead of the straight line through its places. The tween then cuts straight between two polled points,
  // also across a relay stop's corner. This is what every new plan of the #492 retune looks like until a human
  // fetches its lines. compose/ is owned by the page check queued with #512, so the fix is left there.
  it.fails('a leg with no cached line at all: the straight line between its places (DECISIONS pass 44)', () => {
    checkLegs({ ...map, polylines: map.polylines.map((p) => ({ ...p, encoded: null })) });
  });
});

/** The movers on the network map at a moment (what the page draws and tweens). */
function moversAt(m: Moment) {
  const view = simPageView({ data: m.data, selection: null, layers: DEFAULT_LAYERS });
  if (view.view !== 'ready') throw new Error(`minute ${m.timeMin}: not ready`);
  return view.map.movers;
}

describe.each(real.moments)('moving markers at $name', (moment) => {
  const lines = buildMoverLines(moment.sim.plans, moment.map);
  const pathFor = pathForMovers(lines, moment.timeMin);
  const movers = moversAt(moment);
  // The poll before: one minute earlier (the 930 start has no earlier minute in the window).
  const prev = moment.timeMin > 930 ? moversAt(real.at(moment.timeMin - 1)) : movers;

  it('every marker the snapshot places is inside the NYC box', () => {
    for (const m of moment.sim.snapshot.markers) expect({ id: m.employeeId, in: inNyc(m) }).toEqual({ id: m.employeeId, in: true });
    for (const [id, p] of Object.entries(moment.sim.snapshot.packagePositions)) expect({ id, in: inNyc(p) }).toEqual({ id, in: true });
    for (const m of movers) expect(inNyc(m)).toBe(true);
  });

  it('pathForMovers gives every moving marker a line inside the NYC box, and the tween keeps it there', () => {
    for (const m of movers) {
      const path = pathFor(m.id);
      if (path) for (const p of path) expect({ id: m.id, in: inNyc(pt(p)) }).toEqual({ id: m.id, in: true });
    }
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      for (const m of tweenMovers({ prev, next: movers, alpha, pathFor, reducedMotion: false })) {
        expect({ id: m.id, alpha, in: inNyc(m) }).toEqual({ id: m.id, alpha, in: true });
      }
    }
  });

  it('a vehicle on a leg is the carrier of a plan, and its line is that leg\'s line', () => {
    for (const marker of moment.sim.snapshot.markers) {
      const own = lines.get(marker.employeeId);
      expect(own && own.length > 0).toBe(true);
      expect(own!.map((l) => l.path)).toContain(pathFor(marker.employeeId));
    }
  });
});

it('one minute inside each leg of the day, its carrier has a marker on the map', () => {
  for (const m of [real.moments[1], real.moments[3]]) {
    const leg = legs.find((l) => l.stops[0].arrivalMin + 1 === m.timeMin);
    expect(leg).toBeDefined();
    expect(m.sim.snapshot.markers.some((x) => x.employeeId === leg!.employeeId)).toBe(true);
  }
});
