import type { Metrics } from '../../../../shared/types';

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
  if (!finite(cents)) return DASH;
  const abs = Math.abs(Math.round(cents));
  const s = `$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 && abs > 0 ? `-${s}` : s;
}

/** Meters -> "1.4 km". Null / non-finite -> "—". */
export function formatKm(meters: number | null | undefined): string {
  if (!finite(meters)) return DASH;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Minutes -> "3.5 min" (whole numbers stay whole). Null -> "—". */
export function formatMin(min: number | null | undefined): string {
  if (!finite(min)) return DASH;
  return `${Math.round(min * 10) / 10} min`;
}

const count = (n: number | null | undefined): string => (finite(n) ? String(n) : '0');

/** "3 / 4"; zero or invalid denominator -> "—". */
function ratio(num: number, den: number): string {
  if (!finite(den) || den <= 0 || !finite(num)) return DASH;
  return `${num} / ${den}`;
}

export function toMetricCards(m: Metrics): MetricCard[] {
  const hasRequests = finite(m.requested) && m.requested > 0;
  return [
    {
      key: 'matched', label: 'Projected matched', kind: 'projected',
      value: ratio(m.matched, m.requested),
      caption: 'Projected: packages matched out of requested',
    },
    {
      key: 'mix', label: 'Projected direct / relay / unmatched', kind: 'projected',
      value: `${count(m.direct)} / ${count(m.relay)} / ${count(m.unmatched)}`,
      caption: 'Projected: direct vs relay vs unmatched',
    },
    {
      key: 'savings', label: 'Projected customer savings', kind: 'projected',
      value: hasRequests ? formatCents(m.projectedCustomerSavingsCents) : DASH,
      caption: 'Projected: saved vs the external courier',
    },
    {
      key: 'spend', label: 'Projected customer spend', kind: 'projected',
      value: hasRequests ? formatCents(m.projectedCustomerSpendCents) : DASH,
      caption: 'Projected: unmatched packages are priced at the external-courier assumption',
    },
    {
      key: 'contribution', label: 'Projected platform contribution', kind: 'projected',
      value: hasRequests ? formatCents(m.projectedPlatformContributionCents) : DASH,
      caption: 'Projected: platform margin once all matched packages are delivered',
    },
    {
      key: 'avgExtra', label: 'Projected avg extra min per trip', kind: 'projected',
      value: formatMin(m.avgExtraMinPerTrip),
      caption: 'Projected: average extra commuter time per trip',
    },
    {
      key: 'maxExtra', label: 'Projected max extra min per trip', kind: 'projected',
      value: formatMin(m.maxExtraMin),
      caption: 'Projected: longest single detour',
    },
    {
      key: 'extraDistance', label: 'Projected extra commuter distance', kind: 'projected',
      value: formatKm(m.extraDistanceM),
      caption: 'Projected: total added commuter distance',
    },
    {
      key: 'delivered', label: 'Delivered', kind: 'actual',
      value: ratio(m.delivered, m.requested),
      caption: 'Delivered so far out of requested',
    },
    {
      key: 'rewards', label: 'Rewards earned so far', kind: 'actual',
      value: formatCents(m.earnedRewardsCents),
      caption: 'Paid to commuters for completed legs',
    },
    {
      key: 'earnedContribution', label: 'Earned platform contribution', kind: 'actual',
      value: formatCents(m.earnedPlatformContributionCents),
      caption: 'Platform margin from delivered packages so far',
    },
  ];
}
