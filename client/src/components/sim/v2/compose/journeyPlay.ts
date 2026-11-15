// The journey side of the simulator's one Play/Pause button (#496, #648; DECISIONS pass 45, 46, 63).
// With a package picked, Play steps the server clock with the data hook's `seek` over the windows
// of the journey plan (journeyModel `playPlan`): one window per carrier, its whole commute (#761:
// leaving work to home in the evening, leaving home to work in the morning). Every 500 ms one step:
// 2 simulated minutes around the package, 4 on the rest of the commute; one jump to the first
// departure, and the card "Overnight at <relay point>" for about 1 s in place of the night.
// Pause keeps the clock where it is; Play again goes on from there. The step rule and the
// timer loop are `startJourneyPlayback` (motion/); this file adds the page's play, pause and copy.
//
// #790 (docs/mvp4.md F2): with no package picked the same player plays the whole network the same way
// (`shipmentId: null`). Its windows are every plan leg's commute (`networkWindows`), merged where they
// overlap; the quiet gaps inside an evening or a morning are one jump, the night is the overnight card,
// and a last jump lands on the end of the run. It starts from the clock's minute, so Play after Pause
// goes on in place. It sends only seeks: no `play`, no `speed`, so it never locks the run.
//
// No React, no DOM, tested in Node with fake timers. The server decides every position and status;
// the browser only chooses the next minute to seek to.
import type { SimulatorResponse } from '../../../../../../shared/v2/api';
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import type { Clock } from '../../../../../../shared/v2/types';
import {
  BUSY_REASON, FINISHED_REASON, PAUSE_LABEL, PLAY_LABEL, isRunFinished, type PlayButtonView,
} from '../controls/controlsModel';
import {
  JOURNEY_COMMUTE_STEP_MIN, journeyEndMin, startJourneyPlayback, type JourneyWindow,
} from '../motion/journeyPlayback';
import { playPlan, type Journey, type JourneyResult } from '../journey/journeyModel';

// ---------- Copy ----------
export { PAUSE_LABEL, PLAY_LABEL };
export const NO_JOURNEY_TEXT = 'No journey to play: this package has no match yet.';
export const PAUSED_TEXT = 'Journey paused.';
export const PLAY_FAILED_TEXT = 'Play stopped: the simulator did not accept a step.';
export const RELAY_FALLBACK_NAME = 'the relay point';
export const NETWORK_PLAYING_TEXT = "Playing every carrier's commute.";
export const NETWORK_PAUSED_TEXT = 'Paused.';
export const NETWORK_FINISHED_TEXT = 'Every commute played.';
export const NETWORK_OVERNIGHT_TEXT = 'Overnight: skipping to the morning commute';

// ---------- State ----------
/** `shipmentId: null` is network Play (no package picked, #790). */
type Target = { shipmentId: string | null; runId: string };

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
  playPlan(journey).windows.map(({ startMin, endMin, carryStartMin, carryEndMin }) => ({ startMin, endMin, carryStartMin, carryEndMin }));

// ---------- Network Play (no package picked, #790) ----------

/**
 * Network Play's pace: simulated minutes per step (one step every JOURNEY_STEP_MS = 500 ms). On the real
 * NYC run this draws every carrier in at least 3 steps of its commute and plays the whole network
 * (Back to start to the end) in under 60 s (tests/ui/sim-v2-f2-network-play-real.test.ts).
 */
export const NETWORK_STEP_MIN = JOURNEY_COMMUTE_STEP_MIN;

type Span = { startMin: number; endMin: number };
const MIN_PER_DAY = 1440;
const dayOf = (min: number) => Math.floor(min / MIN_PER_DAY);

/**
 * Network Play's windows: one per plan leg, from one minute before its carrier's trip `departureMin`
 * to the leg's `finishMin` (read from the response's `trips` and `plans`; a leg whose trip is missing
 * starts at its first stop), merged where they overlap. A gap inside one day is a plain jump
 * (`nightBefore: false`); a gap into the next day (the evening to the morning) is the night, with the
 * overnight card. When `endMin` (the end of the run) is later than the last window, one more jump lands there,
 * so the button reads "Run finished" when Play is done. Every step is NETWORK_STEP_MIN (the first step
 * of a window is one minute, onto the first departure). The browser only picks minutes to seek to.
 */
export function networkWindows(sim: Pick<SimulatorResponse, 'plans' | 'trips'>, endMin: number): JourneyWindow[] {
  const trips = new Map((sim.trips ?? []).map((t) => [t.id, t]));
  const spans: Span[] = sim.plans.flatMap((plan) => plan.legs.map((leg): Span => {
    const trip = trips.get(leg.tripId);
    const from = trip ? trip.departureMin : leg.stops[0]?.arrivalMin ?? leg.finishMin;
    return { startMin: from - 1, endMin: Math.max(leg.finishMin, from) };
  })).filter((w) => Number.isFinite(w.startMin) && Number.isFinite(w.endMin)).sort((a, b) => a.startMin - b.startMin);

  const merged: Span[] = [];
  for (const w of spans) {
    const last = merged[merged.length - 1];
    if (last && w.startMin <= last.endMin) last.endMin = Math.max(last.endMin, w.endMin);
    else merged.push({ ...w });
  }
  // `carryStartMin = carryEndMin = endMin`: no part of a window is slowed down for a package.
  const windows: JourneyWindow[] = merged.map((w, i) => ({
    startMin: w.startMin,
    endMin: w.endMin,
    carryStartMin: w.endMin,
    carryEndMin: w.endMin,
    nightBefore: i > 0 && dayOf(w.startMin) > dayOf(merged[i - 1].endMin),
  }));
  if (Number.isFinite(endMin) && endMin > journeyEndMin(windows)) {
    windows.push({ startMin: endMin, endMin, nightBefore: false });
  }
  return windows;
}

