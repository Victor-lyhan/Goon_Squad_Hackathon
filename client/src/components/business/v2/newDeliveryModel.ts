// Pure model for the MVP II "New delivery" form (Business workspace). No React, no fetch: tested in Node.
// The form never decides whether a package matches; it only shapes the request and reports the server's answer.
import { CreateShipmentRequest } from '../../../../../shared/v2/schemas';
import type { ShipmentResponse, ShipmentView, TravelUnavailable } from '../../../../../shared/v2/api';
import type { NetworkBusiness, PackageCategory } from '../../../../../shared/v2/types';
import { formatMin } from '../../../ui/format';
import { deliveryDetails, type DetailsLookups, type StopRow } from './deliveryDetailsModel';

const DAY = 1440;

// ---------- Helpers kept from the MVP 1 form model (same names and behaviour) ----------

function timeToMin(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 23 || mi > 59 ? NaN : h * 60 + mi;
}

/** Day + HH:MM -> minutes since Day 1 00:00 (NaN when the time is malformed). */
export function dayTimeToMin(day: number, time: string): number {
  return (day - 1) * DAY + timeToMin(time);
}

/** Default planning window (settings.simStartMin / simEndMin): Day 1 15:30 to Day 2 12:00. */
export const DEFAULT_WINDOW = { startMin: 930, endMin: 2160 } as const;
export type TimeWindow = { startMin: number; endMin: number };

/** Weight rule: kg with a dot, 0 < kg <= 2, stored as grams = round(kg * 1000) which must be >= 1. */
export function parseWeightKg(raw: string): { kg: number; grams: number } | { error: string } {
  const t = raw.trim();
  if (t === '') return { error: 'Enter a weight in kg, for example 0.5' };
  if (t.includes(',')) return { error: 'Use a dot for the decimal point, for example 1.5 kg' };
  const n = Number(t);
  if (!Number.isFinite(n)) return { error: 'Weight must be a number in kg, for example 0.5' };
  if (n <= 0) return { error: 'Weight must be above 0 kg' };
  if (n > 2) return { error: 'Max 2 kg' };
  const grams = Math.round(n * 1000);
  if (grams < 1) return { error: 'Weight is too small: the minimum is 0.001 kg (1 g)' };
  return { kg: grams / 1000, grams };
}

let requestCounter = 0;
/** Fresh id for a new request. Module-wide counter so two requests never share an id (POST is idempotent per id). */
export function newClientRequestId(originId: string): string {
  requestCounter += 1;
  return `req-${originId}-${requestCounter}-${Date.now().toString(36)}`;
}

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

