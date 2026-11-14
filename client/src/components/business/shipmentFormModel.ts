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

function rawRequest(form: FormState, clientRequestId: string) {
  return {
    clientRequestId,
    originBusinessId: form.originBusinessId,
    destinationBusinessId: form.destinationBusinessId,
    label: form.label,
    category: form.category,
    description: form.description,
    weightKg: form.weightKg.trim() === '' ? NaN : Number(form.weightKg),
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
export function validate(form: FormState): Record<string, string> {
  const res = CreateShipmentRequest.safeParse(rawRequest(form, 'validate'));
  if (res.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!(key in errors)) errors[key] = issue.message;
  }
  // Zod's default message for a missing/NaN number is unhelpful.
  if (errors.weightKg && !/kg/.test(errors.weightKg)) errors.weightKg = 'Enter a weight in kg';
  if (errors.destinationBusinessId && form.destinationBusinessId === '') {
    errors.destinationBusinessId = 'Choose a destination business';
  }
  for (const k of ['readyMin', 'deadlineMin'] as const) {
    if (errors[k] && !/after/.test(errors[k])) errors[k] = 'Enter a valid day and time';
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
