// Pure helpers that smooth marker positions between 1 s polls. Display-only:
// the backend decides positions/statuses; we only interpolate.
import type { Clock, MarkerPosition, Snapshot } from '../../../../shared/types';

type Pos = { x: number; y: number };
type PackagePositions = Snapshot['packagePositions'];

export const SNAP_JUMP_PLAY_SECONDS = 2;

export const clampAlpha = (a: number): number => (Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const blend = (p: Pos, n: Pos, t: number): Pos => ({ x: lerp(p.x, n.x, t), y: lerp(p.y, n.y, t) });

export function tweenMarkers(prev: MarkerPosition[], next: MarkerPosition[], alpha: number): MarkerPosition[] {
  const t = clampAlpha(alpha);
  const before = new Map(prev.map((m) => [m.employeeId, m]));
  return next.map((m) => {
    const p = before.get(m.employeeId);
    return p ? { ...m, ...blend(p, m, t) } : { ...m };
  });
}

export function tweenPackages(prev: PackagePositions, next: PackagePositions, alpha: number): PackagePositions {
  const t = clampAlpha(alpha);
  const out: PackagePositions = {};
  for (const id of Object.keys(next)) {
    const p = prev[id];
    out[id] = p ? blend(p, next[id], t) : { x: next[id].x, y: next[id].y };
  }
  return out;
}

/** True when the new snapshot is not a normal continuation (new run, rewind, or seek/jump). */
export function shouldSnap(
  prevSnapshot: Pick<Snapshot, 'runId' | 'timeMin'>,
  nextSnapshot: Pick<Snapshot, 'runId' | 'timeMin'>,
  clock: Pick<Clock, 'speed'>,
): boolean {
  if (prevSnapshot.runId !== nextSnapshot.runId) return true;
  const dt = nextSnapshot.timeMin - prevSnapshot.timeMin;
  if (dt < 0) return true;
  return dt > clock.speed * SNAP_JUMP_PLAY_SECONDS;
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Pure flag: tween between polls only when the user has not asked for reduced motion. */
export const shouldTween = (reducedMotion: boolean): boolean => !reducedMotion;
