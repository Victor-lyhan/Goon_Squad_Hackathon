import type { Metrics } from '../../../../../shared/v2/types';

export type RunSummaryProps = { metrics: Metrics };

const EMPTY = '—';
const num = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : EMPTY);
const ratio = (a: number, b: number) => `${num(a)} / ${num(b)}`;
const minutes = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) ? `${Number.isInteger(n) ? n : n.toFixed(1)} min` : EMPTY;

/** Under the numbers while no package is picked (#883): what to do to see a journey. */
export const PICK_A_PACKAGE_TEXT = 'Pick a package on the left to see its journey.';

/** Right panel content when nothing is selected. Renders the API's metrics; computes nothing. */
export function RunSummary({ metrics: m }: RunSummaryProps) {
  const rows = [
    { key: 'delivered', label: 'Delivered', value: ratio(m.delivered, m.requested) },
    { key: 'matched', label: 'Matched', value: ratio(m.matched, m.requested) },
    { key: 'extra', label: 'Extra per trip', value: minutes(m.avgExtraMinPerTrip) },
  ];
  return (
    <div className="sw-summary">
      <h2 className="sw-section-title">Run summary</h2>
      <dl className="sw-summary-list">
        {rows.map((r) => (
          <div key={r.key} className="sw-summary-row" data-testid={`summary-${r.key}`}>
            <dt>{r.label}</dt>
            <dd className="sw-mono">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="sw-summary-hint">{PICK_A_PACKAGE_TEXT}</p>
    </div>
  );
}
