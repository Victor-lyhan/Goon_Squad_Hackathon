// Pure helpers for the simulator's one Play/Pause button and "Back to start" (#648, DECISIONS
// pass 63). No React, no DOM: tested in Node (tests/ui/sim-v2-left-model.test.ts).
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import type { Clock } from '../../../../../../shared/v2/types';

// ---------- Copy ----------
export const PLAY_LABEL = 'Play';
export const PAUSE_LABEL = 'Pause';
export const RESET_LABEL = 'Back to start';
export const BUSY_REASON = 'Waiting for the last control to finish.';
export const FINISHED_REASON = 'Run finished. Use Back to start to watch again.';

// ---------- The button ----------

/** What a press of the one button does: the picked package's journey, or the server clock. */
export type PlayAction = 'play_journey' | 'pause_journey' | 'play_clock' | 'pause_clock';

export type PlayButtonView = {
  label: typeof PLAY_LABEL | typeof PAUSE_LABEL;
  /** null = the button is disabled. */
  action: PlayAction | null;
  /** Shown under the button: why it is disabled. */
  note: string | null;
};

// ---------- The server clock: one fixed speed ----------

/** Simulated minutes per real second of the server clock, the only speed the page plays at. */
export const PLAY_SPEED: Clock['speed'] = 120;

/**
 * The requests Play sends with no package picked, in order: the fixed speed first when the clock
 * is at another one (a run left at 30 or 600 by an older page), then play.
 */
export function playClockRequests(clock: Pick<Clock, 'speed'>): SimControlRequest[] {
  const play: SimControlRequest = { action: 'play' };
  return clock.speed === PLAY_SPEED ? [play] : [{ action: 'speed', speed: PLAY_SPEED }, play];
}

export const PAUSE_REQUEST: SimControlRequest = { action: 'pause' };
/** "Back to start": the clock goes to the start of the run, paused. */
export const RESET_REQUEST: SimControlRequest = { action: 'reset_playback' };

export type SimWindow = { simStartMin: number; simEndMin: number };

/** The clock is at the end of the run: Play has nothing left, Back to start watches it again. */
export function isRunFinished(clock: Pick<Clock, 'timeMin'>, w: SimWindow): boolean {
  return clock.timeMin >= w.simEndMin;
}

/** Why "Back to start" is disabled, or null. */
export const resetDisabledReason = (busy: boolean): string | null => (busy ? BUSY_REASON : null);
