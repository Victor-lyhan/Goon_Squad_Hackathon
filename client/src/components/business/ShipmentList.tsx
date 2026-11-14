import type { ShipmentView } from '../../../../shared/api';
import type { Business } from '../../../../shared/types';
import { EmptyState, StatusPill } from '../../ui';
import { etaText } from './trackingModel';
import './tracking.css';

export type ShipmentListProps = {
  views: ShipmentView[];
  direction: 'outgoing' | 'incoming';
  businesses: Business[];
  selectedId?: string;
  onSelect(id: string): void;
};

export function ShipmentList({ views, direction, businesses, selectedId, onSelect }: ShipmentListProps) {
  if (views.length === 0) {
    return <EmptyState title={direction === 'outgoing' ? 'No outgoing packages yet' : 'No incoming packages yet'} />;
  }
  const name = (id: string) => businesses.find((b) => b.id === id)?.name ?? 'Business';
  return (
    <ul className="trk-list">
      {views.map((v) => {
        const s = v.shipment;
        const counterpart = name(direction === 'outgoing' ? s.destinationBusinessId : s.originBusinessId);
        return (
          <li key={s.id}>
            <button
              type="button"
              className={`trk-row${selectedId === s.id ? ' trk-row--selected' : ''}`}
              aria-current={selectedId === s.id ? 'true' : undefined}
              onClick={() => onSelect(s.id)}
            >
              <span className="trk-row__label">{s.label}</span>
              <span className="trk-row__who">{direction === 'outgoing' ? 'To' : 'From'} {counterpart}</span>
              {v.plan ? <StatusPill status={v.status} /> : <span className="trk-row__nomatch">No match yet</span>}
              <span className="trk-row__eta">{etaText(v)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
