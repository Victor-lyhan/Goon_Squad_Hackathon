import type { CompareResponse } from '../../../../shared/api';
import type { Metrics } from '../../../../shared/types';
import { formatCents, formatMin } from './metricsModel';

export const NO_HUBS_MESSAGE = "No hubs in this city, so relay can't add matches";
export const PLAN_NOTE = 'This comparison is a projection only. It does not change the current plan.';
const DASH = '—';

export type CompareViewRow = { key: string; label: string; direct: string; relay: string; diff: string; highlight: boolean };
export type CompareView = {
  rows: CompareViewRow[];
  /** "Relay adds +N matches", or the zero-hub message, or a dash line when nothing was requested. */
  deltaLine: string;
  tone: 'win' | 'neutral' | 'warn';
  noRelay: boolean;
  /** Shown under the table on every city: comparing never changes the live plan. */
  planNote: string;
};

const fin = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const num = (n: number | null | undefined) => (fin(n) ? String(n) : DASH);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;
const ratio = (m: Metrics) => (fin(m.requested) && m.requested > 0 && fin(m.matched) ? `${m.matched} / ${m.requested}` : DASH);

function diffMin(a: number | null, b: number | null): string {
  if (!fin(a) || !fin(b)) return DASH;
  const d = Math.round((b - a) * 10) / 10;
  return d === 0 ? 'No change' : `${signed(d)} min`;
}
function diffCents(a: number, b: number, hasRequests: boolean): string {
  if (!hasRequests || !fin(a) || !fin(b)) return DASH;
  const d = b - a;
  return d === 0 ? 'No change' : `${d > 0 ? '+' : '−'}${formatCents(Math.abs(d))}`;
}

/** Formats API metrics for the proof slide. No metric is derived here; only differences are shown. */
export function toCompareView(c: CompareResponse): CompareView {
  const d = c.directOnly.metrics;
  const r = c.withRelay.metrics;
  const hasRequests = fin(r.requested) && r.requested > 0;
  const noRelay = !fin(r.relay) || r.relay === 0;
  const delta = r.matched - d.matched;
  const money = (m: Metrics, v: number) => (hasRequests ? formatCents(v) : DASH);

  let deltaLine: string;
  let tone: CompareView['tone'];
  if (!hasRequests || !fin(delta)) { deltaLine = 'Relay adds — matches'; tone = 'neutral'; }
  else if (noRelay) { deltaLine = NO_HUBS_MESSAGE; tone = 'warn'; }
  else if (delta > 0) { deltaLine = `Relay adds +${delta} ${delta === 1 ? 'match' : 'matches'}`; tone = 'win'; }
  else if (delta === 0) { deltaLine = 'Relay adds no extra matches for this plan'; tone = 'neutral'; }
  else { deltaLine = `Relay matches ${Math.abs(delta)} fewer ${Math.abs(delta) === 1 ? 'package' : 'packages'} than direct only`; tone = 'warn'; }

  const matchedDiff = !hasRequests || !fin(delta) ? DASH : delta === 0 ? 'Same number matched'
    : `${signed(delta)} ${Math.abs(delta) === 1 ? 'package' : 'packages'} matched with relay`;
  const relayDiff = fin(r.relay) && fin(d.relay) ? (r.relay === d.relay ? '±0' : signed(r.relay - d.relay)) : DASH;

  const rows: CompareViewRow[] = [
    { key: 'matched', label: 'Projected matched / requested', direct: ratio(d), relay: ratio(r), diff: matchedDiff, highlight: true },
    { key: 'relay', label: 'Projected relay plans', direct: num(d.relay), relay: num(r.relay), diff: relayDiff, highlight: false },
    { key: 'avgExtra', label: 'Projected average added minutes', direct: formatMin(d.avgExtraMinPerTrip), relay: formatMin(r.avgExtraMinPerTrip), diff: diffMin(d.avgExtraMinPerTrip, r.avgExtraMinPerTrip), highlight: false },
    { key: 'maxExtra', label: 'Projected max added minutes', direct: formatMin(d.maxExtraMin), relay: formatMin(r.maxExtraMin), diff: diffMin(d.maxExtraMin, r.maxExtraMin), highlight: false },
    { key: 'spend', label: 'Projected customer spend', direct: money(d, d.projectedCustomerSpendCents), relay: money(r, r.projectedCustomerSpendCents),
      diff: diffCents(d.projectedCustomerSpendCents, r.projectedCustomerSpendCents, hasRequests), highlight: true },
    { key: 'savings', label: 'Projected customer savings', direct: money(d, d.projectedCustomerSavingsCents), relay: money(r, r.projectedCustomerSavingsCents),
      diff: diffCents(d.projectedCustomerSavingsCents, r.projectedCustomerSavingsCents, hasRequests), highlight: false },
    { key: 'platform', label: 'Projected platform contribution', direct: money(d, d.projectedPlatformContributionCents), relay: money(r, r.projectedPlatformContributionCents),
      diff: diffCents(d.projectedPlatformContributionCents, r.projectedPlatformContributionCents, hasRequests), highlight: false },
  ];
  return { rows, deltaLine, tone, noRelay, planNote: PLAN_NOTE };
}
