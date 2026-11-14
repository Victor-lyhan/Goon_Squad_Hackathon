import { GenerateScenarioRequest } from '../../../../shared/schemas';
import type { CompareResponse } from '../../../../shared/api';
import type { Metrics, Run } from '../../../../shared/types';
import { formatCents, formatMin } from './metricsModel';

export type NumericField = 'seed' | 'employees' | 'packages' | 'hubs' | 'maxExtraMin';
export type SetupForm = { preset: 'demo' | 'random'; seed: string; employees: string; packages: string; hubs: string; maxExtraMin: string };

/** Ranges mirror GenerateScenarioRequest (a test keeps them in sync with the schema). */
export const FIELD_RANGES: Record<NumericField, { label: string; min?: number; max?: number }> = {
  seed: { label: 'Seed' },
  employees: { label: 'Employees', min: 10, max: 200 },
  packages: { label: 'Packages', min: 5, max: 60 },
  hubs: { label: 'Hubs', min: 0, max: 10 },
  maxExtraMin: { label: 'Max added minutes', min: 0, max: 30 },
};
export const NUMERIC_FIELDS = Object.keys(FIELD_RANGES) as NumericField[];

/** Defaults come straight from the schema (the Random preset uses every field). */
export function defaultForm(): SetupForm {
  const d = GenerateScenarioRequest.parse({ preset: 'random' });
  return { preset: 'demo', seed: String(d.seed), employees: String(d.employees), packages: String(d.packages), hubs: String(d.hubs), maxExtraMin: String(d.maxExtraMin) };
}

export const PRESET_LABELS: Record<SetupForm['preset'], string> = { demo: 'Demo city (designed)', random: 'Random city (seeded)' };
/** server/api/scenario.ts loads the fixed Demo city and ignores every numeric field. */
export const DEMO_IGNORES_TEXT = 'The designed Demo city is fixed, so seed and sizes do not apply. Pick Random city to set them.';
export const isFieldDisabled = (preset: SetupForm['preset']): boolean => preset === 'demo';

export function rangeHint(f: NumericField): string {
  const r = FIELD_RANGES[f];
  return r.min === undefined || r.max === undefined ? 'Whole number' : `Whole number, ${r.min} to ${r.max}`;
}

export function fieldErrorText(f: NumericField): string {
  const r = FIELD_RANGES[f];
  return r.min === undefined || r.max === undefined
    ? `${r.label} must be a whole number.`
    : `${r.label} must be a whole number from ${r.min} to ${r.max}.`;
}

export type SetupValidation =
  | { ok: true; request: GenerateScenarioRequest; errors: Record<string, never> }
  | { ok: false; request?: undefined; errors: Partial<Record<NumericField, string>> };

const NUMBER_TEXT = /^[+-]?\d+(\.\d+)?$/;

/** Validates the form with the shared schema. Blank or non-numeric text is an error; Demo sends only the preset. */
export function validateSetup(form: SetupForm): SetupValidation {
  const raw: Record<string, unknown> = { preset: form.preset };
  if (form.preset === 'random') {
    for (const f of NUMERIC_FIELDS) {
      const t = form[f].trim();
      raw[f] = NUMBER_TEXT.test(t) ? Number(t) : Number.NaN;
    }
  }
  const parsed = GenerateScenarioRequest.safeParse(raw);
  if (parsed.success) return { ok: true, request: parsed.data, errors: {} };
  const errors: Partial<Record<NumericField, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as NumericField;
    if (key in FIELD_RANGES && !errors[key]) errors[key] = fieldErrorText(key);
  }
  return { ok: false, errors };
}

/** "Generated run-3 (seed 42)" from the API response; Demo has no seed of its own, so the response's seed is shown as-is. */
export function generatedText(r: { runId: string }, seed: number | undefined): string {
  return seed === undefined ? `Generated ${r.runId}` : `Generated ${r.runId} (seed ${seed})`;
}

export type CompareRow = { key: string; label: string; direct: string; relay: string; diff: string };

const DASH = '—';
const num = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : DASH);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function diffMatched(a: number, b: number): string {
  const d = b - a;
  if (d === 0) return 'Same number matched';
  return `${signed(d)} ${Math.abs(d) === 1 ? 'package' : 'packages'} matched with relay`;
}

function diffMinutes(a: number | null, b: number | null): string {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return DASH;
  const d = Math.round((b - a) * 10) / 10;
  return d === 0 ? 'No change' : `${signed(d)} min`;
}

function diffCents(a: number, b: number): string {
  const d = b - a;
  if (d === 0) return 'No change';
  return `${d > 0 ? '+' : '−'}${formatCents(Math.abs(d))}`;
}

