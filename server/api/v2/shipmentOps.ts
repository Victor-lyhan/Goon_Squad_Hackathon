// The pure steps of the MVP II delivery-request routes (DECISIONS pass 6, 9, 44, 46, 62):
//   POST  /api/v2/shipments            planCreateShipment -> withShipment -> atPlanningStart -> matchPending -> shipmentView
//   PATCH /api/v2/shipments/:id        planPatchShipment  -> withShipment -> atPlanningStart -> matchPending -> shipmentView
//   POST  /api/v2/shipments/:id/match  planMatchRetry     -> atPlanningStart -> matchPending -> shipmentView
// The route owns the HTTP handling, the store and the matching. Nothing here reads fs, a clock or
// randomness, and no message echoes request text or an ID, so the same request on the same run
// always gives the same result. Rules are MVP 1's (server/api/shipments.ts).
import { CreateShipmentRequest, PatchShipmentRequest, type ApiError } from '../../../shared/v2/schemas';
import type { Run, Shipment } from '../../../shared/v2/types';

export const INVALID_SHIPMENT = 'Invalid shipment';
export const SHIPMENT_NOT_FOUND = 'Shipment not found';
export const SHIPMENTS_LOCKED = 'Start a new planning cycle to change deliveries';
export const SHIPMENT_MATCHED = 'This delivery is already matched and can no longer be edited';
export const UNKNOWN_BUSINESS = 'Unknown business';
export const SAME_BUSINESS = 'Choose a different business';
export const READY_OUTSIDE_WINDOW = 'Ready time is outside the planning window';
export const DEADLINE_OUTSIDE_WINDOW = 'Deliver-by is outside the planning window';
export const DEADLINE_BEFORE_READY = 'Deliver-by must be after ready time';

/** A request that is not carried out. The route answers `status` with `error` as the body. */
export type ShipmentRefusal =
  | { kind: 'invalid'; status: 400; error: ApiError }
  | { kind: 'not_found'; status: 404; error: ApiError }
  | { kind: 'locked'; status: 409; error: ApiError }
  | { kind: 'matched'; status: 409; error: ApiError };

export type CreateShipmentPlan =
  | Extract<ShipmentRefusal, { kind: 'invalid' | 'locked' }>
  | { kind: 'replay'; shipmentId: string }       // 200 with the stored shipment's view
  | { kind: 'create'; shipment: Shipment };      // 201 after withShipment + matching

export type PatchShipmentPlan = ShipmentRefusal | { kind: 'patch'; shipment: Shipment };

export type MatchRetryPlan =
  | Extract<ShipmentRefusal, { kind: 'not_found' | 'locked' }>
  | { kind: 'already_matched'; shipmentId: string } // 200 with the current view, nothing to do
  | { kind: 'match'; shipmentId: string };

type FieldErrors = Record<string, string>;

const invalid = (fieldErrors: FieldErrors): Extract<ShipmentRefusal, { kind: 'invalid' }> =>
  ({ kind: 'invalid', status: 400, error: { error: INVALID_SHIPMENT, fieldErrors } });
const notFound = (): Extract<ShipmentRefusal, { kind: 'not_found' }> =>
  ({ kind: 'not_found', status: 404, error: { error: SHIPMENT_NOT_FOUND } });
const locked = (): Extract<ShipmentRefusal, { kind: 'locked' }> =>
  ({ kind: 'locked', status: 409, error: { error: SHIPMENTS_LOCKED } });

const isLocked = (run: Run) => run.clock.phase === 'locked';
const isMatched = (run: Run, shipmentId: string) => run.assignments.plans.some((p) => p.shipmentId === shipmentId);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0;

