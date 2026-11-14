// Smooths the NYC map's movers between 1 s polls. The frames are chosen during render (DECISIONS
// pass 43, #318): a new poll is first drawn at the position already on screen, then a
// requestAnimationFrame loop moves alpha 0 → 1 along each mover's route line.
import { useEffect, useState } from 'react';
import type { MapMover } from '../../../map/types';
import { REDUCED_MOTION_QUERY, clampAlpha } from '../../markerTween';
import { shouldSnapV2, tweenMovers, type PathFor, type TweenClock } from './routeTween';

/** The tween runs over the real time between the last two polls, kept inside these bounds. */
export const MIN_TWEEN_MS = 250;
export const MAX_TWEEN_MS = 1500;
export const DEFAULT_TWEEN_MS = 1000;

export type MoverFrames = {
  prev: MapMover[];
  next: MapMover[];
  clock: TweenClock;
  /** performance.now() when `next` arrived. */
  receivedAt: number;
  durationMs: number;
  alpha: number;
  /** True while the rAF loop should run for `next`. */
  tween: boolean;
};

export type TweenOptions = {
  /** Play journey is stepping a paused clock with small seeks: tween those steps (pass 46). */
  journey?: boolean;
};

export const initialMoverFrames = (movers: MapMover[], clock: TweenClock, nowMs: number): MoverFrames =>
  ({ prev: movers, next: movers, clock, receivedAt: nowMs, durationMs: DEFAULT_TWEEN_MS, alpha: 1, tween: false });

const sameClock = (a: TweenClock, b: TweenClock): boolean =>
  a.runId === b.runId && a.timeMin === b.timeMin && a.playing === b.playing && a.speed === b.speed;

const sameMovers = (a: MapMover[], b: MapMover[]): boolean =>
  a === b || (a.length === b.length && a.every((m, i) => {
    const o = b[i];
    return m.id === o.id && m.kind === o.kind && m.lat === o.lat && m.lng === o.lng && m.label === o.label;
  }));

/** Positions to draw for a frame state. */
export const moverFramePositions = (f: MoverFrames, pathFor: PathFor, reducedMotion: boolean): MapMover[] =>
  tweenMovers({ prev: f.prev, next: f.next, alpha: f.alpha, pathFor, reducedMotion });

/**
 * Pure step run during render. An equal poll (same clock, same movers) returns `state` unchanged,
 * so a parent re-render never restarts the tween. A new poll tweens from what is on screen now,
 * unless it must snap (reduced motion, new run, pause, rewind, seek or jump).
 */
export function advanceMoverFrames(
  state: MoverFrames, movers: MapMover[], clock: TweenClock, pathFor: PathFor,
  nowMs: number, reducedMotion: boolean, options: TweenOptions = {},
): MoverFrames {
  if (sameClock(state.clock, clock) && sameMovers(state.next, movers)) return state;
  const elapsed = nowMs - state.receivedAt;
  if (reducedMotion || shouldSnapV2(state.clock, clock, elapsed, options.journey)) {
    return initialMoverFrames(movers, clock, nowMs);
  }
  const shown = moverFramePositions(state, pathFor, false);
  const durationMs = Math.min(MAX_TWEEN_MS, Math.max(MIN_TWEEN_MS, Number.isFinite(elapsed) ? elapsed : DEFAULT_TWEEN_MS));
  return { prev: shown, next: movers, clock, receivedAt: nowMs, durationMs, alpha: 0, tween: true };
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia(REDUCED_MOTION_QUERY).matches;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

const tabHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * The movers to draw this frame. `movers` and `clock` come from the newest poll (`clock` =
 * `{ ...sim.clock, runId: sim.runId }`); `pathFor` gives the route line a mover is on.
 */
export function useTweenedMovers(
  movers: MapMover[], clock: TweenClock, pathFor: PathFor, options: TweenOptions = {},
): MapMover[] {
  const reducedMotion = useReducedMotion();
  const [stored, setFrames] = useState<MoverFrames>(() => initialMoverFrames(movers, clock, now()));

  // Chosen during render (React's "adjust state while rendering"), so the first paint of a new poll
  // already shows the old positions. advanceMoverFrames returns the same object for an equal poll.
  let frames = stored;
  if (stored.next !== movers || !sameClock(stored.clock, clock)) {
    frames = advanceMoverFrames(stored, movers, clock, pathFor, now(), reducedMotion, options);
    if (frames !== stored) setFrames(frames);
  }

  const target = frames.next;
  const tweening = frames.tween && !reducedMotion;
  const durationMs = frames.durationMs;
  useEffect(() => {
    if (!tweening) return;
    const finish = (f: MoverFrames) => (f.next === target && f.alpha !== 1 ? { ...f, alpha: 1, tween: false } : f);
    if (typeof requestAnimationFrame !== 'function' || tabHidden()) { setFrames(finish); return; }
    const start = now();
    let raf = requestAnimationFrame(function step(t) {
      const a = clampAlpha((t - start) / durationMs);
      setFrames((f) => (f.next === target && f.alpha !== a ? { ...f, alpha: a, tween: a < 1 } : f));
      if (a < 1) raf = requestAnimationFrame(step);
    });
    // A hidden tab stops the loop and shows the newest poll.
    const onVisibility = () => { if (tabHidden()) { cancelAnimationFrame(raf); setFrames(finish); } };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [target, tweening, durationMs]);

  return moverFramePositions(frames, pathFor, reducedMotion);
}
