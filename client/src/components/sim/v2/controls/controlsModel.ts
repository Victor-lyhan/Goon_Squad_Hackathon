// Pure helpers for the MVP II simulator left-panel controls (playback, scenario, planning cycle).
// No React, no DOM: tested in Node (tests/ui/sim-v2-left-model.test.ts).
import { GenerateScenarioRequest, type SimControlRequest } from '../../../../../../shared/v2/schemas';
import type { Clock, Phase } from '../../../../../../shared/v2/types';
import { formatMin } from '../../../../ui/format';
import { MORNING_FALLBACK_MIN, toPlaybackModel } from '../../playbackModel';

// ---------- Speed ----------

export type Speed = Clock['speed'];

export type SpeedOption = { speed: Speed; label: string; title: string };

/** Short labels relative to the slowest speed; the title gives the real meaning. */
export const SPEED_OPTIONS: readonly SpeedOption[] = [
  { speed: 30, label: '1x', title: '30 simulated minutes per second' },
  { speed: 120, label: '4x', title: '120 simulated minutes per second' },
  { speed: 600, label: '20x', title: '600 simulated minutes per second' },
];

// ---------- Requests: one control, one SimControlRequest ----------

export type PlaybackAction = 'playPause' | 'nextEvent' | 'jumpToMorning' | 'finish' | 'reset';

/** The request a playback button sends. Play/Pause depends on whether the clock is playing. */
export function playbackRequest(action: PlaybackAction, clock: Pick<Clock, 'playing'>): SimControlRequest {
  switch (action) {
    case 'playPause': return { action: clock.playing ? 'pause' : 'play' };
    case 'nextEvent': return { action: 'next_event' };
    case 'jumpToMorning': return { action: 'jump_to_morning' };
    case 'finish': return { action: 'finish' };
    case 'reset': return { action: 'reset_playback' };
  }
}

export const speedRequest = (speed: Speed): SimControlRequest => ({ action: 'speed', speed });

// ---------- Scrubber: range value <-> minutes ----------

export type SimWindow = { simStartMin: number; simEndMin: number };

/**
 * The range input runs in whole simulated minutes from simStartMin to simEndMin (step 1),
 * so the value is the minute itself, clamped and rounded. Non-finite input falls back to the start.
 */
export function minToScrub(timeMin: number, w: SimWindow): number {
  if (!Number.isFinite(timeMin)) return w.simStartMin;
  return Math.min(w.simEndMin, Math.max(w.simStartMin, Math.round(timeMin)));
}

/** Reads the input's value (a string in the DOM) back to a minute inside the window. */
export function scrubToMin(raw: string | number, w: SimWindow): number {
  const n = typeof raw === 'number' ? raw : raw.trim() === '' ? Number.NaN : Number(raw);
  return minToScrub(n, w);
}

// ---------- Scrubber drag vs poll (DECISIONS pass 43) ----------

/**
 * idle: the thumb follows the polled clock.
 * dragging: the thumb shows the dragged value; polls do not move it.
 * released: a seek was sent; the thumb keeps the released value until a new Clock object
 *   (the next poll or the seek response) arrives, so it does not jump back for one frame.
 */
export type ScrubState =
  | { kind: 'idle' }
  | { kind: 'dragging'; value: number }
  | { kind: 'released'; value: number; clockAtRelease: Clock };

export const SCRUB_IDLE: ScrubState = { kind: 'idle' };

/** Value to show on the thumb. */
export function scrubShown(state: ScrubState, clock: Clock, w: SimWindow): number {
  if (state.kind === 'dragging') return state.value;
  if (state.kind === 'released' && state.clockAtRelease === clock) return state.value;
  return minToScrub(clock.timeMin, w);
}

/** Input changed (pointer move or arrow key). */
export function scrubDrag(raw: string | number, w: SimWindow): ScrubState {
  return { kind: 'dragging', value: scrubToMin(raw, w) };
}

