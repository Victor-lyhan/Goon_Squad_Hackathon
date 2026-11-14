// The journey side of the simulator's one Play/Pause button (#496, #648; DECISIONS pass 45, 46, 63).
// With a package picked, Play steps the server clock with the data hook's `seek` over the windows
// of the journey plan (journeyModel `playPlan`): 2 simulated minutes every 500 ms inside a window,
// one jump to the pickup, and the card "Overnight at <relay point>" for about 1 s in place of the
// night. Pause keeps the clock where it is; Play again goes on from there. The step rule and the
// timer loop are `startJourneyPlayback` (motion/); this file adds the page's play, pause and copy.
//
// No React, no DOM, tested in Node with fake timers. The server decides every position and status;
// the browser only chooses the next minute to seek to.
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import type { Clock } from '../../../../../../shared/v2/types';
import {
  BUSY_REASON, FINISHED_REASON, PAUSE_LABEL, PLAY_LABEL, isRunFinished, type PlayButtonView,
} from '../controls/controlsModel';
import { journeyEndMin, startJourneyPlayback, type JourneyWindow } from '../motion/journeyPlayback';
import { playPlan, type Journey, type JourneyResult } from '../journey/journeyModel';

// ---------- Copy ----------
export { PAUSE_LABEL, PLAY_LABEL };
export const NO_JOURNEY_TEXT = 'No journey to play: this package has no match yet.';
export const PAUSED_TEXT = 'Journey paused.';
export const PLAY_FAILED_TEXT = 'Play stopped: the simulator did not accept a step.';
export const RELAY_FALLBACK_NAME = 'the relay point';

// ---------- State ----------
type Target = { shipmentId: string; runId: string };

/**
 * running: steps are being sent (`overnight` while the card is up in place of the night);
 * paused: Pause, Esc or another clock action; finished: the last window was played;
 * failed: a pause or seek was refused (the hook's `actionError` has the server's text).
 */
export type PlayState =
  | { status: 'idle' }
  | ({ status: 'running'; overnight: boolean } & Target)
  | ({ status: 'paused' | 'finished' | 'failed' } & Target);

export const PLAY_IDLE: PlayState = { status: 'idle' };

/** The play state for the package and run on screen; a state left from another one reads idle. */
export function currentPlay(state: PlayState, shipmentId: string | null, runId: string | null): PlayState {
  if (state.status === 'idle') return state;
  return state.shipmentId === shipmentId && state.runId === runId ? state : PLAY_IDLE;
}

/** The plan's windows in the form the step driver takes. */
export const journeyWindows = (journey: Journey): JourneyWindow[] =>
  playPlan(journey).windows.map(({ startMin, endMin }) => ({ startMin, endMin }));

/**
 * Where Play starts. After a pause it goes on from the clock's time (also when a timeline step
 * moved the clock meanwhile); otherwise, and once the clock is at the end of the journey, from the
 * start, so a judge sees sender, relay point, recipient.
 */
export function playFromMin(state: PlayState, windows: JourneyWindow[], clockMin: number): number {
  if (state.status !== 'paused') return -Infinity;
  return clockMin < journeyEndMin(windows) ? clockMin : -Infinity;
}

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
  /** `playFromMin`: -Infinity for the start, or the clock's time after a pause. */
  fromMin: number;
  /** The server clock is playing now: it is paused first (a pause does not lock the run). */
  clockPlaying: boolean;
};

