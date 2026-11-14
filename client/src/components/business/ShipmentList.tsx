import type { ShipmentView } from '../../../../shared/api';
import type { Business, Hub } from '../../../../shared/types';
import { EmptyState, StatusPill, statusLabel } from '../../ui';
import { countText, modeText, sortShipmentViews } from './businessPortalModel';
import { etaText } from './trackingModel';
import './tracking.css';

export type ShipmentListProps = {
  views: ShipmentView[];
  direction: 'outgoing' | 'incoming';
  businesses: Business[];
  hubs?: Hub[];
  selectedId?: string;
  onSelect(id: string): void;
};

export function ShipmentList({ views, direction, businesses, hubs = [], selectedId, onSelect }: ShipmentListProps) {
  if (views.length === 0) {
    return (
      <EmptyState
        title={direction === 'outgoing' ? 'No outgoing packages yet' : 'No incoming packages yet'}
        description={direction === 'outgoing' ? 'Packages you send will show up here.' : 'Packages other businesses send to you will show up here.'}
      />
    );
  }
  const name = (id: string) => businesses.find((b) => b.id === id)?.name ?? 'Business';
  const sorted = sortShipmentViews(views);
  return (
    <>
    <p className="trk-count" aria-live="polite">{countText(sorted.length)}</p>
    <ul className="trk-list">
      {sorted.map((v) => {
        const s = v.shipment;
        const counterpart = name(direction === 'outgoing' ? s.destinationBusinessId : s.originBusinessId);
        return (
          <li key={s.id}>
            <button
              type="button"
              className={`trk-row${selectedId === s.id ? ' trk-row--selected' : ''}`}
              aria-current={selectedId === s.id ? 'true' : undefined}
              aria-label={`${s.label}, ${v.plan ? statusLabel(v.status) : 'No match yet'}, ${direction === 'outgoing' ? 'to' : 'from'} ${counterpart}`}
              onClick={() => onSelect(s.id)}
            >
              <span className="trk-row__label" title={`${s.label} (${s.id})`}>{s.label}</span>
              <span className="trk-row__id" title={s.id}>{s.id}</span>
              <span className="trk-row__who" title={counterpart}>{direction === 'outgoing' ? 'To' : 'From'} {counterpart}</span>
              {v.plan ? <StatusPill status={v.status} /> : <span className="trk-row__nomatch">No match yet</span>}
              <span className="trk-row__eta">{etaText(v)}</span>
              {v.plan ? (
                <span className="trk-row__mode">{modeText(v.plan, hubs)}</span>
              ) : (
                <span className="trk-row__reason">{v.unmatchedReason ?? 'No carrier is available for this package yet.'}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
    </>
  );
}