/**
 * Pointer up / key up / blur. Returns the next state and the one seek to send
 * (null when nothing was dragged or the value equals the clock's time).
 */
export function scrubRelease(state: ScrubState, clock: Clock, w: SimWindow): { state: ScrubState; request: SimControlRequest | null } {
  if (state.kind !== 'dragging') return { state, request: null };
  if (state.value === minToScrub(clock.timeMin, w)) return { state: SCRUB_IDLE, request: null };
  return {
    state: { kind: 'released', value: state.value, clockAtRelease: clock },
    request: { action: 'seek', timeMin: state.value },
  };
}

// ---------- Playback view model ----------

export const BUSY_REASON = 'Waiting for the last control to finish.';
export const FINISHED_REASON = 'Run finished. Use Reset playback to watch again.';
export const NO_NEXT_EVENT_REASON = 'No more events in this run.';
export const PAST_MORNING_REASON = 'Already past the morning.';

export type PlaybackControlKey = 'play' | 'speed' | 'scrub' | 'nextEvent' | 'jumpToMorning' | 'finish' | 'reset';

export type PlaybackView = {
  playLabel: 'Play' | 'Pause';
  playTitle: string;
  timeLabel: string;
  finished: boolean;
  speed: Speed;
  /** Reason text for each disabled control; absent = enabled. */
  disabled: Partial<Record<PlaybackControlKey, string>>;
  /** Distinct reasons, in order, to show once under the controls. */
  reasons: string[];
};

export function toPlaybackView(
  clock: Clock,
  w: SimWindow,
  nextEventMin: number | null,
  busy = false,
  morningTargetMin: number = MORNING_FALLBACK_MIN,
): PlaybackView {
  const m = toPlaybackModel(clock, nextEventMin, w, busy, morningTargetMin);
  const why = (on: boolean, own: string): string | undefined => (busy ? BUSY_REASON : on ? own : undefined);
  const disabled: PlaybackView['disabled'] = {};
  const set = (k: PlaybackControlKey, reason: string | undefined) => { if (reason) disabled[k] = reason; };
  set('play', m.disabled.play ? why(true, FINISHED_REASON) : undefined);
  set('speed', m.disabled.speed ? BUSY_REASON : undefined);
  set('scrub', busy ? BUSY_REASON : undefined);
  set('nextEvent', m.disabled.nextEvent ? why(true, m.finished ? FINISHED_REASON : NO_NEXT_EVENT_REASON) : undefined);
  set('jumpToMorning', m.disabled.jumpToMorning ? why(true, m.finished ? FINISHED_REASON : PAST_MORNING_REASON) : undefined);
  set('finish', m.disabled.finish ? why(true, FINISHED_REASON) : undefined);
  set('reset', m.disabled.reset ? BUSY_REASON : undefined);
  const reasons = [...new Set(Object.values(disabled).filter((r): r is string => !!r))];
  return {
    playLabel: m.playLabel,
    playTitle: clock.playing
      ? 'Pause the simulation'
      : clock.phase === 'planning' ? 'Play the simulation. This locks the run for planning.' : 'Resume the simulation',
    timeLabel: formatMin(minToScrub(clock.timeMin, w)),
    finished: m.finished,
    speed: m.speed,
    disabled,
    reasons,
  };
}

export const formatScrub = (min: number): string => formatMin(min);

// ---------- Scenario form ----------

export type ScenarioField = 'seed' | 'employees' | 'packages' | 'maxExtraMin';
export const SCENARIO_FIELDS: readonly ScenarioField[] = ['seed', 'employees', 'packages', 'maxExtraMin'];

export type ScenarioForm = { preset: 'demo' | 'random' } & Record<ScenarioField, string>;