// ---------- Messages ----------
// Zod's default texts name JavaScript types ("received undefined"), so every issue without a message
// in the schema gets one of these instead. Messages written in the schema win over this table.
type Copy = { missing: string; invalid: string; low?: string; high?: string };
const text = (missing: string, invalid = missing): Copy => ({ missing, invalid });
const FIELD_COPY: Record<string, Copy> = {
  body: text('Send the delivery details as a JSON object'),
  clientRequestId: text('A request ID is required', 'The request ID must be text'),
  originBusinessId: text('Choose a sender'),
  destinationBusinessId: text('Choose a recipient'),
  label: text('Package name is required', 'Package name must be text'),
  category: text('Choose a package type', 'Choose envelope or small box'),
  description: text('Describe the contents', 'The description must be text'),
  weightKg: { ...text('Enter the weight in kg', 'Weight must be a number of kg'), low: 'Weight must be above 0 kg', high: 'Max 2 kg' },
  readyMin: { ...text('Choose a ready time', 'Ready time must be a whole minute'), low: READY_OUTSIDE_WINDOW, high: READY_OUTSIDE_WINDOW },
  deadlineMin: { ...text('Choose a deliver-by time', 'Deliver-by must be a whole minute'), low: DEADLINE_OUTSIDE_WINDOW, high: DEADLINE_OUTSIDE_WINDOW },
  pickupInstructions: text('Pickup instructions must be text'),
  dropoffInstructions: text('Drop-off instructions must be text'),
};
const FALLBACK_COPY = text('This value is not valid');

const fieldOf = (path: readonly PropertyKey[] | undefined) => (path ?? []).map(String).join('.') || 'body';

/** Per-parse Zod error map: the text for an issue the schema gives no message for. */
function issueText(issue: { code?: string; path?: PropertyKey[]; input?: unknown }): string {
  const copy = FIELD_COPY[fieldOf(issue.path)] ?? FALLBACK_COPY;
  const { input } = issue;
  if (issue.code === 'too_small' || issue.code === 'too_big') {
    if (typeof input === 'string') return copy.missing; // the only string limit is "not empty"
    return (issue.code === 'too_small' ? copy.low : copy.high) ?? copy.invalid;
  }
  return input === undefined || input === null ? copy.missing : copy.invalid;
}

/** One message per form field (the first issue wins); a body that is not an object is keyed `body`. */
function issueErrors(issues: readonly { path: PropertyKey[]; message: string }[]): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of issues) fieldErrors[fieldOf(issue.path)] ??= issue.message;
  return fieldErrors;
}

// ---------- Checks against the run ----------
type RunChecked = Partial<Pick<Shipment, 'originBusinessId' | 'destinationBusinessId' | 'readyMin' | 'deadlineMin'>>;

/**
 * Business and time checks shared by create and patch; keys are form field names.
 * Only the values that are present are checked, so a half-valid body still gets every problem listed.
 */
function runProblems(run: Run, v: RunChecked): FieldErrors {
  const errors: FieldErrors = {};
  const known = new Set(run.scenario.businesses.map((b) => b.id));
  const { simStartMin, simEndMin } = run.scenario.settings;
  const outside = (min: number) => min < simStartMin || min > simEndMin;

  if (v.originBusinessId !== undefined && !known.has(v.originBusinessId)) errors.originBusinessId = UNKNOWN_BUSINESS;
  if (v.destinationBusinessId !== undefined) {
    if (v.destinationBusinessId === v.originBusinessId) errors.destinationBusinessId = SAME_BUSINESS;
    else if (!known.has(v.destinationBusinessId)) errors.destinationBusinessId = UNKNOWN_BUSINESS;
  }
  if (v.readyMin !== undefined && outside(v.readyMin)) errors.readyMin = READY_OUTSIDE_WINDOW;
  if (v.deadlineMin !== undefined) {
    if (v.readyMin !== undefined && v.deadlineMin <= v.readyMin) errors.deadlineMin = DEADLINE_BEFORE_READY;
    else if (outside(v.deadlineMin)) errors.deadlineMin = DEADLINE_OUTSIDE_WINDOW;
  }
  return errors;
}

