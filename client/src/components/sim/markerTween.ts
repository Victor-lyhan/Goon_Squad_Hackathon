// Pure helpers that smooth marker positions between 1 s polls. Display-only:
// the backend decides positions/statuses; we only interpolate.
import type { Clock, MarkerPosition, Snapshot } from '../../../../shared/types';

type Pos = { x: number; y: number };
type PackagePositions = Snapshot['packagePositions'];

export const SNAP_JUMP_PLAY_SECONDS = 2;

export const clampAlpha = (a: number): number => (Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const blend = (p: Pos, n: Pos, t: number): Pos => ({ x: lerp(p.x, n.x, t), y: lerp(p.y, n.y, t) });

export function tweenMarkers(prev: MarkerPosition[], next: MarkerPosition[], alpha: number, reducedMotion = false): MarkerPosition[] {
  if (reducedMotion) return next.map((m) => ({ ...m }));
  const t = clampAlpha(alpha);
  const before = new Map(prev.map((m) => [m.employeeId, m]));
  return next.map((m) => {
    const p = before.get(m.employeeId);
    return p ? { ...m, ...blend(p, m, t) } : { ...m };
  });
}

export function tweenPackages(prev: PackagePositions, next: PackagePositions, alpha: number, reducedMotion = false): PackagePositions {
  const t = reducedMotion ? 1 : clampAlpha(alpha);
  const out: PackagePositions = {};
  for (const id of Object.keys(next)) {
    const p = prev[id];
    out[id] = p && !reducedMotion ? blend(p, next[id], t) : { x: next[id].x, y: next[id].y };
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

export type MarkerFrame = Pick<Snapshot, 'runId' | 'timeMin' | 'markers' | 'packagePositions'>;

/** What MapMarkers draws: a blend of `prev` and `next` at `alpha`. `tween` = run the rAF loop for `next`. */
export type FrameState<F extends MarkerFrame = MarkerFrame> = { prev: MarkerFrame; next: F; alpha: number; tween: boolean };

export const initialFrames = <F extends MarkerFrame>(snapshot: F): FrameState<F> =>
  ({ prev: snapshot, next: snapshot, alpha: 1, tween: false });

/** Positions drawn for a frame state. */
export function framePositions(state: FrameState, reducedMotion = false): Pick<MarkerFrame, 'markers' | 'packagePositions'> {
  return {
    markers: tweenMarkers(state.prev.markers, state.next.markers, state.alpha, reducedMotion),
    packagePositions: tweenPackages(state.prev.packagePositions, state.next.packagePositions, state.alpha, reducedMotion),
  };
}

/**
 * Pure step run during render whenever a snapshot is passed in. The same snapshot object returns
 * `state` unchanged (no tween restart). A new snapshot tweens from what is on screen right now
 * (alpha 0 = the positions last drawn), unless it must snap (reduced motion, new run, rewind, seek/jump).
 */
export function advanceFrames<F extends MarkerFrame>(
  state: FrameState<F>, snapshot: F, clock: Pick<Clock, 'speed'>, reducedMotion: boolean,
): FrameState<F> {
  if (state.next === snapshot) return state;
  if (!shouldTween(reducedMotion) || shouldSnap(state.next, snapshot, clock)) return initialFrames(snapshot);
  const shown: MarkerFrame = { ...state.next, ...framePositions(state, reducedMotion) };
  return { prev: shown, next: snapshot, alpha: 0, tween: true };
}

/** Pure flag: tween between polls only when the user has not asked for reduced motion. */
export const shouldTween = (reducedMotion: boolean): boolean => !reducedMotion;
