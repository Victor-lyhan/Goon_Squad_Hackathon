// "Play journey" on the simulator page (#496, DECISIONS pass 45 + 46). The browser steps the server
// clock with the data hook's `seek` over the windows of the journey plan (journeyModel `playPlan`):
// 2 simulated minutes every 500 ms inside a window, one jump over each gap. The step rule and the
// timer loop are `startJourneyPlayback` (motion/); this file adds the page's start, stop and copy.
//
// No React, no DOM, tested in Node with fake timers. The server decides every position and status;
// the browser only chooses the next minute to seek to.
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import { journeyDurationMs, startJourneyPlayback, type JourneyWindow } from '../motion/journeyPlayback';
import { playPlan, type Journey, type JourneyResult } from '../journey/journeyModel';

// ---------- Copy ----------
export const PLAY_LABEL = 'Play journey';
export const STOP_LABEL = 'Stop';
export const NO_JOURNEY_TEXT = 'No journey to play: this package has no match yet.';
export const STOPPED_TEXT = 'Journey stopped.';
export const PLAY_FAILED_TEXT = 'Play journey stopped: the simulator did not accept a step.';

// ---------- State ----------
type Target = { shipmentId: string; runId: string };

/**
 * running: steps are being sent; stopped: Stop or Esc; finished: the last window was played;
 * failed: a pause or seek was refused (the hook's `actionError` has the server's text).
 */
export type PlayState =
  | { status: 'idle' }
  | ({ status: 'running' | 'stopped' | 'finished' | 'failed' } & Target);

export const PLAY_IDLE: PlayState = { status: 'idle' };

/** The play state for the package and run on screen; a state left from another one reads idle. */
export function currentPlay(state: PlayState, shipmentId: string | null, runId: string | null): PlayState {
  if (state.status === 'idle') return state;
  return state.shipmentId === shipmentId && state.runId === runId ? state : PLAY_IDLE;
}

/** The plan's windows in the form the step driver takes. */
export const journeyWindows = (journey: Journey): JourneyWindow[] =>
  playPlan(journey).windows.map(({ startMin, endMin }) => ({ startMin, endMin }));

// ---------- Player ----------
export type JourneyPlayerDeps = {
  /** The data hook's `control`: the applied response, or null when the request failed. */
  control: (req: SimControlRequest) => Promise<unknown>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onChange: (state: PlayState) => void;
};

export type JourneyStart = Target & {
  windows: JourneyWindow[];
  /** The server clock is playing now: it is paused first (a pause does not lock the run). */
  clockPlaying: boolean;
};

export type JourneyPlayer = {
  start: (s: JourneyStart) => void;
  /** Stop or Esc. True when a journey was running (so Esc was used for that). */
  stop: () => boolean;
  /** Selection or run changed: stop without the "stopped" announcement. */
  reset: () => void;
  /** Unmount: stop the timer, report nothing. */
  dispose: () => void;
  state: () => PlayState;
};

class StepRefused extends Error {}

export function createJourneyPlayer(deps: JourneyPlayerDeps): JourneyPlayer {
  let state: PlayState = PLAY_IDLE;
  let stopDriver: (() => void) | null = null;
  // Each start gets a number; a late answer from an earlier start is ignored.
  let token = 0;

  const set = (next: PlayState) => {
    state = next;
    deps.onChange(next);
  };
  const halt = () => {
    token += 1;
    stopDriver?.();
    stopDriver = null;
  };
  const end = (my: number, target: Target, status: 'finished' | 'failed') => {
    if (my !== token) return;
    stopDriver = null;
    set({ status, ...target });
  };

  return {
    start({ windows, clockPlaying, shipmentId, runId }) {
      halt();
      const my = token;
      const target = { shipmentId, runId };
      set({ status: 'running', ...target });
      const drive = () => {
        if (my !== token) return;
        stopDriver = startJourneyPlayback({
          windows,
          // Always from the start of the journey, so a judge sees sender, relay point, recipient.
          fromMin: -Infinity,
          seek: async (toMin) => {
            if ((await deps.control({ action: 'seek', timeMin: toMin })) === null) throw new StepRefused();
          },
          setTimer: deps.setTimer,
          clearTimer: deps.clearTimer,
          onDone: () => end(my, target, 'finished'),
          onError: () => end(my, target, 'failed'),
        });
      };
      if (!clockPlaying) {
        drive();
        return;
      }
      void deps.control({ action: 'pause' }).then((res) => {
        if (res === null) end(my, target, 'failed');
        else drive();
      });
    },
    stop() {
      if (state.status !== 'running') return false;
      const { shipmentId, runId } = state;
      halt();
      set({ status: 'stopped', shipmentId, runId });
      return true;
    },
    reset() {
      halt();
      if (state.status !== 'idle') set(PLAY_IDLE);
    },
    dispose() {
      halt();
      state = PLAY_IDLE;
    },
    state: () => state,
  };
}

