import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ShipmentRow, SortDir, SortKey } from './shipmentsTableModel';
import { shipmentCountText } from './shipmentsTableModel';
import './businessWorkspace.css';

export type ShipmentsTableProps = {
  /** Rows to show, already filtered and sorted by the model. */
  rows: ShipmentRow[];
  /** Number of rows before filtering (tells "no shipments yet" from "no match"). */
  totalCount: number;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  selectedId: string | null;
  onSelect: (shipmentId: string) => void;
  onNewDelivery: () => void;
  onClearFilters: () => void;
};

type Column = { key: SortKey | null; label: string; mono?: boolean; numeric?: boolean };

const COLUMNS: Column[] = [
  { key: 'label', label: 'Package' },
  { key: 'id', label: 'Shipment ID', mono: true },
  { key: null, label: 'Direction' },
  { key: 'counterpart', label: 'Business' },
  { key: 'status', label: 'Status' },
  { key: 'plan', label: 'Plan' },
  { key: 'ready', label: 'Ready', mono: true },
  { key: 'deadline', label: 'Deadline', mono: true },
  { key: 'delivery', label: 'Delivery', mono: true },
  { key: 'price', label: 'Price', mono: true, numeric: true },
];

const ariaSort = (dir: SortDir) => (dir === 'asc' ? 'ascending' : 'descending');

export function ShipmentsTable(props: ShipmentsTableProps) {
  const lastSelected = useRef(props.selectedId);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  /** The caption, or the title of an empty state: where focus goes when the closed delivery has no row. */
  const headingRef = useRef<HTMLElement | null>(null);
  const setHeading = (el: HTMLElement | null) => { headingRef.current = el; };

  // Closing a delivery (Close, Esc) removes its panel and the focused element with it. Focus then goes to
  // that delivery's row, or to the heading when the row is filtered out, so the user keeps their place
  // (#609). Focus that is somewhere else on the page is left alone.
  useEffect(() => {
    const closedId = lastSelected.current;
    lastSelected.current = props.selectedId;
    if (closedId === null || props.selectedId !== null) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const index = props.rows.findIndex((r) => r.id === closedId);
    const row = index >= 0 ? tbodyRef.current?.rows[index] : null;
    (row ?? headingRef.current)?.focus();
    // Only a change of the selection moves focus; a poll that brings new rows does not.
  }, [props.selectedId]);

  if (props.totalCount === 0) {
    return (
      <div className="bw-empty" role="status">
        <p className="bw-empty__title" tabIndex={-1} ref={setHeading}>No shipments yet</p>
        <p className="bw-empty__text">Create a delivery request and Relay matches it to an employee commute.</p>
        <button type="button" className="bw-btn bw-btn--primary" onClick={props.onNewDelivery}>New delivery</button>
      </div>
    );
  }
  if (props.rows.length === 0) {
    return (
      <div className="bw-empty" role="status">
        <p className="bw-empty__title" tabIndex={-1} ref={setHeading}>No shipments match the filters</p>
        <p className="bw-empty__text">{shipmentCountText(props.totalCount)} in total.</p>
        <button type="button" className="bw-btn" onClick={props.onClearFilters}>Clear filters</button>
      </div>
    );
  }

  const sortedCol = COLUMNS.find((c) => c.key === props.sort.key);
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (e.key === 'Enter') { e.preventDefault(); props.onSelect(id); }
  };

  return (
    <div className="bw-table-wrap">
      <table className="bw-table">
        <caption className="bw-table__caption" tabIndex={-1} ref={setHeading}>
          Shipments
          <span className="bw-table__count">
            {props.rows.length === props.totalCount
              ? shipmentCountText(props.totalCount)
              : `${props.rows.length} of ${shipmentCountText(props.totalCount)}`}
          </span>
          {sortedCol && (
            <span className="bw-visually-hidden">, sorted by {sortedCol.label}, {ariaSort(props.sort.dir)}</span>
          )}
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((c) => {
              const sorted = c.key !== null && c.key === props.sort.key;
              return (
                <th
                  key={c.label}
                  scope="col"
                  className={c.numeric ? 'bw-num' : undefined}
                  aria-sort={sorted ? ariaSort(props.sort.dir) : undefined}
                >
                  {c.key === null ? c.label : (
                    <button type="button" className="bw-sort" onClick={() => props.onSort(c.key as SortKey)}>
                      {c.label}
                      <span className="bw-sort__icon" aria-hidden="true">
                        {sorted ? (props.sort.dir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {props.rows.map((r) => {
            const selected = r.id === props.selectedId;
            return (
              <tr
                key={r.id}
                className="bw-row"
                tabIndex={0}
                aria-selected={selected}
                onClick={() => props.onSelect(r.id)}
                onKeyDown={(e) => onRowKey(e, r.id)}
              >
                <td data-label="Package" className="bw-cell--primary">{r.label}</td>
                <td data-label="Shipment ID" className="bw-mono">{r.id}</td>
                <td data-label="Direction">{r.directionLabel}</td>
                <td data-label="Business">{r.counterpart}</td>
                <td data-label="Status">
                  <span className={`bw-status bw-status--${r.statusTone}`}>{r.statusLabel}</span>
                </td>
                <td data-label="Plan">
                  {/* One child per cell: the stacked 390 px cell is a two-column grid (label, value). */}
                  <div className="bw-plan">
                    {r.planKind === 'relay' && r.relayPointName
                      ? <>Relay <span className="bw-muted">via {r.relayPointName}</span></>
                      : r.planLabel}
                    {r.unmatchedReason && <span className="bw-reason">{r.unmatchedReason}</span>}
                  </div>
                </td>
                <td data-label="Ready" className="bw-mono">{r.readyText}</td>
                <td data-label="Deadline" className="bw-mono">{r.deadlineText}</td>
                <td data-label="Delivery" className="bw-mono">{r.deliveryText}</td>
                <td data-label="Price" className="bw-mono bw-num">{r.priceText}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
