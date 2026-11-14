import { useMemo, useState } from 'react';
import type { Business, DeliveryPlan, Shipment, Snapshot } from '../../../../shared/types';
import {
  STATUS_LABEL, STATUS_ORDER, countByStatus, filterRows, toQueueRows, type QueueFilter,
} from './packageQueueModel';
import './PackageQueue.css';

export type PackageQueueProps = {
  shipments: Shipment[];
  plans: DeliveryPlan[];
  snapshot: Pick<Snapshot, 'shipmentStatus'>;
  businesses: Business[];
  selectedId?: string;
  onSelect: (shipmentId: string) => void;
};

export function PackageQueue({ shipments, plans, snapshot, businesses, selectedId, onSelect }: PackageQueueProps) {
  const [filter, setFilter] = useState<QueueFilter>('all');
  const rows = useMemo(
    () => toQueueRows(shipments, plans, snapshot.shipmentStatus, businesses),
    [shipments, plans, snapshot.shipmentStatus, businesses],
  );
  const counts = useMemo(() => countByStatus(rows), [rows]);
  const visible = filterRows(rows, filter);
  const filters: QueueFilter[] = ['all', ...STATUS_ORDER];

  return (
    <section className="pq" aria-label="Package queue">
      <div className="pq-filters" role="group" aria-label="Filter by status">
        {filters.map((f) => (
          <button key={f} type="button" className="pq-filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : STATUS_LABEL[f]} ({counts[f]})
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="pq-empty">{rows.length === 0 ? 'No packages yet.' : 'No packages with this status.'}</div>
      ) : (
        <ul className="pq-list">
          {visible.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="pq-row"
                aria-current={r.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(r.id)}
              >
                <div className="pq-top">
                  <span>{r.label}</span>
                  <span className={`pq-pill pq-pill-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                </div>
                <div className="pq-route">{r.sender} → {r.recipient}</div>
                {r.tag && <div className="pq-meta"><span className="pq-tag">{r.tag}</span></div>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
