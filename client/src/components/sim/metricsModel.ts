import type { Metrics } from '../../../../shared/types';
import { formatCents as sharedFormatCents, formatDuration } from '../../ui/format';

export type MetricCard = {
  key: string;
  label: string;
  value: string;
  caption: string;
  kind: 'projected' | 'actual';
};

const DASH = '—';

const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/** Integer cents -> "$6.50". Null / non-finite -> "—". */
export function formatCents(cents: number | null | undefined): string {
  return finite(cents) ? sharedFormatCents(cents) : DASH;
}

/** Meters -> "1.4 km". Null / non-finite -> "—". */
export function formatKm(meters: number | null | undefined): string {
  if (!finite(meters)) return DASH;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Minutes -> "4 min" / "1 h 5 min". Null / non-finite -> "—". */
export function formatMin(min: number | null | undefined): string {
  return finite(min) ? formatDuration(min) : DASH;
}

const count = (n: number | null | undefined): string => (finite(n) ? String(n) : '0');

/** "3 / 4"; zero or invalid denominator -> "—". */
function ratio(num: number, den: number): string {
  if (!finite(den) || den <= 0 || !finite(num)) return DASH;
  return `${num} / ${den}`;
}

export function toMetricCards(m: Metrics): MetricCard[] {
  const hasRequests = finite(m.requested) && m.requested > 0;
  const unmatched = finite(m.unmatched) ? m.unmatched : 0;
  const spendCaption = unmatched > 0
    ? `Includes ${unmatched} unmatched ${unmatched === 1 ? 'package' : 'packages'} at the external-delivery cost assumption (not simulated)`
    : 'All packages are matched';
  // Spec §4: top row is delivered/requested, matched/requested, average added minutes,
  // projected savings, employee earnings; the rest follow.
  return [
    {
      key: 'delivered', label: 'Delivered / requested', kind: 'actual',
      value: ratio(m.delivered, m.requested),
      caption: 'Delivered so far out of requested',
    },
    {
      key: 'matched', label: 'Projected matched / requested', kind: 'projected',
      value: ratio(m.matched, m.requested),
      caption: 'Projected: packages matched out of requested',
    },
    {
      key: 'avgExtra', label: 'Projected average added minutes', kind: 'projected',
      value: formatMin(m.avgExtraMinPerTrip),
      caption: 'Projected: average added commuter time per trip',
    },
    {
      key: 'savings', label: 'Projected customer savings', kind: 'projected',
      value: hasRequests ? formatCents(m.projectedCustomerSavingsCents) : DASH,
      caption: 'Projected: saved vs the external courier',
    },
    {
      key: 'rewards', label: 'Employee earnings so far', kind: 'actual',
      value: formatCents(m.earnedRewardsCents),
      caption: 'Rewards earned by commuters for completed legs',
    },
    {
      key: 'mix', label: 'Projected direct / relay / unmatched', kind: 'projected',
      value: `${count(m.direct)} / ${count(m.relay)} / ${count(m.unmatched)}`,
      caption: 'Projected: direct vs relay vs unmatched',
    },
    {
      key: 'spend', label: 'Projected customer spend', kind: 'projected',
      value: hasRequests ? formatCents(m.projectedCustomerSpendCents) : DASH,
      caption: spendCaption,
    },
    {
      key: 'contribution', label: 'Projected platform contribution', kind: 'projected',
      value: hasRequests ? formatCents(m.projectedPlatformContributionCents) : DASH,
      caption: 'Projected: platform margin once all matched packages are delivered',
    },
    {
      key: 'maxExtra', label: 'Projected max added minutes', kind: 'projected',
      value: formatMin(m.maxExtraMin),
      caption: 'Projected: longest single detour',
    },
    {
      key: 'extraDistance', label: 'Projected extra commuter distance', kind: 'projected',
      value: formatKm(m.extraDistanceM),
      caption: 'Projected: total added commuter distance',
    },
    {
      key: 'earnedContribution', label: 'Earned platform contribution', kind: 'actual',
      value: formatCents(m.earnedPlatformContributionCents),
      caption: 'Platform margin from delivered packages so far',
    },
  ];
}