/**
 * Where Play starts. After a pause it goes on from the clock's time (also when a timeline step
 * moved the clock meanwhile); otherwise, and once the clock is at the end of the journey, from the
 * start, so a judge sees the first carrier leave, the sender, the relay point and the recipient.
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
      // shipmentId null: network Play (#790); the same steps, windows and stop rules.
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

/** What the page sees after a render, for `syncJourneyPlayer` (`shipmentId` null: no package picked). */
export type PlaySync = { shipmentId: string | null; runId: string | null; clockPlaying: boolean };

/**
 * Run by the page after each render that changes `now`. Another package, another selection kind or
 * a new run resets the player (so picking a package stops network Play); the server clock switching to playing (in another tab) pauses it.
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
 * What the one button shows and does. Anything moving reads Pause: a running journey or network Play
 * first, then a server clock playing on its own. Otherwise Play: the picked package's journey, or with
 * no package every carrier's commute (`play_network`, #790). An unmatched package has nothing to play,
 * and a finished run needs Back to start.
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
  return { label: PLAY_LABEL, action: 'play_network', note: null };
}

// ---------- The overnight card ----------

/** The business where a relay's package waits for the night, by name; null for a direct journey. */
export function relayPointName(journey: Journey): string | null {
  const stop = journey.steps.find((s) => s.kind === 'hub_drop') ?? journey.steps.find((s) => s.kind === 'hub_pickup');
  return stop ? stop.placeName : null;
}

/**
 * "Overnight at <relay business name>" while the card is up; NETWORK_OVERNIGHT_TEXT for network Play
 * (several relay points); null otherwise.
 */
export function overnightText(journey: JourneyResult | null, play: PlayState): string | null {
  if (play.status !== 'running' || !play.overnight) return null;
  if (play.shipmentId === null) return NETWORK_OVERNIGHT_TEXT;
  if (journey?.kind !== 'journey') return null;
  return `Overnight at ${relayPointName(journey) ?? RELAY_FALLBACK_NAME}`;
}

// ---------- The lines under the button ----------

/** Where the delivering carrier is after the delivery, for the step line while Play still runs (#780). */
const AFTER_DELIVERY_TEXT: Record<NonNullable<Journey['endOfCommute']> | 'unknown', { driving: string; arrived: string }> = {
  home: { driving: 'is heading home', arrived: 'is home' },
  work: { driving: 'is heading to work', arrived: 'is at work' },
  unknown: { driving: 'is finishing the commute', arrived: 'has finished the commute' },
};

/**
 * The step line: which step the package is heading for, read from the timeline (the server's
 * occurred events). Its text changes only when a step changes, so a screen reader hears each step
 * once, not each seek. Once every step is done it reads "Journey complete", except while Play still
 * runs (`playing`): the carrier then drives on to the end of its commute, so the line says the package
 * was delivered and the carrier is heading home (or to work), or is there once the polled clock
 * (`clockMin`) reaches the leg's `finishMin` (#780).
 */
export function stepAnnouncement(journey: Journey, playing = false, clockMin = -Infinity): string {
  const total = journey.steps.length;
  const current = journey.steps.find((s) => s.state === 'current');
  if (current) return `Step ${current.n} of ${total} next: ${current.label} at ${current.placeName}.`;
  const last = journey.steps[total - 1];
  if (!last) return '';
  if (playing) {
    const carrier = journey.carriers.find((c) => c.legIndex === last.legIndex)?.name ?? 'The carrier';
    const finishMin = journey.commutes.find((c) => c.legIndex === last.legIndex)?.finishMin;
    const arrived = finishMin !== undefined && clockMin >= finishMin;
    const text = AFTER_DELIVERY_TEXT[journey.endOfCommute ?? 'unknown'];
    return `${last.label} at ${last.placeName}. ${carrier} ${arrived ? text.arrived : text.driving}.`;
  }
  return `Journey complete: ${last.label} at ${last.placeName}.`;
}

/**
 * The `role="status"` line under the button. Empty when idle and after a failure (the error is an alert).
 * `clockMin`: the polled clock, so the line after the delivery can tell driving on from arrived.
 */
export function playStatusText(journey: JourneyResult | null, play: PlayState, clockMin = -Infinity): string {
  if (play.status !== 'idle' && play.shipmentId === null) return networkStatusText(play);
  if (journey?.kind !== 'journey') return '';
  if (play.status === 'running') return stepAnnouncement(journey, true, clockMin);
  if (play.status === 'finished') return stepAnnouncement(journey);
  if (play.status === 'paused') return PAUSED_TEXT;
  return '';
}

/** Network Play's status line (#790): one fixed sentence per state, so a screen reader hears it once, not each seek. */
function networkStatusText(play: PlayState): string {
  switch (play.status) {
    case 'running': return NETWORK_PLAYING_TEXT;
    case 'paused': return NETWORK_PAUSED_TEXT;
    case 'finished': return NETWORK_FINISHED_TEXT;
    default: return '';
  }
}

/** The error under the button after a failed step: the hook's message, or a fixed sentence. */
export function playErrorText(play: PlayState, actionError: string | null): string | null {
  if (play.status !== 'failed') return null;
  return actionError ? `Play stopped: ${actionError}` : PLAY_FAILED_TEXT;
}