/** The run-checked fields of a body that failed the schema: only those the schema did not complain about. */
function usableFields(body: unknown, fieldErrors: FieldErrors): RunChecked {
  if (!isRecord(body)) return {};
  const ok = (key: string) => !(key in fieldErrors);
  const id = (key: string) => (ok(key) && typeof body[key] === 'string' && body[key] !== '' ? (body[key] as string) : undefined);
  const min = (key: string) => (ok(key) && typeof body[key] === 'number' && Number.isFinite(body[key]) ? (body[key] as number) : undefined);
  return {
    originBusinessId: id('originBusinessId'), destinationBusinessId: id('destinationBusinessId'),
    readyMin: min('readyMin'), deadlineMin: min('deadlineMin'),
  };
}

// ---------- IDs ----------
/**
 * Sequence number of the next shipment: highest `createdSeq` + 1, so IDs continue after the
 * scenario's own packages (`shp-25` after the demo's 24). A stored `shp-<n>` ID that runs ahead of
 * its `createdSeq` (an imported run) also counts, so a new ID can never replace a stored shipment.
 */
function nextSeq(shipments: readonly Shipment[]): number {
  let highest = 0;
  for (const s of shipments) {
    const fromId = /^shp-(\d+)$/.exec(s.id);
    highest = Math.max(highest, s.createdSeq, fromId ? Number(fromId[1]) : 0);
  }
  return highest + 1;
}

// ---------- POST /api/v2/shipments ----------
/**
 * Decides what a create request means, in this order: the body's shape (400), a replay of a stored
 * `clientRequestId`, the lock (409), then the business and time checks against the run (400).
 * The replay comes before the lock (DECISIONS pass 62): a client that repeats a request it already
 * sent, after Play, asks about a delivery that exists, so it gets that delivery and not a 409.
 * A 400 lists every problem at once, keyed by form field.
 */
export function planCreateShipment(run: Run, body: unknown): CreateShipmentPlan {
  const parsed = CreateShipmentRequest.safeParse(body, { error: issueText });
  if (!parsed.success) {
    const fieldErrors = issueErrors(parsed.error.issues);
    return invalid({ ...runProblems(run, usableFields(body, fieldErrors)), ...fieldErrors });
  }
  const request = parsed.data;
  const stored = run.scenario.shipments.find((s) => s.clientRequestId === request.clientRequestId);
  if (stored) return { kind: 'replay', shipmentId: stored.id };
  if (isLocked(run)) return locked();

  const fieldErrors = runProblems(run, request);
  if (hasErrors(fieldErrors)) return invalid(fieldErrors);

  const seq = nextSeq(run.scenario.shipments);
  const shipment: Shipment = {
    id: `shp-${seq}`,
    clientRequestId: request.clientRequestId,
    label: request.label,
    originBusinessId: request.originBusinessId,
    destinationBusinessId: request.destinationBusinessId,
    readyMin: request.readyMin,
    deadlineMin: request.deadlineMin,
    category: request.category,
    description: request.description,
    weightGrams: Math.round(request.weightKg * 1000),
    pickupInstructions: request.pickupInstructions,
    dropoffInstructions: request.dropoffInstructions,
    createdSeq: seq,
  };
  return { kind: 'create', shipment };
}

// ---------- PATCH /api/v2/shipments/:id ----------
/** The stored shipment with the edits applied. ID, sender, `clientRequestId` and `createdSeq` never change. */
function applyEdits(current: Shipment, edits: PatchShipmentRequest): Shipment {
  const next: Shipment = { ...current };
  if (edits.label !== undefined) next.label = edits.label;
  if (edits.category !== undefined) next.category = edits.category;
  if (edits.description !== undefined) next.description = edits.description;
  if (edits.weightKg !== undefined) next.weightGrams = Math.round(edits.weightKg * 1000);
  if (edits.destinationBusinessId !== undefined) next.destinationBusinessId = edits.destinationBusinessId;
  if (edits.readyMin !== undefined) next.readyMin = edits.readyMin;
  if (edits.deadlineMin !== undefined) next.deadlineMin = edits.deadlineMin;
  if (edits.pickupInstructions !== undefined) next.pickupInstructions = edits.pickupInstructions;
  if (edits.dropoffInstructions !== undefined) next.dropoffInstructions = edits.dropoffInstructions;
  return next;
}

