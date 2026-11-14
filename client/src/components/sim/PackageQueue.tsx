import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Business, DeliveryPlan, Shipment, Snapshot, UnmatchedReason } from '../../../../shared/types';
import {
  STATUS_LABEL, STATUS_ORDER, countByStatus, emptyCopy, filterRows, moveSelection, toQueueRows, type QueueFilter,
} from './packageQueueModel';
import { EmptyState } from '../../ui';
import './PackageQueue.css';

export type PackageQueueProps = {
  shipments: Shipment[];
  plans: DeliveryPlan[];
  snapshot: Pick<Snapshot, 'shipmentStatus'>;
  businesses: Business[];
  /** Backend reasons for unmatched packages (SimulatorResponse.unmatched). */
  unmatched?: UnmatchedReason[];
  selectedId?: string;
  onSelect: (shipmentId: string) => void;
};

export function PackageQueue({ shipments, plans, snapshot, businesses, unmatched, selectedId, onSelect }: PackageQueueProps) {
  const [filter, setFilter] = useState<QueueFilter>('all');
  const rows = useMemo(
    () => toQueueRows(shipments, plans, snapshot.shipmentStatus, businesses, unmatched),
    [shipments, plans, snapshot.shipmentStatus, businesses, unmatched],
  );
  const counts = useMemo(() => countByStatus(rows), [rows]);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const visible = filterRows(rows, filter, query);
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const next = moveSelection(visible.map((r) => r.id), selectedId, e.key);
    if (next === null) return;
    e.preventDefault();
    onSelect(next);
    listRef.current?.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus();
  };
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
      <input
        type="search"
        className="pq-search"
        aria-label="Find package by shipment ID, name or business"
        placeholder="Find by ID, name or business"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {visible.length === 0 ? (
        <EmptyState {...emptyCopy(rows.length, filter, query)} />
      ) : (
        <ul className="pq-list" aria-label="Packages (Up/Down, Home/End to move)" onKeyDown={onKeyDown} ref={listRef}>
          {visible.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="pq-row"
                data-id={r.id}
                aria-current={r.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(r.id)}
              >
                <div className="pq-top">
                  <span>{r.label}</span>
                  <span className={`pq-pill pq-pill-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                </div>
                <div className="pq-route">{r.sender} → {r.recipient}</div>
                {(r.tag || r.reason) && (
                  <div className="pq-meta">
                    {r.tag && <span className="pq-tag">{r.tag}</span>}
                    {r.reason && <span className="pq-reason">{r.reason}</span>}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