/** What the page sees after a render, for `syncJourneyPlayer`. */
export type PlaySync = { shipmentId: string | null; runId: string | null; clockPlaying: boolean };

/**
 * Run by the page after each render that changes `now`. Another package, another selection kind or
 * a new run resets the player; the server clock switching to playing (Play here, or in another tab)
 * stops it. A journey started on a playing clock is not stopped by that: it pauses the clock itself.
 */
export function syncJourneyPlayer(player: JourneyPlayer, prev: PlaySync | null, now: PlaySync): void {
  const s = player.state();
  if (s.status === 'idle') return;
  if (s.shipmentId !== now.shipmentId || s.runId !== now.runId) {
    player.reset();
    return;
  }
  if (now.clockPlaying && !(prev?.clockPlaying ?? false)) player.stop();
}

// ---------- What the panel shows ----------
export type PlayButtonView =
  | { kind: 'unavailable'; label: typeof PLAY_LABEL; note: typeof NO_JOURNEY_TEXT }
  | { kind: 'play'; label: typeof PLAY_LABEL; hint: string }
  | { kind: 'stop'; label: typeof STOP_LABEL };

/** "about N s" for the whole journey, from the step count (journeyDurationMs). */
export function durationHint(windows: JourneyWindow[]): string {
  return `about ${Math.max(1, Math.round(journeyDurationMs(windows) / 1000))} s`;
}

/** The button for a journey panel: disabled for an unmatched package, Stop while running. */
export function playButtonView(journey: JourneyResult, play: PlayState): PlayButtonView {
  if (journey.kind === 'unmatched') return { kind: 'unavailable', label: PLAY_LABEL, note: NO_JOURNEY_TEXT };
  if (play.status === 'running') return { kind: 'stop', label: STOP_LABEL };
  return { kind: 'play', label: PLAY_LABEL, hint: durationHint(journeyWindows(journey)) };
}

/**
 * The step line: which step the package is heading for, read from the timeline (the server's
 * occurred events). Its text changes only when a step changes, so a screen reader hears each step
 * once, not each seek.
 */
export function stepAnnouncement(journey: Journey): string {
  const total = journey.steps.length;
  const current = journey.steps.find((s) => s.state === 'current');
  if (current) return `Step ${current.n} of ${total} next: ${current.label} at ${current.placeName}.`;
  const last = journey.steps[total - 1];
  return last ? `Journey complete: ${last.label} at ${last.placeName}.` : '';
}

/** The `role="status"` line under the button. Empty when idle and after a failure (the error is an alert). */
export function playStatusText(journey: JourneyResult, play: PlayState): string {
  if (journey.kind !== 'journey') return '';
  if (play.status === 'running' || play.status === 'finished') return stepAnnouncement(journey);
  if (play.status === 'stopped') return STOPPED_TEXT;
  return '';
}

/** The error under the button after a failed step: the hook's message, or a fixed sentence. */
export function playErrorText(play: PlayState, actionError: string | null): string | null {
  if (play.status !== 'failed') return null;
  return actionError ? `Play journey stopped: ${actionError}` : PLAY_FAILED_TEXT;
}
