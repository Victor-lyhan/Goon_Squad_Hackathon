import type { BusinessDashboard } from '../../../../shared/api';
import { Card, formatCents } from '../../ui';
import './BusinessPortal.css';

export function SummaryCards({ totals }: { totals: BusinessDashboard['totals'] }) {
  const items = [
    { label: 'Packages sent', value: String(totals.sent) },
    { label: 'Matched', value: String(totals.matched) },
    { label: 'Delivered', value: String(totals.delivered) },
    { label: 'Spend', value: formatCents(totals.spendCents) },
  ];
  return (
    <div className="bp-summary">
      {items.map((i) => (
        <Card key={i.label} className="bp-summary__card">
          <div className="bp-summary__value">{i.value}</div>
          <div className="bp-summary__label">{i.label}</div>
        </Card>
      ))}
    </div>
  );
}