const ratio = (m: Metrics) => `${num(m.matched)} / ${num(m.requested)}`;

/** Display rows for the side-by-side comparison. Values are the API's; only differences are formatted here. */
export function toCompareRows(c: CompareResponse): CompareRow[] {
  const d = c.directOnly.metrics;
  const r = c.withRelay.metrics;
  return [
    { key: 'matched', label: 'Matched / requested', direct: ratio(d), relay: ratio(r), diff: diffMatched(d.matched, r.matched) },
    { key: 'direct', label: 'Direct deliveries', direct: num(d.direct), relay: num(r.direct), diff: signed(r.direct - d.direct) },
    { key: 'relay', label: 'Relay deliveries', direct: num(d.relay), relay: num(r.relay),
      diff: r.relay === d.relay ? '±0' : `${signed(r.relay - d.relay)} ${plural(Math.abs(r.relay - d.relay), 'relay').replace(/^\d+ /, '')}` },
    { key: 'avgExtra', label: 'Avg added minutes', direct: formatMin(d.avgExtraMinPerTrip), relay: formatMin(r.avgExtraMinPerTrip),
      diff: diffMinutes(d.avgExtraMinPerTrip, r.avgExtraMinPerTrip) },
    { key: 'savings', label: 'Projected customer savings', direct: formatCents(d.projectedCustomerSavingsCents),
      relay: formatCents(r.projectedCustomerSavingsCents), diff: diffCents(d.projectedCustomerSavingsCents, r.projectedCustomerSavingsCents) },
  ];
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Request failed');

export const CONFIRM_TEXT = 'This replaces the current city and its packages.';
export const LOCKED_ERROR_TEXT = 'Start a new planning cycle first.';

export type ReplaceAction = 'generate' | 'import';
export type ConfirmState = ReplaceAction | null;
export type ConfirmEvent = { type: 'ask'; action: ReplaceAction } | { type: 'cancel' } | { type: 'confirm' };

/** Confirm step for destructive actions. `confirm` and `cancel` both close it; the caller only calls the API on confirm. */
export function confirmReducer(state: ConfirmState, ev: ConfirmEvent): ConfirmState {
  return ev.type === 'ask' ? ev.action : null;
}

/** True when the API refused the request because planning is locked. */
export const isLockedError = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 409;

/** Message shown inline. A 409 always points at "Start new planning cycle", keeping the server text for detail. */
export function describeActionError(e: unknown): string {
  const msg = errorMessage(e);
  if (!isLockedError(e)) return msg;
  return /start a new planning cycle/i.test(msg) ? msg : `${LOCKED_ERROR_TEXT} ${msg}`;
}

/** Parses an imported file's text; the message is shown inline on failure. */
export function parseImportText(text: string): { ok: true; data: Run } | { ok: false; error: string } {
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, error: 'That file is not a scenario: expected a JSON object.' };
    return { ok: true, data: data as Run };
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

/** `relay-<preset>-seed<seed>-<runId>.json`, from the API response only. */
export function exportFilename(run: { runId: string; scenario: { preset: string; seed: number } }): string {
  return `relay-${slug(run.scenario.preset)}-seed${slug(String(run.scenario.seed))}-${slug(run.runId)}.json`;
}

export const LOCKED_RECOMPUTE_TEXT = 'Playback has started. Start a new planning cycle to recompute.';

export type RecomputeButtonState = { disabled: boolean; loading: boolean; hint: string | null };

/** Button state for "Recompute matches". Locked or any pending action disables it. */
export function recomputeButtonState(phase: 'planning' | 'locked' | undefined, pending: boolean): RecomputeButtonState {
  const locked = phase === 'locked';
  return { disabled: locked || pending, loading: pending, hint: locked ? LOCKED_RECOMPUTE_TEXT : null };
}

/** Toast text from the API response only (plans = matched, unmatched = unmatched). */
export function recomputeToast(r: { plans: readonly unknown[]; unmatched: readonly unknown[] }): string {
  const m = r.plans.length;
  const u = r.unmatched.length;
  return `Matches recomputed: ${m} matched, ${u} unmatched.`;
}

/** Employee to link from the demo hint: first one with a job, else the first employee. */
export function hintEmployeeId(jobs: readonly { employeeId: string }[] | undefined, employees: readonly { id: string }[]): string | undefined {
  return jobs?.[0]?.employeeId ?? employees[0]?.id;
}

export const TRADEOFF_STEPS = [
  'Start new planning cycle',
  'Lower an employee’s added-time limit in the employee portal',
  'Recompute matches',
] as const;
