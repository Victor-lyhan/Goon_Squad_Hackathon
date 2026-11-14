// Pure helpers that smooth mover positions between two polls along the mover's route line.
// Display-only (AGENTS.md hard rule): the server's snapshotAt decides every position and status;
// this file only picks a point between two polled positions. No status, ETA or money here.
import type { MapMover } from '../../../map/types';
import { clampAlpha } from './motionMath';
import { JOURNEY_STEP_MIN, JOURNEY_STEP_MS } from './journeyPlayback';

/** deck.gl order, like `MapRoute.path`. */
export type LngLat = [number, number];

/** The route line a mover is on right now, or null when none is cached (straight line then). */
export type PathFor = (moverId: string) => LngLat[] | null;

/** What the snap rule needs from a poll: `SimulatorResponse.runId` plus its `clock`. */
export type TweenClock = { runId: string; timeMin: number; playing: boolean; speed: number };

export type TweenInput = {
  prev: MapMover[];
  next: MapMover[];
  alpha: number;
  pathFor: PathFor;
  reducedMotion: boolean;
};

/** A polled point farther than this from the route line is not on it: use the straight line. */
export const OFF_PATH_M = 100;

/** A poll may cover up to this many "normal" poll intervals of simulated time before it counts as a jump. */
export const SNAP_JUMP_FACTOR = 2;

/** Polls are 1 s apart; a poll that comes back early still gets a full interval of slack. */
const MIN_POLL_MS = 1000;

/**
 * True when the movement between two polls must not be tweened: a new run, a paused clock,
 * simulated time going backwards, or a forward step larger than a normal poll at the current
 * speed (a seek, "next event", a jump). `journey` = Play journey is stepping a paused clock with
 * small seeks (DECISIONS pass 46); those steps tween, the jumps over gaps still snap.
 */
export function shouldSnapV2(prevClock: TweenClock, nextClock: TweenClock, elapsedMs: number, journey = false): boolean {
  if (prevClock.runId !== nextClock.runId) return true;
  const dt = nextClock.timeMin - prevClock.timeMin;
  if (!Number.isFinite(dt) || dt < 0) return true;
  const ms = Math.max(Number.isFinite(elapsedMs) ? elapsedMs : 0, MIN_POLL_MS);
  if (journey) {
    const steps = Math.max(1, Math.ceil(ms / JOURNEY_STEP_MS));
    return dt > JOURNEY_STEP_MIN * steps * SNAP_JUMP_FACTOR;
  }
  if (!nextClock.playing || !prevClock.playing) return true;
  return dt > (nextClock.speed * ms / 1000) * SNAP_JUMP_FACTOR;
}

// ---------- path geometry (local flat plane, meters; NYC is small enough) ----------

const M_PER_DEG = 111_320;

type Prepared = { pts: LngLat[]; xs: Float64Array; ys: Float64Array; cum: Float64Array; kx: number };
type Projection = { s: number; dist: number; lng: number; lat: number };

const prepared = new WeakMap<LngLat[], Prepared>();

function prepare(path: LngLat[]): Prepared {
  const hit = prepared.get(path);
  if (hit) return hit;
  const n = path.length;
  const kx = M_PER_DEG * Math.cos((path[0][1] * Math.PI) / 180);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = path[i][0] * kx;
    ys[i] = path[i][1] * M_PER_DEG;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  const p: Prepared = { pts: path, xs, ys, cum, kx };
  prepared.set(path, p);
  return p;
}

