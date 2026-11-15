// MVP II commute form model (docs/mvp2-ui-redesign.md §2 "Workspaces → Employee").
// Pure: owns the draft, the poll-safe reset rule (DECISIONS pass 43), validation and the request.
import type { CommuteResponse, TravelUnavailable } from '../../../../../shared/v2/api';
import { PutCommuteRequest } from '../../../../../shared/v2/schemas';
import type { Employee, Home, Phase } from '../../../../../shared/v2/types';
import { ownSentence } from './errorWording';

export const DAY_MIN = 1440;
export const MAX_DETOUR_MIN = 30;

export type DraftHome =
  | { kind: 'saved'; homeId: string; neighborhood: string }
  | { kind: 'new'; neighborhood: string; lat: number; lng: number };

/** Time and detour fields are null while the input is empty or unparsable. */
export type Draft = {
  businessId: string;
  home: DraftHome;
  eveningDepartureMin: number | null;
  morningDepartureMin: number | null;
  availableEvening: boolean;
  availableMorning: boolean;
  maxExtraMin: number | null;
};

/** What the server last said: the employee and their home. */
export type SavedCommute = { employee: Employee; home: Home };

export function draftFromSaved(employee: Employee, home: Home): Draft {
  return {
    businessId: employee.businessId,
    home: { kind: 'saved', homeId: home.id, neighborhood: home.neighborhood },
    eveningDepartureMin: employee.eveningDepartureMin,
    morningDepartureMin: employee.morningDepartureMin,
    availableEvening: employee.availableEvening,
    availableMorning: employee.availableMorning,
    maxExtraMin: employee.maxExtraMin,
  };
}

function sameHome(a: DraftHome, b: DraftHome): boolean {
  if (a.kind === 'saved' && b.kind === 'saved') return a.homeId === b.homeId && a.neighborhood === b.neighborhood;
  if (a.kind === 'new' && b.kind === 'new') return a.lat === b.lat && a.lng === b.lng && a.neighborhood === b.neighborhood;
  return false;
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.businessId === b.businessId &&
    sameHome(a.home, b.home) &&
    a.eveningDepartureMin === b.eveningDepartureMin &&
    a.morningDepartureMin === b.morningDepartureMin &&
    a.availableEvening === b.availableEvening &&
    a.availableMorning === b.availableMorning &&
    a.maxExtraMin === b.maxExtraMin
  );
}

export function isDirty(draft: Draft, saved: SavedCommute): boolean {
  return !sameDraft(draft, draftFromSaved(saved.employee, saved.home));
}

/**
 * Pass 43: a poll that brings equal saved values keeps what the user is typing.
 * The draft resets only when the employee ID changes or the saved server values change.
 */
export function nextDraft(current: Draft | null, prevSaved: SavedCommute | null, nextSaved: SavedCommute): Draft {
  const fresh = draftFromSaved(nextSaved.employee, nextSaved.home);
  if (!current || !prevSaved) return fresh;
  if (prevSaved.employee.id !== nextSaved.employee.id) return fresh;
  if (!sameDraft(draftFromSaved(prevSaved.employee, prevSaved.home), fresh)) return fresh;
  return current;
}

// ---------- Time helpers (input type="time" uses HH:MM) ----------

const pad = (n: number) => String(n).padStart(2, '0');

