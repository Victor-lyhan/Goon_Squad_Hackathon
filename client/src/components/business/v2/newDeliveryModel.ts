// Pure model for the MVP II "New delivery" form (Business workspace). No React, no fetch: tested in Node.
// The form never decides whether a package matches; it only shapes the request and reports the server's answer.
import { CreateShipmentRequest } from '../../../../../shared/v2/schemas';
import type { ShipmentResponse, TravelUnavailable } from '../../../../../shared/v2/api';
import type { NetworkBusiness, PackageCategory } from '../../../../../shared/v2/types';
import { DEFAULT_WINDOW, dayTimeToMin, parseWeightKg, type TimeWindow } from '../shipmentFormModel';

export { DEFAULT_WINDOW, type TimeWindow };

const DAY = 1440;

/** What the user has typed. Strings for inputs; weight in kg; ready time is always on Day 1. */
export type NewDeliveryDraft = {
  recipientId: string;
  label: string;
  category: PackageCategory;
  weightKg: string;
  description: string;
  pickupInstructions: string;
  dropoffInstructions: string;
  readyTime: string; // HH:MM on Day 1
  deadlineDay: 1 | 2;
  deadlineTime: string; // HH:MM
};

/** Draft fields that can carry an inline error, in the order they appear on screen (first one gets focus). */
export const DRAFT_FIELDS = [
  'recipientId', 'label', 'category', 'weightKg', 'description',
  'pickupInstructions', 'dropoffInstructions', 'readyTime', 'deadlineDay', 'deadlineTime',
] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];
export type FieldErrors = Partial<Record<DraftField, string>>;

/** Ready Day 1 16:00, deliver by Day 2 10:00 (the same defaults as MVP 1). */
export function emptyDraft(): NewDeliveryDraft {
  return {
    recipientId: '',
    label: '',
    category: 'envelope',
    weightKg: '0.5',
    description: '',
    pickupInstructions: '',
    dropoffInstructions: '',
    readyTime: '16:00',
    deadlineDay: 2,
    deadlineTime: '10:00',
  };
}

export type RecipientOption = { id: string; label: string };