/** The fields of a patch body that the schema accepted, when the body as a whole failed it. */
function acceptedEdits(body: unknown, fieldErrors: FieldErrors): PatchShipmentRequest {
  if (!isRecord(body)) return {};
  const accepted = Object.fromEntries(Object.entries(body).filter(([key]) => !(key in fieldErrors)));
  const parsed = PatchShipmentRequest.safeParse(accepted);
  return parsed.success ? parsed.data : {};
}

/**
 * Decides what an edit means: unknown ID (404), locked (409), already matched (409), then one 400
 * that lists the body's problems together with the problems of the shipment as it would be stored.
 * Only unmatched requests are edited; the route retries the match after storing the result.
 */
export function planPatchShipment(run: Run, shipmentId: string, body: unknown): PatchShipmentPlan {
  const current = run.scenario.shipments.find((s) => s.id === shipmentId);
  if (!current) return notFound();
  if (isLocked(run)) return locked();
  if (isMatched(run, shipmentId)) return { kind: 'matched', status: 409, error: { error: SHIPMENT_MATCHED } };

  const parsed = PatchShipmentRequest.safeParse(body, { error: issueText });
  const bodyErrors = parsed.success ? {} : issueErrors(parsed.error.issues);
  const shipment = applyEdits(current, parsed.success ? parsed.data : acceptedEdits(body, bodyErrors));
  const fieldErrors = { ...runProblems(run, shipment), ...bodyErrors };
  if (hasErrors(fieldErrors)) return invalid(fieldErrors);
  return { kind: 'patch', shipment };
}

// ---------- POST /api/v2/shipments/:id/match ----------
/** Decides whether a retry runs the matcher: only for a stored, unmatched shipment in an unlocked run. */
export function planMatchRetry(run: Run, shipmentId: string): MatchRetryPlan {
  if (!run.scenario.shipments.some((s) => s.id === shipmentId)) return notFound();
  if (isLocked(run)) return locked();
  return { kind: isMatched(run, shipmentId) ? 'already_matched' : 'match', shipmentId };
}

// ---------- Storing ----------
/**
 * A run with `shipment` added, or put in place of the stored shipment with the same ID.
 * Shipments stay in `createdSeq` order and `version` goes up by one. The input run is not changed:
 * the result is a new run object with a new scenario and shipment list, sharing everything else.
 */
export function withShipment(run: Run, shipment: Shipment): Run {
  const shipments = [...run.scenario.shipments.filter((s) => s.id !== shipment.id), shipment]
    .sort((a, b) => a.createdSeq - b.createdSeq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...run, version: run.version + 1, scenario: { ...run.scenario, shipments } };
}

/**
 * The rewind rule (DECISIONS pass 62): a planning run with its clock at the start of the run, paused.
 * Seek, Next event, Jump to morning, Finish and "Play journey" move the clock without locking the run,
 * and the matcher does not read the clock. So a delivery stored after such a preview would be answered
 * at the moved clock: already at the relay point or delivered, with its reward already earned. The
 * routes therefore call this in the mutation that stores a new, edited or re-matched delivery.
 * The phase stays `planning` and the speed stays. A run whose clock is already there, and a locked
 * run, come back as the same object. The input run is not changed.
 */
export function atPlanningStart(run: Run): Run {
  const { simStartMin } = run.scenario.settings;
  const { clock } = run;
  if (clock.phase !== 'planning' || (clock.timeMin === simStartMin && !clock.playing)) return run;
  return { ...run, clock: { ...clock, timeMin: simStartMin, playing: false } };
}