/** Closest point on the path to (lng, lat), with its distance along the path. */
function project(p: Prepared, lng: number, lat: number): Projection {
  const x = lng * p.kx;
  const y = lat * M_PER_DEG;
  let best: Projection = { s: 0, dist: Infinity, lng: p.pts[0][0], lat: p.pts[0][1] };
  for (let i = 0; i < p.xs.length - 1; i++) {
    const ax = p.xs[i], ay = p.ys[i];
    const dx = p.xs[i + 1] - ax, dy = p.ys[i + 1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best.dist) {
      const [lng0, lat0] = p.pts[i];
      const [lng1, lat1] = p.pts[i + 1];
      best = { s: p.cum[i] + t * (p.cum[i + 1] - p.cum[i]), dist: d, lng: lng0 + (lng1 - lng0) * t, lat: lat0 + (lat1 - lat0) * t };
    }
  }
  return best;
}

/** The point at distance `s` along the path. */
function pointAt(p: Prepared, s: number): LngLat {
  const { cum, pts } = p;
  const last = cum.length - 1;
  if (s <= 0) return pts[0];
  if (s >= cum[last]) return pts[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg === 0 ? 0 : (s - cum[lo]) / seg;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
}

type Pt = { lat: number; lng: number };

const straight = (a: Pt, b: Pt, t: number): Pt => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });

/**
 * One mover between two polled points. With a usable path the point moves along the line; the
 * small gap between each polled point and its projection is blended out, so alpha 0 and 1 return
 * the polled points exactly.
 */
export function tweenPoint(a: Pt, b: Pt, t: number, path: LngLat[] | null): Pt {
  if (t <= 0) return { lat: a.lat, lng: a.lng };
  if (t >= 1) return { lat: b.lat, lng: b.lng };
  if (a.lat === b.lat && a.lng === b.lng) return { lat: b.lat, lng: b.lng };
  if (!path || path.length < 2) return straight(a, b, t);
  const p = prepare(path);
  const pa = project(p, a.lng, a.lat);
  const pb = project(p, b.lng, b.lat);
  if (pa.dist > OFF_PATH_M || pb.dist > OFF_PATH_M) return straight(a, b, t);
  const [lng, lat] = pointAt(p, pa.s + (pb.s - pa.s) * t);
  return {
    lng: lng + (1 - t) * (a.lng - pa.lng) + t * (b.lng - pb.lng),
    lat: lat + (1 - t) * (a.lat - pa.lat) + t * (b.lat - pb.lat),
  };
}

const samePos = (a: Pt, b: Pt): boolean => a.lat === b.lat && a.lng === b.lng;

/**
 * The movers to draw at `alpha` (0 = previous poll, 1 = newest poll; clamped, never extrapolated).
 * Only movers in `next` are drawn (a gone mover disappears); a new mover is drawn where it is.
 * A package that sits exactly on a vehicle in both polls is drawn exactly on that vehicle.
 */
export function tweenMovers({ prev, next, alpha, pathFor, reducedMotion }: TweenInput): MapMover[] {
  if (reducedMotion) return next.map((m) => ({ ...m }));
  const t = clampAlpha(alpha);
  const before = new Map(prev.map((m) => [m.id, m]));
  const vehicles = new Map<string, Pt>();
  const out = new Map<string, MapMover>();

  for (const m of next) {
    if (m.kind !== 'vehicle') continue;
    const p = before.get(m.id);
    const at = p && t < 1 ? tweenPoint(p, m, t, pathFor(m.id)) : m;
    vehicles.set(m.id, at);
    out.set(m.id, { ...m, lat: at.lat, lng: at.lng });
  }

  for (const m of next) {
    if (m.kind === 'vehicle') continue;
    const p = before.get(m.id);
    if (!p || t >= 1) { out.set(m.id, { ...m }); continue; }
    let carrier: Pt | undefined;
    for (const v of next) {
      if (v.kind !== 'vehicle' || !samePos(v, m)) continue;
      const vp = before.get(v.id);
      if (vp && samePos(vp, p)) { carrier = vehicles.get(v.id); break; }
    }
    const at = carrier ?? tweenPoint(p, m, t, pathFor(m.id));
    out.set(m.id, { ...m, lat: at.lat, lng: at.lng });
  }

  return next.map((m) => out.get(m.id) ?? { ...m });
}