/** Every other network business as "name · neighborhood", sorted by name. */
export function recipientOptions(businesses: NetworkBusiness[], originId: string): RecipientOption[] {
  return businesses
    .filter((b) => b.id !== originId)
    .map((b) => ({ id: b.id, label: b.neighborhood ? `${b.name} · ${b.neighborhood}` : b.name, name: b.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map(({ id, label }) => ({ id, label }));
}

const readyMinOf = (d: NewDeliveryDraft) => dayTimeToMin(1, d.readyTime);
const deadlineMinOf = (d: NewDeliveryDraft) => dayTimeToMin(d.deadlineDay, d.deadlineTime);

function rawRequest(draft: NewDeliveryDraft, originId: string, clientRequestId: string) {
  const w = parseWeightKg(draft.weightKg);
  return {
    clientRequestId,
    originBusinessId: originId,
    destinationBusinessId: draft.recipientId,
    label: draft.label.trim(),
    category: draft.category,
    description: draft.description.trim(),
    weightKg: 'kg' in w ? w.kg : NaN,
    readyMin: readyMinOf(draft),
    deadlineMin: deadlineMinOf(draft),
    pickupInstructions: draft.pickupInstructions.trim(),
    dropoffInstructions: draft.dropoffInstructions.trim(),
  };
}

/**
 * The API request. Weight is rounded to whole grams (sent as kg, which is what the contract carries);
 * times are minutes since Day 1 00:00. Call validate() first; this does not check anything.
 */
export function toRequest(draft: NewDeliveryDraft, originId: string, clientRequestId: string): CreateShipmentRequest {
  return rawRequest(draft, originId, clientRequestId) as CreateShipmentRequest;
}

function clock(min: number): string {
  const m = ((min % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const dayTime = (min: number) => `Day ${Math.floor(min / DAY) + 1} ${clock(min)}`;

/**
 * One message per field (empty object = valid). Uses CreateShipmentRequest from shared/v2/schemas plus the
 * MVP 1 form rules: deliver-by after ready, both inside the simulation window, ready on Day 1.
 */
export function validate(
  draft: NewDeliveryDraft,
  originId = '',
  window: TimeWindow = DEFAULT_WINDOW,
): FieldErrors {
  const errors: FieldErrors = {};
  const raw = rawRequest(draft, originId || 'origin', 'validate');
  // A bad weight is reported by parseWeightKg; give zod a placeholder so the other refinements still run.
  const res = CreateShipmentRequest.safeParse(Number.isNaN(raw.weightKg) ? { ...raw, weightKg: 1 } : raw);
  const keyFor: Record<string, DraftField> = {
    destinationBusinessId: 'recipientId', label: 'label', category: 'category', description: 'description',
    weightKg: 'weightKg', readyMin: 'readyTime', deadlineMin: 'deadlineTime',
    pickupInstructions: 'pickupInstructions', dropoffInstructions: 'dropoffInstructions',
  };
  for (const issue of res.success ? [] : res.error.issues) {
    const key = keyFor[String(issue.path[0] ?? '')];
    if (key && !(key in errors)) errors[key] = issue.message;
  }

  if (draft.recipientId === '') errors.recipientId = 'Choose a recipient business';
  if (errors.category) errors.category = 'Choose envelope or small box';
  const w = parseWeightKg(draft.weightKg);
  if ('error' in w) errors.weightKg = w.error;
  else delete errors.weightKg;

  const ready = readyMinOf(draft);
  const deadline = deadlineMinOf(draft);
  const readyEnd = Math.min(window.endMin, DAY - 1);
  if (Number.isNaN(ready)) errors.readyTime = 'Enter a ready time as HH:MM';
  else if (ready < window.startMin || ready > readyEnd) {
    errors.readyTime = `Ready time must be between ${dayTime(window.startMin)} and ${dayTime(readyEnd)}`;
  } else delete errors.readyTime;

  if (draft.deadlineDay !== 1 && draft.deadlineDay !== 2) errors.deadlineDay = 'Choose Day 1 or Day 2';
  if (Number.isNaN(deadline)) errors.deadlineTime = 'Enter a deliver-by time as HH:MM';
  else if (deadline < window.startMin || deadline > window.endMin) {
    errors.deadlineTime = `Deliver-by time must be between ${dayTime(window.startMin)} and ${dayTime(window.endMin)}`;
  } else if (!Number.isNaN(ready) && deadline <= ready) {
    errors.deadlineTime = 'Deliver-by must be after ready time';
  } else delete errors.deadlineTime;

  return errors;
}

/** The first field with an error, in screen order (this one gets focus on submit). */
export function firstInvalidField(errors: FieldErrors): DraftField | null {
  return DRAFT_FIELDS.find((f) => errors[f]) ?? null;
}

// ---------- Submit state ----------

export type UnavailableCode = TravelUnavailable['code'];
const UNAVAILABLE_CODES: readonly UnavailableCode[] = ['google_key_missing', 'travel_data_missing', 'google_unavailable'];

export type SubmitStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'matched'; shipmentId: string }
  | { kind: 'unmatched'; shipmentId: string; reason: string | null }
  | { kind: 'locked' }
  | { kind: 'unavailable'; code: UnavailableCode }
  | { kind: 'error'; message: string; fieldErrors: FieldErrors };

/** `clientRequestId` is kept across failed attempts (a retry is the same request) and replaced after a success. */
export type SubmitState = { status: SubmitStatus; clientRequestId: string };

export type SubmitAction =
  | { type: 'submit' }
  | { type: 'success'; response: ShipmentResponse; nextRequestId: string }
  | { type: 'failure'; error: unknown }
  | { type: 'dismiss' };

export function initialSubmitState(clientRequestId: string): SubmitState {
  return { status: { kind: 'idle' }, clientRequestId };
}

const SERVER_KEYS: Record<string, DraftField> = {
  destinationBusinessId: 'recipientId', label: 'label', category: 'category', weightKg: 'weightKg',
  description: 'description', readyMin: 'readyTime', deadlineMin: 'deadlineTime',
  pickupInstructions: 'pickupInstructions', dropoffInstructions: 'dropoffInstructions',
};

/** Server field errors (contract keys) -> draft fields. Keys without an inline slot are dropped (the message covers them). */
export function mapServerFieldErrors(fieldErrors: Record<string, string> | undefined): FieldErrors {
  const out: FieldErrors = {};
  for (const [key, msg] of Object.entries(fieldErrors ?? {})) {
    const f = SERVER_KEYS[key];
    if (f && typeof msg === 'string' && !(f in out)) out[f] = msg;
  }
  return out;
}

/** Classifies a rejected onSubmit (an ApiRequestError from client/src/api, or anything else). */
export function statusForError(error: unknown): SubmitStatus {
  const e = (error ?? {}) as { status?: unknown; code?: unknown; fieldErrors?: Record<string, string>; message?: unknown };
  if (e.status === 409) return { kind: 'locked' };
  if (e.status === 503 && UNAVAILABLE_CODES.includes(e.code as UnavailableCode)) {
    return { kind: 'unavailable', code: e.code as UnavailableCode };
  }
  const message = typeof e.message === 'string' && e.message.trim() ? e.message : 'The request failed. Please try again.';
  return { kind: 'error', message, fieldErrors: e.status === 400 ? mapServerFieldErrors(e.fieldErrors) : {} };
}

export function submitReducer(state: SubmitState, action: SubmitAction): SubmitState {
  switch (action.type) {
    case 'submit':
      return { ...state, status: { kind: 'submitting' } };
    case 'success': {
      const { response } = action;
      const shipmentId = response.shipment.id;
      const status: SubmitStatus = response.matched
        ? { kind: 'matched', shipmentId }
        : { kind: 'unmatched', shipmentId, reason: response.unmatchedReason?.trim() || null };
      return { status, clientRequestId: action.nextRequestId };
    }
    case 'failure':
      return { ...state, status: statusForError(action.error) };
    case 'dismiss':
      return { ...state, status: { kind: 'idle' } };
    default:
      return state;
  }
}

// ---------- Copy ----------

export const RESULT_COPY = {
  matched: 'Delivery arranged.',
  unmatched: 'No matching commute yet.',
  locked: 'The simulation has started, so new requests are closed until the next planning cycle.',
  unavailable: 'Travel data is not available on the server, so this request could not be matched. Nothing was saved.',
} as const;

/** After a matched result the form starts a fresh package (recipient kept); otherwise the typed draft stays. */
export function draftAfterResult(draft: NewDeliveryDraft, status: SubmitStatus): NewDeliveryDraft {
  return status.kind === 'matched' ? { ...emptyDraft(), recipientId: draft.recipientId } : draft;
}
