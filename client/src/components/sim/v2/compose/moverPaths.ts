// The route line each map mover is on, for the tween between two polls (#496, DECISIONS pass 46).
// A vehicle follows the leg its employee drives; a package follows the leg that carries it. The line
// is the leg's decoded polylines from MapResponse, place pair by place pair. A pair with no cached
// line is the straight line between its two places (pass 44), and a leg with no cached line at all
// gives null, so the tween moves on the straight line between the two polled points.
//
// Display only: this picks a line to slide along between two polled positions. It never produces a
// position, a time, a status or a distance of its own (AGENTS.md).
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import type { Leg } from '../../../../../../shared/v2/types';
import { decodePath } from '../../../map/layers';
import type { LngLat, PathFor } from '../motion/routeTween';

type LegLine = { finishMin: number; path: LngLat[] | null };

/** Route lines by mover ID (employee ID or shipment ID), each list sorted by leg finish time. */
export type MoverLines = Map<string, LegLine[]>;

function decoded(map: MapResponse, from: string, to: string): LngLat[] | null {
  const hit = map.polylines.find((p) => p.from === from && p.to === to);
  if (!hit || !hit.encoded) return null;
  try {
    const path = decodePath(hit.encoded).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    return path.length >= 2 ? path : null;
  } catch {
    return null;
  }
}

/** One leg's line through all its places, or null when none of its pairs has a cached line. */
export function legLine(leg: Leg, map: MapResponse): LngLat[] | null {
  const coords = new Map<string, LngLat>();
  for (const b of map.businesses) coords.set(b.id, [b.lng, b.lat]);
  for (const h of map.homes) coords.set(h.id, [h.lng, h.lat]);
  const ids = leg.placeIds;
  let out: LngLat[] = [];
  let cached = 0;
  for (let i = 0; i + 1 < ids.length; i += 1) {
    let seg = decoded(map, ids[i], ids[i + 1]);
    if (seg) cached += 1;
    else {
      const a = coords.get(ids[i]);
      const b = coords.get(ids[i + 1]);
      if (!a || !b) return null; // a place without coordinates: no line to slide along
      seg = [a, b];
    }
    out = out.length ? [...out, ...seg.slice(1)] : seg;
  }
  return cached > 0 && out.length >= 2 ? out : null;
}

/**
 * Every leg's line, indexed by the employee who drives it and by the shipment it carries. Build it
 * once per map and set of plans (the paths are cached by identity in routeTween).
 */
export function buildMoverLines(plans: SimulatorResponse['plans'], map: MapResponse | null): MoverLines {
  const lines: MoverLines = new Map();
  if (!map) return lines;
  const add = (id: string, line: LegLine) => {
    const list = lines.get(id) ?? [];
    list.push(line);
    lines.set(id, list);
  };
  for (const plan of plans) {
    for (const leg of plan.legs) {
      const line = { finishMin: leg.finishMin, path: legLine(leg, map) };
      add(leg.employeeId, line);
      add(plan.shipmentId, line);
    }
  }
  for (const list of lines.values()) list.sort((a, b) => a.finishMin - b.finishMin);
  return lines;
}

/**
 * The line a mover is on at the polled minute `timeMin`: its first leg that has not finished yet
 * (an employee drives at most one leg per trip, and the evening and morning trips are hours apart),
 * else its last leg. Null (straight line) for a mover on no leg or a leg with no cached line.
 */
export function pathForMovers(lines: MoverLines, timeMin: number): PathFor {
  return (moverId) => {
    const list = lines.get(moverId);
    if (!list || list.length === 0) return null;
    return (list.find((l) => l.finishMin >= timeMin) ?? list[list.length - 1]).path;
  };
}