/** Minutes (any day) -> "HH:MM" clock time; null or non-finite -> "". */
export function minToTimeInput(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return '';
  const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** "HH:MM" (or "HH:MM:SS") -> minutes within a day, or null. */
export function timeInputToClockMin(value: string): number | null {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** Evening departure on Day 1: 0–1439. */
export const eveningFromTimeInput = (value: string): number | null => timeInputToClockMin(value);

/** Morning departure on Day 2: 1440–2879 (08:30 -> 1950). */
export function morningFromTimeInput(value: string): number | null {
  const m = timeInputToClockMin(value);
  return m === null ? null : m + DAY_MIN;
}

/** Number input value -> whole minutes, or null when empty or not a number. */
export function parseMinutes(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------- Validation and request ----------

export type FieldKey =
  | 'businessId' | 'home' | 'eveningDepartureMin' | 'morningDepartureMin'
  | 'availableEvening' | 'availableMorning' | 'maxExtraMin';
export type FieldErrors = Partial<Record<FieldKey, string>>;

const FIELD_MESSAGES: Record<FieldKey, string> = {
  businessId: 'Choose a workplace.',
  home: 'Choose a home.',
  eveningDepartureMin: 'Enter an evening departure time.',
  morningDepartureMin: 'Enter a morning departure time.',
  availableEvening: 'Choose whether you are available in the evening.',
  availableMorning: 'Choose whether you are available in the morning.',
  maxExtraMin: `Maximum detour must be a whole number from 0 to ${MAX_DETOUR_MIN} minutes.`,
};

export type ToRequestResult =
  | { ok: true; request: PutCommuteRequest }
  | { ok: false; errors: FieldErrors };

export function toRequest(draft: Draft): ToRequestResult {
  const home =
    draft.home.kind === 'saved'
      ? { homeId: draft.home.homeId }
      : { lat: draft.home.lat, lng: draft.home.lng, neighborhood: draft.home.neighborhood };
  const body = {
    businessId: draft.businessId,
    home,
    eveningDepartureMin: draft.eveningDepartureMin,
    morningDepartureMin: draft.morningDepartureMin,
    availableEvening: draft.availableEvening,
    availableMorning: draft.availableMorning,
    maxExtraMin: draft.maxExtraMin,
  };
  const parsed = PutCommuteRequest.safeParse(body);
  if (parsed.success) return { ok: true, request: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && key in FIELD_MESSAGES && !errors[key as FieldKey]) {
      errors[key as FieldKey] = FIELD_MESSAGES[key as FieldKey];
    }
  }
  if (Object.keys(errors).length === 0) errors.home = FIELD_MESSAGES.home;
  return { ok: false, errors };
}

// ---------- Save state ----------

export type UnavailableCode = TravelUnavailable['code'];

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; matched: number }
  | { status: 'locked' }
  | { status: 'unavailable'; code: UnavailableCode }
  | { status: 'error'; message: string; fieldErrors: FieldErrors };

export type SaveAction =
  | { type: 'start' }
  | { type: 'success'; response: CommuteResponse }
  | { type: 'failure'; error: unknown }
  /** A dashboard newer than the last answer arrived (a poll): `phase` is what it says. */
  | { type: 'dashboard'; phase: Phase }
  | { type: 'reset' };

export const INITIAL_SAVE_STATE: SaveState = { status: 'idle' };

const CODES: readonly UnavailableCode[] = ['google_key_missing', 'travel_data_missing', 'google_unavailable'];

/** A save that failed with no sentence of the server's own. */
export const SAVE_FAILED_TEXT = 'The commute could not be saved. Try again.';

type ErrorLike = {
  status?: unknown; message?: unknown; code?: unknown; fieldErrors?: unknown;
  body?: { code?: unknown; error?: unknown; fieldErrors?: unknown } | null;
};

/** Reads an error thrown by onSave. Duck-typed: works with ApiRequestError and the v2 client (#344). */
export function classifySaveError(error: unknown): SaveState {
  const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike;
  const status = typeof e.status === 'number' ? e.status : null;
  if (status === 409) return { status: 'locked' };
  const code = e.code ?? e.body?.code;
  if (status === 503 && typeof code === 'string' && (CODES as readonly string[]).includes(code)) {
    return { status: 'unavailable', code: code as UnavailableCode };
  }
  // A sentence the server wrote is shown as it is; the HTTP client's own wording never is (#916).
  const rawMessage = ownSentence(e.message) || ownSentence(e.body?.error) || ownSentence(error);
  const message = rawMessage || SAVE_FAILED_TEXT;
  const rawFields = e.fieldErrors ?? e.body?.fieldErrors;
  const fieldErrors: FieldErrors = {};
  if (rawFields && typeof rawFields === 'object') {
    for (const [k, v] of Object.entries(rawFields as Record<string, unknown>)) {
      const key = k.split('.')[0];
      if (key in FIELD_MESSAGES && typeof v === 'string' && v) fieldErrors[key as FieldKey] = v;
    }
  }
  return { status: 'error', message, fieldErrors };
}

export function saveReducer(state: SaveState, action: SaveAction): SaveState {
  switch (action.type) {
    case 'start':
      return { status: 'saving' };
    case 'success':
      return { status: 'saved', matched: action.response.rematchedShipmentIds.length };
    case 'failure':
      return classifySaveError(action.error);
    case 'dashboard':
      // A 409 locks the editor until the run is back in planning ("Back to start", DECISIONS pass 74).
      // The draft is not in this state, so what was typed stays.
      return state.status === 'locked' && action.phase === 'planning' ? INITIAL_SAVE_STATE : state;
    case 'reset':
      return state.status === 'idle' ? state : INITIAL_SAVE_STATE;
  }
}

// ---------- Copy ----------

/**
 * The one locked sentence of the editor (#598); the address search prints none of its own. It names the
 * way out the app has: "Back to start" on the simulator returns a locked run to planning (#734, DECISIONS
 * pass 74), as the server's 409 texts say. The button the sentence named before #720 went with MVP III (#700).
 */
export const LOCKED_MESSAGE =
  'The run is playing, so the commute is read-only until you press Back to start in the simulator.';

/** A new home cannot be saved at all right now (`google_key_missing`): the way on is the saved home. */
export const NEW_HOME_UNAVAILABLE_TEXT =
  'A new home address cannot be saved right now, so your commute is unchanged. Keep your saved home, or try again later.';
/** The travel times of the new home did not arrive this time: saving again can work. */
export const TRAVEL_TIMES_FAILED_TEXT =
  'Travel times for this address could not be loaded. Your saved commute is unchanged. Try again.';

/** The form's sentence for a 503 by its `code` (#916): what failed and what to do, never how it is set up. */
export function unavailableMessage(code: UnavailableCode): string {
  return code === 'google_key_missing' ? NEW_HOME_UNAVAILABLE_TEXT : TRAVEL_TIMES_FAILED_TEXT;
}

export function savedMessage(matched: number): string {
  if (matched <= 0) return 'Commute saved.';
  return `Commute saved. ${matched} waiting ${matched === 1 ? 'package' : 'packages'} matched.`;
}

/** Message shown for a save state, with its live-region role; null when nothing to say. */
export function saveMessage(state: SaveState, phase: 'planning' | 'locked'):
  { role: 'status' | 'alert'; text: string } | null {
  if (phase === 'locked' || state.status === 'locked') return { role: 'alert', text: LOCKED_MESSAGE };
  switch (state.status) {
    case 'saving': return { role: 'status', text: 'Saving commute…' };
    case 'saved': return { role: 'status', text: savedMessage(state.matched) };
    case 'unavailable': return { role: 'alert', text: unavailableMessage(state.code) };
    case 'error': return { role: 'alert', text: state.message };
    default: return null;
  }
}
