// Pure helpers for the simulator's one Play/Pause button and "Back to start" (#648, DECISIONS
// pass 63; network Play steps with seeks since #790). No React, no DOM: tested in Node (tests/ui/sim-v2-left-model.test.ts).
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import type { Clock } from '../../../../../../shared/v2/types';

// ---------- Copy ----------
export const PLAY_LABEL = 'Play';
export const PAUSE_LABEL = 'Pause';
export const RESET_LABEL = 'Back to start';
export const BUSY_REASON = 'Waiting for the last control to finish.';
export const FINISHED_REASON = 'Run finished. Use Back to start to watch again.';

// ---------- The button ----------

/**
 * What a press of the one button does: play the picked package's journey, or with no package every
 * carrier's commute (`play_network`, #790); pause either (`pause_journey`); or pause a server clock
 * that is playing on its own (`pause_clock`).
 */
export type PlayAction = 'play_journey' | 'pause_journey' | 'play_network' | 'pause_clock';

export type PlayButtonView = {
  label: typeof PLAY_LABEL | typeof PAUSE_LABEL;
  /** null = the button is disabled. */
  action: PlayAction | null;
  /** Shown under the button: why it is disabled. */
  note: string | null;
};

// ---------- Requests ----------
// Play with no package picked steps the clock with `seek`, like a journey (#790, compose/journeyPlay.ts);
// it sends no `play` and no `speed`, so it never locks the run. A clock left playing (another tab, an older
// page) is still paused with PAUSE_REQUEST.

export const PAUSE_REQUEST: SimControlRequest = { action: 'pause' };
/** "Back to start": the clock goes to the start of the run, paused. */
export const RESET_REQUEST: SimControlRequest = { action: 'reset_playback' };

/** The clock is at the end of the run (`simEndMin`): Play has nothing left, Back to start watches it again. */
export function isRunFinished(clock: Pick<Clock, 'timeMin'>, simEndMin: number): boolean {
  return clock.timeMin >= simEndMin;
}

/** Why "Back to start" is disabled, or null. */
export const resetDisabledReason = (busy: boolean): string | null => (busy ? BUSY_REASON : null);
