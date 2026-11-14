import { CreateShipmentRequest } from '../../../../shared/schemas';
import type { PackageCategory, Shipment } from '../../../../shared/types';

const DAY = 1440;

/** Form values as typed by the user (strings for inputs; kg, not grams). */
export type FormState = {
  originBusinessId: string;
  destinationBusinessId: string;
  label: string;
  category: PackageCategory;
  description: string;
  weightKg: string;
  readyDay: 1 | 2;
  readyTime: string; // HH:MM
  deadlineDay: 1 | 2;
  deadlineTime: string; // HH:MM
  pickupInstructions: string;
  dropoffInstructions: string;
};

function timeToMin(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 23 || mi > 59 ? NaN : h * 60 + mi;
}

function minToTime(min: number): string {
  const m = ((Math.round(min) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Defaults: ready Day 1 16:00 (960), deliver by Day 2 10:00 (2040). */
export function defaultForm(): FormState {
  return {
    originBusinessId: '',
    destinationBusinessId: '',
    label: '',
    category: 'envelope',
    description: '',
    weightKg: '0.5',
    readyDay: 1,
    readyTime: '16:00',
    deadlineDay: 2,
    deadlineTime: '10:00',
    pickupInstructions: '',
    dropoffInstructions: '',
  };
}

/** Day + HH:MM -> minutes since Day 1 00:00 (NaN when the time is malformed). */
export function dayTimeToMin(day: number, time: string): number {
  return (day - 1) * DAY + timeToMin(time);
}

/** Default planning window (settings.simStartMin / simEndMin): Day 1 15:30 to Day 2 12:00. */
export const DEFAULT_WINDOW = { startMin: 930, endMin: 2160 } as const;
export type TimeWindow = { startMin: number; endMin: number };

function dayTimeLabel(min: number): string {
  return `Day ${Math.floor(min / DAY) + 1} ${minToTime(min)}`;
}

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

function rawRequest(form: FormState, clientRequestId: string) {
  return {
    clientRequestId,
    originBusinessId: form.originBusinessId,
    destinationBusinessId: form.destinationBusinessId,
    label: form.label,
    category: form.category,
    description: form.description,
    weightKg: (() => { const w = parseWeightKg(form.weightKg); return 'kg' in w ? w.kg : NaN; })(),
    readyMin: dayTimeToMin(form.readyDay, form.readyTime),
    deadlineMin: dayTimeToMin(form.deadlineDay, form.deadlineTime),
    pickupInstructions: form.pickupInstructions,
    dropoffInstructions: form.dropoffInstructions,
  };
}

/** Builds the API request. Call validate() first; this does not check anything. */
export function toRequest(form: FormState, clientRequestId: string): CreateShipmentRequest {
  return rawRequest(form, clientRequestId) as CreateShipmentRequest;
}

/** Field errors keyed by form field name (first message per field). Empty = valid. */
export function validate(form: FormState, window: TimeWindow = DEFAULT_WINDOW): Record<string, string> {
  // A bad weight is reported by parseWeightKg; give zod a placeholder so refinements (same origin, order) still run.
  const raw = rawRequest(form, 'validate');
  const res = CreateShipmentRequest.safeParse(Number.isNaN(raw.weightKg) ? { ...raw, weightKg: 1 } : raw);
  const errors: Record<string, string> = {};
  for (const issue of res.success ? [] : res.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!(key in errors)) errors[key] = issue.message;
  }
  const w = parseWeightKg(form.weightKg);
  if ('error' in w) errors.weightKg = w.error;
  if (errors.destinationBusinessId && form.destinationBusinessId === '') {
    errors.destinationBusinessId = 'Choose a destination business';
  }
  for (const k of ['readyMin', 'deadlineMin'] as const) {
    if (errors[k] && !/after/.test(errors[k])) errors[k] = 'Enter a valid day and time';
  }
  // Out-of-window times (deadline-before-ready, reported above, takes precedence on the deadline field).
  const range = `${dayTimeLabel(window.startMin)} and ${dayTimeLabel(window.endMin)}`;
  const ready = dayTimeToMin(form.readyDay, form.readyTime);
  const deadline = dayTimeToMin(form.deadlineDay, form.deadlineTime);
  if (!errors.readyMin && (ready < window.startMin || ready > window.endMin)) {
    errors.readyMin = `Ready time must be between ${range}`;
  }
  if (!errors.deadlineMin && (deadline < window.startMin || deadline > window.endMin)) {
    errors.deadlineMin = `Deliver-by time must be between ${range}`;
  }
  return errors;
}

/** Prefill for Edit request / Duplicate (grams -> kg). */
export function fromShipment(s: Shipment): FormState {
  const day = (m: number): 1 | 2 => (m >= DAY ? 2 : 1);
  return {
    originBusinessId: s.originBusinessId,
    destinationBusinessId: s.destinationBusinessId,
    label: s.label,
    category: s.category,
    description: s.description,
    weightKg: String(s.weightGrams / 1000),
    readyDay: day(s.readyMin),
    readyTime: minToTime(s.readyMin),
    deadlineDay: day(s.deadlineMin),
    deadlineTime: minToTime(s.deadlineMin),
    pickupInstructions: s.pickupInstructions,
    dropoffInstructions: s.dropoffInstructions,
  };
}

/** Prefill for Edit request / Duplicate (grams -> kg, minutes -> day + HH:MM). */
export const formFromShipment = fromShipment;

let requestCounter = 0;
/** Fresh id for a new request. Module-wide counter so a Duplicate never reuses the original's id (POST is idempotent per id). */
export function newClientRequestId(originId: string): string {
  requestCounter += 1;
  return `req-${originId}-${requestCounter}-${Date.now().toString(36)}`;
}

/** Runs one async action at a time; a call while one is pending is ignored (returns undefined). */
export function createSubmitGuard() {
  let busy = false;
  return async function guarded<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  };
}

/** User-facing text for a failed action. A locked (409) rejection always points at a new planning cycle. */
export function actionErrorMessage(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  const msg = e instanceof Error ? e.message : 'Request failed';
  if (status === 409 && !/planning cycle|already matched/i.test(msg)) return `${msg}. Start a new planning cycle to change deliveries.`;
  return msg;
}

/** Holds one clientRequestId across retries; only a success (or a fresh form / Duplicate) calls reset(). */
export function createRequestIdHolder(originId: () => string) {
  let id = '';
  return {
    current(): string {
      if (!id) id = newClientRequestId(originId());
      return id;
    },
    reset() { id = ''; },
  };
}

export type SubmitFailure =
  | { kind: 'retry'; message: string }
  | { kind: 'locked'; message: string }
  | { kind: 'fields'; fieldErrors: Record<string, string>; message: string }
  | { kind: 'other'; message: string };

/** Classifies a failed create call: network/5xx keep the form and the id for a retry; 409 = locked; 400 = field errors. */
export function classifySubmitFailure(e: unknown): SubmitFailure {
  const status = (e as { status?: number } | null)?.status;
  const fieldErrors = (e as { fieldErrors?: Record<string, string> } | null)?.fieldErrors;
  if (status === 409) return { kind: 'locked', message: LOCKED_MESSAGE };
  if (status === 400 && fieldErrors && Object.keys(fieldErrors).length > 0) {
    return { kind: 'fields', fieldErrors, message: 'Please fix the highlighted fields.' };
  }
  if (status === 0 || (typeof status === 'number' && status >= 500)) {
    return {
      kind: 'retry',
      message: "We couldn't reach the server. Your details are kept; press the button again to retry. It won't create a duplicate package.",
    };
  }
  return { kind: 'other', message: e instanceof Error ? e.message : 'Request failed' };
}

export const LOCKED_MESSAGE = 'Simulation has started, so new requests are closed until the next planning cycle.';

/** Form fields that have an inline slot; other server field keys are shown in the form-level message. */
export const FORM_FIELDS = ['destinationBusinessId', 'label', 'category', 'weightKg', 'description', 'readyMin', 'deadlineMin'];