/** "Day 1, 3:30 PM to Day 2, 12:00 PM": the planning window in the format of the shipments table. */
export function windowText(w: TimeWindow): string {
  return `${formatMin(w.startMin)} to ${formatMin(w.endMin)}`;
}

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
    errors.readyTime = `Ready time must be between ${formatMin(window.startMin)} and ${formatMin(readyEnd)}`;
  } else delete errors.readyTime;

  if (draft.deadlineDay !== 1 && draft.deadlineDay !== 2) errors.deadlineDay = 'Choose Day 1 or Day 2';
  if (Number.isNaN(deadline)) errors.deadlineTime = 'Enter a deliver-by time as HH:MM';
  else if (deadline < window.startMin || deadline > window.endMin) {
    errors.deadlineTime = `Deliver-by time must be between ${formatMin(window.startMin)} and ${formatMin(window.endMin)}`;
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
  /** `retry`: the pending call is "Try matching again" for a saved delivery, not a new request. */
  | { kind: 'submitting'; retry?: true }
  /** `response` is the server's answer; the result card is formatted from it (arrangedCard). */
  | { kind: 'matched'; shipmentId: string; response: ShipmentResponse }
  | { kind: 'unmatched'; shipmentId: string; reason: string | null }
  /** `message` is the server's 409 text when it sent one; the form falls back to RESULT_COPY.locked. */
  | { kind: 'locked'; message?: string }
  /** `saved`: the 503 answered a retry, so the delivery itself is already saved. */
  | { kind: 'unavailable'; code: UnavailableCode; saved?: true }
  | { kind: 'error'; message: string; fieldErrors: FieldErrors };

/** The saved delivery that found no match, with the draft it was sent from. */
export type RetryTarget = { shipmentId: string; draft: NewDeliveryDraft };

/**
 * `clientRequestId` is kept across failed attempts (a retry is the same request) and replaced after a success.
 * `retryOf` is set by a no-match answer: while the draft still equals it, the button re-matches that delivery
 * (`POST /shipments/:id/match`) and never creates a second one (DECISIONS pass 60).
 */
export type SubmitState = { status: SubmitStatus; clientRequestId: string; retryOf: RetryTarget | null };

export type SubmitAction =
  | { type: 'submit' }
  | { type: 'retry' }
  /** `draft`: what was sent. `nextRequestId` comes with the answer to a new request; a retry keeps the ID. */
  | { type: 'success'; response: ShipmentResponse; nextRequestId?: string; draft?: NewDeliveryDraft }
  | { type: 'failure'; error: unknown }
  | { type: 'dismiss' };

export function initialSubmitState(clientRequestId: string): SubmitState {
  return { status: { kind: 'idle' }, clientRequestId, retryOf: null };
}

export function sameDraft(a: NewDeliveryDraft, b: NewDeliveryDraft): boolean {
  return DRAFT_FIELDS.every((f) => a[f] === b[f]);
}

/** The delivery "Try matching again" is for: set while the draft is unchanged since its no-match answer. */
export function retryShipmentId(state: SubmitState, draft: NewDeliveryDraft): string | null {
  return state.retryOf && sameDraft(state.retryOf.draft, draft) ? state.retryOf.shipmentId : null;
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
  if (e.status === 409) {
    return typeof e.message === 'string' && e.message.trim() ? { kind: 'locked', message: e.message.trim() } : { kind: 'locked' };
  }
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
    case 'retry':
      return { ...state, status: { kind: 'submitting', retry: true } };
    case 'success': {
      const { response } = action;
      const shipmentId = response.shipment.id;
      const clientRequestId = action.nextRequestId ?? state.clientRequestId;
      if (response.matched) return { status: { kind: 'matched', shipmentId, response }, clientRequestId, retryOf: null };
      return {
        status: { kind: 'unmatched', shipmentId, reason: response.unmatchedReason?.trim() || null },
        clientRequestId,
        retryOf: action.draft ? { shipmentId, draft: action.draft } : null,
      };
    }
    case 'failure': {
      const status = statusForError(action.error);
      const wasRetry = state.status.kind === 'submitting' && state.status.retry === true;
      if (!wasRetry) return { ...state, status };
      // The delivery is gone (another run): the next click is a new request, not a retry that can never work.
      if ((action.error as { status?: unknown } | null)?.status === 404) return { ...state, status, retryOf: null };
      return { ...state, status: status.kind === 'unavailable' ? { ...status, saved: true } : status };
    }
    case 'dismiss':
      return { ...state, status: { kind: 'idle' }, retryOf: null };
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
  unavailableRetry: 'Travel data is not available on the server, so matching could not run. Your request is still saved.',
} as const;

/** After a matched result the form starts a fresh package (recipient kept); otherwise the typed draft stays. */
export function draftAfterResult(draft: NewDeliveryDraft, status: Pick<SubmitStatus, 'kind'>): NewDeliveryDraft {
  return status.kind === 'matched' ? { ...emptyDraft(), recipientId: draft.recipientId } : draft;
}

// ---------- The "Delivery arranged" card ----------

export type ArrangedFact = { label: string; value: string; mono: boolean };
export type ArrangedCarrier = { key: string; name: string; tripText: string; stops: StopRow[] };

export type ArrangedCard = {
  shipmentId: string;
  /** Plan (Direct or Relay), ETA, Price and, for a relay, Relay point. Empty when the answer carries no plan. */
  facts: ArrangedFact[];
  /** One row per leg, in plan order: the carrier's name, the commute and its stops. */
  carriers: ArrangedCarrier[];
  /** The delivery details' "View journey" link. */
  simulatorHref: string;
};

/**
 * What the form shows under "Delivery arranged", formatted by the delivery details model from the server's
 * answer. Nothing is computed here: the ETA is `plan.deliveryMin`, the price `plan.customerPriceCents`.
 */
export function arrangedCard(response: ShipmentView, lookups: DetailsLookups): ArrangedCard {
  const d = deliveryDetails(response, lookups);
  const r = d.result;
  const facts: ArrangedFact[] = [];
  if (r.kind === 'matched') {
    facts.push({ label: 'Plan', value: r.planKind === 'relay' ? 'Relay' : 'Direct', mono: false });
    facts.push({ label: r.timeLabel, value: r.timeText, mono: true });
    if (r.priceText) facts.push({ label: 'Price', value: r.priceText, mono: true });
    if (r.relayPointName) facts.push({ label: 'Relay point', value: r.relayPointName, mono: false });
  }
  return {
    shipmentId: d.header.shipmentId,
    facts,
    carriers: d.legs.map((leg) => ({ key: leg.key, name: leg.carrierName, tripText: leg.tripText, stops: leg.stops })),
    simulatorHref: d.journeyHref,
  };
}