export type JourneyPlayer = {
  start: (s: JourneyStart) => void;
  /** Pause, Esc or another clock action. True when a journey was running (so Esc was used for that). */
  pause: () => boolean;
  /** Selection or run changed, or Back to start: stop without the "paused" announcement. */
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
    start({ windows, fromMin, clockPlaying, shipmentId, runId }) {
      halt();
      const my = token;
      const target = { shipmentId, runId };
      set({ status: 'running', overnight: false, ...target });
      const drive = () => {
        if (my !== token) return;
        stopDriver = startJourneyPlayback({
          windows,
          fromMin,
          seek: async (toMin) => {
            if ((await deps.control({ action: 'seek', timeMin: toMin })) === null) throw new StepRefused();
          },
          setTimer: deps.setTimer,
          clearTimer: deps.clearTimer,
          onOvernight: (overnight) => {
            if (my === token) set({ status: 'running', overnight, ...target });
          },
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
    pause() {
      if (state.status !== 'running') return false;
      const { shipmentId, runId } = state;
      halt();
      set({ status: 'paused', shipmentId, runId });
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
 * a new run resets the player; the server clock switching to playing (in another tab) pauses it.
 * A journey started on a playing clock is not paused by that: it pauses the clock itself.
 */
export function syncJourneyPlayer(player: JourneyPlayer, prev: PlaySync | null, now: PlaySync): void {
  const s = player.state();
  if (s.status === 'idle') return;
  if (s.shipmentId !== now.shipmentId || s.runId !== now.runId) {
    player.reset();
    return;
  }
  if (now.clockPlaying && !(prev?.clockPlaying ?? false)) player.pause();
}

// ---------- The one Play/Pause button ----------
export type PlayButtonInput = {
  /** A package is picked (journey mode), whatever its state. */
  packagePicked: boolean;
  /** The picked package's journey; null while it is pending or when it is not in the run. */
  journey: JourneyResult | null;
  play: PlayState;
  clock: Pick<Clock, 'playing' | 'timeMin'>;
  /** A control other than a seek is open (the data hook's `busy`). */
  busy: boolean;
  /** The minute the run ends; at or past it the clock has nothing left to play. */
  simEndMin: number;
};

/**
 * What the one button shows and does. Anything moving reads Pause: a running journey first, then
 * a playing server clock. Otherwise Play: the picked package's journey, or with no package the
 * server clock. An unmatched package has nothing to play, and a finished run needs Back to start.
 */
export function playButtonView({ packagePicked, journey, play, clock, busy, simEndMin }: PlayButtonInput): PlayButtonView {
  if (play.status === 'running') return { label: PAUSE_LABEL, action: 'pause_journey', note: null };
  if (clock.playing) {
    return busy ? { label: PAUSE_LABEL, action: null, note: BUSY_REASON } : { label: PAUSE_LABEL, action: 'pause_clock', note: null };
  }
  if (packagePicked) {
    if (journey?.kind === 'journey') return { label: PLAY_LABEL, action: 'play_journey', note: null };
    return { label: PLAY_LABEL, action: null, note: journey?.kind === 'unmatched' ? NO_JOURNEY_TEXT : null };
  }
  if (busy) return { label: PLAY_LABEL, action: null, note: BUSY_REASON };
  if (isRunFinished(clock, simEndMin)) return { label: PLAY_LABEL, action: null, note: FINISHED_REASON };
  return { label: PLAY_LABEL, action: 'play_clock', note: null };
}

// ---------- The overnight card ----------

/** The business where a relay's package waits for the night, by name; null for a direct journey. */
export function relayPointName(journey: Journey): string | null {
  const stop = journey.steps.find((s) => s.kind === 'hub_drop') ?? journey.steps.find((s) => s.kind === 'hub_pickup');
  return stop ? stop.placeName : null;
}

/** "Overnight at <relay business name>" while the card is up; null otherwise. */
export function overnightText(journey: JourneyResult | null, play: PlayState): string | null {
  if (journey?.kind !== 'journey' || play.status !== 'running' || !play.overnight) return null;
  return `Overnight at ${relayPointName(journey) ?? RELAY_FALLBACK_NAME}`;
}

// ---------- The lines under the button ----------

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
export function playStatusText(journey: JourneyResult | null, play: PlayState): string {
  if (journey?.kind !== 'journey') return '';
  if (play.status === 'running' || play.status === 'finished') return stepAnnouncement(journey);
  if (play.status === 'paused') return PAUSED_TEXT;
  return '';
}

/** The error under the button after a failed step: the hook's message, or a fixed sentence. */
export function playErrorText(play: PlayState, actionError: string | null): string | null {
  if (play.status !== 'failed') return null;
  return actionError ? `Play stopped: ${actionError}` : PLAY_FAILED_TEXT;
}
