import { GenerateScenarioRequest } from '../../../../shared/schemas';
import type { CompareResponse } from '../../../../shared/api';
import type { Metrics } from '../../../../shared/types';
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

/** Defaults come straight from the schema. */
export function defaultForm(): SetupForm {
  const d = GenerateScenarioRequest.parse({ preset: 'demo' });
  return { preset: 'demo', seed: String(d.seed), employees: String(d.employees), packages: String(d.packages), hubs: String(d.hubs), maxExtraMin: String(d.maxExtraMin) };
}

export function rangeHint(f: NumericField): string {
  const r = FIELD_RANGES[f];
  return r.min === undefined || r.max === undefined ? 'Whole number' : `Whole number, ${r.min} to ${r.max}`;
}

export type SetupValidation =
  | { ok: true; request: GenerateScenarioRequest; errors: Record<string, never> }
  | { ok: false; request?: undefined; errors: Partial<Record<NumericField, string>> };

/** Validates the form with the shared schema. Blank fields fall back to the schema default. */
export function validateSetup(form: SetupForm): SetupValidation {
  const raw: Record<string, unknown> = { preset: form.preset };
  for (const f of NUMERIC_FIELDS) {
    const t = form[f].trim();
    if (t !== '') raw[f] = Number(t);
  }
  const parsed = GenerateScenarioRequest.safeParse(raw);
  if (parsed.success) return { ok: true, request: parsed.data, errors: {} };
  const errors: Partial<Record<NumericField, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as NumericField;
    if (key in FIELD_RANGES && !errors[key]) errors[key] = `${FIELD_RANGES[key].label}: ${rangeHint(key).toLowerCase()}`;
  }
  return { ok: false, errors };
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

/** Local-time-free filename for the export download. */
export const EXPORT_FILENAME = 'relay-scenario.json';

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