/** Labels and input ranges. The ranges mirror GenerateScenarioRequest; a test keeps them in sync. */
export const SCENARIO_FIELD_INFO: Record<ScenarioField, { label: string; min?: number; max?: number }> = {
  seed: { label: 'Seed' },
  employees: { label: 'Employees', min: 10, max: 120 },
  packages: { label: 'Packages', min: 5, max: 60 },
  maxExtraMin: { label: 'Detour limit (min)', min: 0, max: 30 },
};

export const PRESET_OPTIONS: readonly { value: ScenarioForm['preset']; label: string }[] = [
  { value: 'demo', label: 'Demo' },
  { value: 'random', label: 'Random' },
];

export const DEMO_PACKAGES_NOTE = 'Demo keeps the story’s packages; the Packages count applies to Random.';

export function rangeText(f: ScenarioField): string {
  const r = SCENARIO_FIELD_INFO[f];
  return r.min === undefined || r.max === undefined ? 'Whole number' : `${r.min} to ${r.max}`;
}

const num = (n: unknown): string => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '');

export function toScenarioForm(v: GenerateScenarioRequest): ScenarioForm {
  return {
    preset: v.preset === 'random' ? 'random' : 'demo',
    seed: num(v.seed), employees: num(v.employees), packages: num(v.packages), maxExtraMin: num(v.maxExtraMin),
  };
}

export function sameScenario(a: GenerateScenarioRequest, b: GenerateScenarioRequest): boolean {
  return a.preset === b.preset && SCENARIO_FIELDS.every((f) => Object.is(a[f], b[f]));
}

/**
 * Local form state plus the server value it was built from. A poll with an equal value keeps
 * the typed text (DECISIONS pass 43); a changed server value (a new city) resets the form.
 */
export type ScenarioFormState = { base: GenerateScenarioRequest; form: ScenarioForm };

export const initScenarioState = (value: GenerateScenarioRequest): ScenarioFormState => ({ base: value, form: toScenarioForm(value) });

/** Returns the same object when nothing changed, so React can skip the update. */
export function syncScenarioState(state: ScenarioFormState, value: GenerateScenarioRequest): ScenarioFormState {
  return sameScenario(state.base, value) ? state : initScenarioState(value);
}

const NUMBER_TEXT = /^[+-]?\d+(\.\d+)?$/;

export type ScenarioValidation =
  | { ok: true; request: GenerateScenarioRequest; errors: Partial<Record<ScenarioField, string>> }
  | { ok: false; request?: undefined; errors: Partial<Record<ScenarioField, string>> };

/** Validates with the shared Zod schema; error text is the schema's own message for the field. */
export function validateScenario(form: ScenarioForm): ScenarioValidation {
  const raw: Record<string, unknown> = { preset: form.preset };
  for (const f of SCENARIO_FIELDS) {
    const t = form[f].trim();
    raw[f] = NUMBER_TEXT.test(t) ? Number(t) : Number.NaN;
  }
  const parsed = GenerateScenarioRequest.safeParse(raw);
  if (parsed.success) return { ok: true, request: parsed.data, errors: {} };
  const errors: Partial<Record<ScenarioField, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as ScenarioField;
    if (SCENARIO_FIELDS.includes(key) && !errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

export function generateConfirmText(phase: Phase): string {
  return phase === 'locked'
    ? 'This replaces the whole city and its packages, and ends the current run.'
    : 'This replaces the whole city and its packages.';
}

// ---------- Planning cycle ----------

export const LOCKED_RECOMPUTE_REASON = 'Playback has started. Start a new planning cycle to recompute.';
export const PLANNING_NOTE = 'Playing locks the run. Only Start new planning cycle unlocks it.';

/** Start new planning cycle is always enabled (it is the way out of a locked run). */
export type PlanningView = { phaseLabel: string; recomputeDisabled: string | null };

export function toPlanningView(phase: Phase, busy = false): PlanningView {
  return {
    phaseLabel: phase === 'locked' ? 'Locked' : 'Planning',
    recomputeDisabled: phase === 'locked' ? LOCKED_RECOMPUTE_REASON : busy ? BUSY_REASON : null,
  };
}
