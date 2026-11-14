import type { Clock, Settings } from '../../../../shared/types';
import type { SimControlRequest } from '../../../../shared/schemas';
import { formatMin } from '../../ui/format';

export type Speed = Clock['speed'];
export const SPEEDS: readonly Speed[] = [30, 120, 600];

/** Where jump_to_morning lands when the run has no Day 2 event (matches server/clock.ts). */
export const MORNING_FALLBACK_MIN = 1860;

export type PlaybackModel = {
  timeLabel: string;
  /** Run is at simEndMin. */
  finished: boolean;
  /** Text for the finished state; null otherwise. */
  finishedNote: string | null;
  /** Accessible name for the play/pause button. */
  playAriaLabel: 'Play simulation' | 'Pause simulation';
  playLabel: 'Play' | 'Pause';
  speed: Speed;
  disabled: {
    play: boolean;
    speed: boolean;
    nextEvent: boolean;
    jumpToMorning: boolean;
    finish: boolean;
    reset: boolean;
  };
};

export function toPlaybackModel(
  clock: Clock,
  nextEventMin: number | null,
  settings: Pick<Settings, 'simStartMin' | 'simEndMin'>,
  busy = false,
  morningTargetMin: number = MORNING_FALLBACK_MIN,
): PlaybackModel {
  const atEnd = clock.timeMin >= settings.simEndMin;
  return {
    timeLabel: formatMin(clock.timeMin),
    finished: atEnd,
    finishedNote: atEnd ? 'Run finished. Use Reset playback to watch again.' : null,
    playAriaLabel: clock.playing ? 'Pause simulation' : 'Play simulation',
    playLabel: clock.playing ? 'Pause' : 'Play',
    speed: clock.speed,
    disabled: {
      // Pausing stays possible while running; Play is pointless at the end.
      play: busy || (!clock.playing && atEnd),
      speed: busy,
      nextEvent: busy || nextEventMin === null,
      jumpToMorning: busy || clock.timeMin >= morningTargetMin,
      finish: busy || atEnd,
      reset: busy,
    },
  };
}

/** Clamp a raw scrub value to the sim window and round to an integer minute. */
export function clampScrub(
  raw: number,
  settings: Pick<Settings, 'simStartMin' | 'simEndMin'>,
): number {
  if (!Number.isFinite(raw)) return settings.simStartMin;
  return Math.min(settings.simEndMin, Math.max(settings.simStartMin, Math.round(raw)));
}

export type KeyEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
};

export type KeyState = {
  clock: Clock;
  nextEventMin: number | null;
  settings: Pick<Settings, 'simStartMin' | 'simEndMin'>;
  /** A control request is in flight. */
  busy: boolean;
  morningTargetMin?: number;
};

const TYPING_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

export function isTypingTarget(target: KeyEventLike['target']): boolean {
  if (!target) return false;
  return TYPING_TAGS.has((target.tagName ?? '').toUpperCase()) || target.isContentEditable === true;
}

/**
 * Map a key press to the same SimControlRequest the matching button sends, or
 * null when the key is not a shortcut, is ignored (typing target, modifier,
 * pending request) or the matching button would be disabled.
 * Space on a focused button/link is left to the browser so it is not sent twice.
 */
export function keyToControl(event: KeyEventLike, state: KeyState): SimControlRequest | null {
  if (state.busy || event.repeat) return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (isTypingTarget(event.target)) return null;
  const m = toPlaybackModel(state.clock, state.nextEventMin, state.settings, state.busy, state.morningTargetMin);
  switch (event.key) {
    case ' ': {
      const tag = (event.target?.tagName ?? '').toUpperCase();
      if (tag === 'BUTTON' || tag === 'A') return null;
      return m.disabled.play ? null : { action: state.clock.playing ? 'pause' : 'play' };
    }
    case 'n': case 'N': return m.disabled.nextEvent ? null : { action: 'next_event' };
    case 'm': case 'M': return m.disabled.jumpToMorning ? null : { action: 'jump_to_morning' };
    case 'f': case 'F': return m.disabled.finish ? null : { action: 'finish' };
    case 'r': case 'R': return m.disabled.reset ? null : { action: 'reset_playback' };
    case '1': return m.disabled.speed ? null : { action: 'speed', speed: 30 };
    case '2': return m.disabled.speed ? null : { action: 'speed', speed: 120 };
    case '3': return m.disabled.speed ? null : { action: 'speed', speed: 600 };
    default: return null;
  }
}
