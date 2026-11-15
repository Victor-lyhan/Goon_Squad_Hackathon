import type { CompareResponse } from '../../../../../../shared/v2/api';
import type { Metrics } from '../../../../../../shared/v2/types';
import { formatCents, formatDuration } from '../../../../ui/format';

// Pure view model for the "Direct only vs relay points" section (#406).
// Every number is read from `result` / `metrics` of one CompareResponse. The only arithmetic is the
// difference between the two displayed matched counts; no status, price or time is computed here.

export const COMPARE_INTRO = 'Compare matching with and without relay points.';
/** Under the section's Details toggle (#832), with PROJECTION_NOTE. */
export const RELAY_POINT_NOTE = 'A relay point is a network business that holds a package overnight.';
export const NO_GAIN_LINE = 'Relay points add no matches in this scenario';
/** The empty state (#883): a run with no packages has nothing to compare, so no table of zeros. */
export const NO_REQUESTS_LINE = 'Nothing to compare yet: this run has no packages.';
export const PROJECTION_NOTE = 'Projection only. Comparing does not change the live plan.';
export const DIRECT_HEADING = 'Direct only';
export const RELAY_HEADING = 'With relay points';

const DASH = '—';

export type CompareRow = { key: string; label: string; direct: string; relay: string; emphasis: boolean };
export type CompareSummary = { line: string; tone: 'gain' | 'neutral' | 'loss' };

const whole = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const count = (n: number | null | undefined) => String(whole(n) ?? 0);
const money = (n: number | null | undefined) => formatCents(whole(n) ?? 0);

/** "3 / 5": both numbers come from the server metrics. */
const matchedOfRequested = (m: Metrics) => `${count(m.matched)} / ${count(m.requested)}`;

/**
 * Average extra minutes per used trip, from the server. With no plans no trip is used, so nothing is
 * added: "0 min". A null average next to matched plans would be a server gap, shown as a dash.
 */
function avgExtra(m: Metrics, plans: number): string {
  const avg = whole(m.avgExtraMinPerTrip);
  if (avg !== null) return formatDuration(avg);
  return plans === 0 ? formatDuration(0) : DASH;
}

/** The rows printed for both sides, already formatted. */
export function compareRows(response: CompareResponse): CompareRow[] {
  const d = response.directOnly;
  const r = response.withRelay;
  const side = (pick: (s: CompareResponse['directOnly']) => string) => ({ direct: pick(d), relay: pick(r) });
  return [
    { key: 'matched', label: 'Matched / requested', emphasis: true, ...side((s) => matchedOfRequested(s.metrics)) },
    { key: 'direct', label: 'Direct plans', emphasis: false, ...side((s) => count(s.metrics.direct)) },
    { key: 'relay', label: 'Relay point plans', emphasis: false, ...side((s) => count(s.metrics.relay)) },
    { key: 'unmatched', label: 'Unmatched', emphasis: false, ...side((s) => count(s.metrics.unmatched)) },
    { key: 'avgExtra', label: 'Avg. extra minutes per trip', emphasis: false,
      ...side((s) => avgExtra(s.metrics, s.result.plans.length)) },
    { key: 'platform', label: 'Platform contribution', emphasis: false,
      ...side((s) => money(s.metrics.projectedPlatformContributionCents)) },
  ];
}

const deliveries = (n: number) => `${n} ${n === 1 ? 'delivery' : 'deliveries'}`;

/** True when the run has no delivery requests: the section shows NO_REQUESTS_LINE alone. */
export function nothingToCompare(response: CompareResponse): boolean {
  return (whole(response.withRelay.metrics.requested) ?? 0) === 0;
}

/** The headline: the difference between the two matched counts shown in the table. */
export function compareSummary(response: CompareResponse): CompareSummary {
  if (nothingToCompare(response)) return { line: NO_REQUESTS_LINE, tone: 'neutral' };
  const delta = (whole(response.withRelay.metrics.matched) ?? 0) - (whole(response.directOnly.metrics.matched) ?? 0);
  if (delta > 0) return { line: `+${delta} matched with relay points`, tone: 'gain' };
  if (delta === 0) return { line: NO_GAIN_LINE, tone: 'neutral' };
  return { line: `${deliveries(-delta)} fewer matched with relay points`, tone: 'loss' };
}
