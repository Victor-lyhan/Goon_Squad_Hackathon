import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isEchoPress, pressOf, type Press } from './NewDeliveryForm';
import type { ListLoadKind, ShipmentRow, SortDir, SortKey } from './shipmentsTableModel';
import {
  LIST_ALL_REMOVED_TEXT, LIST_ALL_REMOVED_TITLE, LIST_EMPTY_TEXT, LIST_EMPTY_TITLE, LIST_ERROR_TEXT, LIST_ERROR_TITLE,
  LIST_FILTERED_TITLE, LIST_LOADING_TEXT, LIST_REMOVED_WORD, LIST_RETRYING_LABEL, LIST_RETRY_LABEL, LIST_SHOW_ALL_LABEL,
  LIST_SHOW_ALL_NAME, LIST_STALE_TEXT, LIST_TITLE, NAMES_WAIT_MS, REMOVE_COLUMN, REMOVE_TITLE, listLoadKind, namesMissing,
  removeLabel, shipmentCountText,
} from './shipmentsTableModel';
import './businessWorkspace.css';

/**
 * What the list shows instead of, or above, its rows (#881). `loading`: no rows yet. `error`: the deliveries
 * could not be read or updated; rows already loaded stay on screen under a line that says so, with the retry.
 */
export type ShipmentsListLoad = { kind: Exclude<ListLoadKind, 'error'> } | { kind: 'error'; onRetry: () => void | Promise<void> };

const LIST_READY: ShipmentsListLoad = { kind: 'ready' };

/**
 * The list's load state, set by the page around the workspace (pages/v2/BusinessV2.tsx), so the view between
 * them passes nothing through. Without a provider the list is `ready`. The `load` prop wins over it.
 */
export const ShipmentsListLoadContext = createContext<ShipmentsListLoad>(LIST_READY);

/**
 * The value for ShipmentsListLoadContext, from the workspace state and the page's retry. Deliveries whose
 * business names have not arrived are `loading` for `namesWaitMs` only: if the names keep failing while the
 * deliveries load, the rows show without them ("Unknown business") under the line with the retry, instead
 * of "Loading deliveries…" for good. The retry polls again, and every poll asks for the missing names.
 */
export function useShipmentsListLoad(
  ws: Parameters<typeof listLoadKind>[0],
  onRetry: () => void | Promise<void>,
  namesWaitMs: number = NAMES_WAIT_MS,
): ShipmentsListLoad {
  const waiting = namesMissing(ws);
  const [namesLate, setNamesLate] = useState(false);
  useEffect(() => {
    if (!waiting) { setNamesLate(false); return undefined; }
    const timer = setTimeout(() => setNamesLate(true), namesWaitMs);
    return () => clearTimeout(timer);
  }, [waiting, namesWaitMs]);
  const kind = listLoadKind(ws, namesLate);
  return useMemo<ShipmentsListLoad>(() => (kind === 'error' ? { kind, onRetry } : { kind }), [kind, onRetry]);
}

export type ShipmentsTableProps = {
  /** Rows to show, already filtered and sorted by the model. */
  rows: ShipmentRow[];
  /** Number of rows before filtering (tells "no deliveries yet" from "no match"). */
  totalCount: number;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  selectedId: string | null;
  onSelect: (shipmentId: string) => void;
  onNewDelivery: () => void;
  /** Disable the empty state's New delivery button (the run is locked), like the toolbar's. */
  newDeliveryDisabled?: boolean;
  onClearFilters: () => void;
  /** Loading / error state of the list; default: the page's ShipmentsListLoadContext, else ready. */
  load?: ShipmentsListLoad;
  /**
   * Hides a delivery from this list (#949). With it every row ends in a Remove button. Nothing is cancelled:
   * the caller only leaves the row out of `rows` and `totalCount` from then on.
   */
  onRemove?: (shipmentId: string) => void;
  /** How many deliveries are hidden from the list; above zero the list ends with "2 removed · Show all". */
  removedCount?: number;
  /** Brings every removed delivery back. */
  onShowAll?: () => void;
};

/**
 * `drop`: the column is hidden when the table's box is narrow, 1 first (businessWorkspace.css, #581).
 * `hidden`: never on screen. The shipment ID is a raw ID (#881): it stays in the markup as the row's key
 * (the search still finds a delivery by it), but no width shows it and assistive technology skips it.
 */
type Column = { key: SortKey | null; label: string; mono?: boolean; numeric?: boolean; drop?: 1 | 2 | 3; hidden?: boolean };

const COLUMNS: Column[] = [
  { key: 'label', label: 'Package' },
  { key: 'id', label: 'Shipment ID', mono: true, drop: 2, hidden: true },
  { key: null, label: 'Direction', drop: 3 },
  { key: 'counterpart', label: 'Business' },
  { key: 'status', label: 'Status' },
  { key: 'plan', label: 'Plan' },
  { key: 'ready', label: 'Ready', mono: true, drop: 1 },
  { key: 'deadline', label: 'Deadline', mono: true, drop: 1 },
  { key: 'delivery', label: 'Delivery', mono: true },
  { key: 'price', label: 'Price', mono: true, numeric: true },
];

/** Class of a column's header and body cells: `bw-col--drop1` … for a column that drops, else nothing. */
const dropClass = (label: string) => {
  const drop = COLUMNS.find((c) => c.label === label)?.drop;
  return drop ? `bw-col--drop${drop}` : '';
};
const cls = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined;

const ariaSort = (dir: SortDir) => (dir === 'asc' ? 'ascending' : 'descending');

/** "Try again": disabled with "Trying again…" until the retry settles, so a second press sends nothing. */
function RetryButton({ onRetry }: { onRetry: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try { await onRetry(); } catch { /* the list's state says what happened */ } finally { if (alive.current) setBusy(false); }
  };
  return (
    // Not a primary button: New delivery in the toolbar above stays the page's one filled button.
    <button type="button" className="bw-btn" onClick={() => { void retry(); }} disabled={busy}>
      {busy ? LIST_RETRYING_LABEL : LIST_RETRY_LABEL}
    </button>
  );
}

export function ShipmentsTable(props: ShipmentsTableProps) {
  const fromPage = useContext(ShipmentsListLoadContext);
  const load = props.load ?? fromPage;
  const lastSelected = useRef(props.selectedId);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  /** The caption, or the title of a state box: where focus goes when the closed delivery has no row. */
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

  // Remove and Show all take the pressed button away with them (#949). Focus then goes to the Remove button
  // of the row that moved up into the removed row's place (the one above for the last row), so the next
  // delivery can be removed with one more key press; with no row left, to Show all. After Show all it goes
  // to the list's heading. A press that changed nothing moves nothing.
  const showAllRef = useRef<HTMLButtonElement>(null);
  /** The last pointer press on a Remove button, to tell a double press from two presses. */
  const removePress = useRef<Press | null>(null);
  const pressed = useRef<{ kind: 'remove'; id: string; index: number } | { kind: 'showAll' } | null>(null);
  const removedCount = props.onShowAll ? props.removedCount ?? 0 : 0;
  useEffect(() => {
    const last = pressed.current;
    if (!last) return;
    pressed.current = null;
    if (last.kind === 'showAll') {
      if (removedCount === 0) headingRef.current?.focus();
      return;
    }
    if (props.rows.some((r) => r.id === last.id)) return;
    const rows = tbodyRef.current?.rows;
    const row = rows && rows.length > 0 ? rows[Math.min(last.index, rows.length - 1)] : null;
    (row?.querySelector<HTMLElement>('.bw-remove') ?? showAllRef.current ?? headingRef.current)?.focus();
  });

  /** One box for every state without rows: a heading (the list's h2 in that state), one line, one action. */
  const stateBox = (title: string, text: string | null, action: ReactNode, role: 'status' | 'alert' = 'status') => (
    <div className="bw-empty" role={role}>
      <h2 className="bw-empty__title" tabIndex={-1} ref={setHeading}>{title}</h2>
      {text && <p className="bw-empty__text">{text}</p>}
      {action}
    </div>
  );

  /** The last line of the list while deliveries are hidden from it: how many, and the way back. */
  const removedLine = removedCount > 0 && (
    <p className="bw-removed" role="status">
      <span className="bw-mono">{removedCount}</span> {LIST_REMOVED_WORD} ·{' '}
      <button
        type="button"
        className="bw-removed__show"
        ref={showAllRef}
        aria-label={LIST_SHOW_ALL_NAME}
        onClick={() => { pressed.current = { kind: 'showAll' }; props.onShowAll?.(); }}
      >
        {LIST_SHOW_ALL_LABEL}
      </button>
    </p>
  );
  /** A state box with that line under it. */
  const withRemovedLine = (box: ReactNode) => (removedLine ? <div className="bw-list">{box}{removedLine}</div> : box);

  if (load.kind === 'loading') return stateBox(LIST_LOADING_TEXT, null, null);
  // Nothing was ever loaded: only the error. With rows on screen the error is the line above them (below).
  if (load.kind === 'error' && props.totalCount === 0 && removedCount === 0) {
    return stateBox(LIST_ERROR_TITLE, LIST_ERROR_TEXT, <RetryButton onRetry={load.onRetry} />, 'alert');
  }
  const stale = load.kind === 'error' && (
    <p className="bw-stale" role="status">
      <span>{LIST_STALE_TEXT}</span>
      <RetryButton onRetry={load.onRetry} />
    </p>
  );

  if (props.totalCount === 0 && removedCount > 0) {
    // Every delivery is hidden: the box says so instead of "No deliveries yet", and Show all is under it.
    return <>{stale}{withRemovedLine(stateBox(LIST_ALL_REMOVED_TITLE, LIST_ALL_REMOVED_TEXT, null))}</>;
  }
  if (props.totalCount === 0) {
    return stateBox(LIST_EMPTY_TITLE, LIST_EMPTY_TEXT, (
      <button type="button" className="bw-btn bw-btn--primary" onClick={props.onNewDelivery} disabled={props.newDeliveryDisabled}>
        New delivery
      </button>
    ));
  }
  if (props.rows.length === 0) {
    return (
      <>
        {stale}
        {withRemovedLine(stateBox(LIST_FILTERED_TITLE, `${shipmentCountText(props.totalCount)} in total.`, (
          <button type="button" className="bw-btn" onClick={props.onClearFilters}>Clear filters</button>
        )))}
      </>
    );
  }

  const sortedCol = COLUMNS.find((c) => c.key === props.sort.key);
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    // A key pressed on the row's Remove button is that button's, not the row's.
    if (e.target !== e.currentTarget) return;
    // Enter and Space open the delivery, like a button; Space must not scroll the page instead.
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onSelect(id); }
  };
  const { onRemove } = props;

  return (
    <div className="bw-table-wrap">
      {stale}
      <table className="bw-table">
        <caption className="bw-table__caption" tabIndex={-1} ref={setHeading}>
          {/* The list's heading: h1 business, then h2 Deliveries, the open delivery and Notifications. */}
          <h2 className="bw-table__title">{LIST_TITLE}</h2>{' '}
          {/* "Deliveries 4", like "Notifications 5" beside it; the word is there for a screen reader only. */}
          <span className="bw-table__count">
            {props.rows.length === props.totalCount ? props.totalCount : `${props.rows.length} of ${props.totalCount}`}
            <span className="bw-visually-hidden"> {props.totalCount === 1 ? 'delivery' : 'deliveries'}</span>
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
                  className={cls(c.numeric && 'bw-num', dropClass(c.label))}
                  aria-sort={sorted ? ariaSort(props.sort.dir) : undefined}
                  hidden={c.hidden}
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
            {/* The column of Remove buttons: its name is for a screen reader, the buttons name themselves. */}
            {onRemove && (
              <th scope="col" className="bw-col--remove"><span className="bw-visually-hidden">{REMOVE_COLUMN}</span></th>
            )}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {props.rows.map((r, index) => {
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
                <td data-label="Shipment ID" className={cls('bw-mono', dropClass('Shipment ID'))} hidden>{r.id}</td>
                <td data-label="Direction" className={cls(dropClass('Direction'))}>{r.directionLabel}</td>
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
                <td data-label="Ready" className={cls('bw-mono', dropClass('Ready'))}>{r.readyText}</td>
                <td data-label="Deadline" className={cls('bw-mono', dropClass('Deadline'))}>{r.deadlineText}</td>
                <td data-label="Delivery" className="bw-mono">{r.deliveryText}</td>
                <td data-label="Price" className="bw-mono bw-num">{r.priceText}</td>
                {onRemove && (
                  <td data-label={REMOVE_COLUMN} className="bw-cell--remove">
                    <button
                      type="button"
                      className="bw-remove"
                      aria-label={removeLabel(r.label)}
                      title={REMOVE_TITLE}
                      // The row around it opens the delivery on a click; this press only hides the row.
                      onClick={(e) => {
                        e.stopPropagation();
                        // The next row moves up under the pointer: the second press of a double press would
                        // remove that one too, so it is dropped (as on the New delivery form, #807).
                        if (isEchoPress(e, removePress.current)) return;
                        removePress.current = pressOf(e, '.bw-remove');
                        pressed.current = { kind: 'remove', id: r.id, index };
                        onRemove(r.id);
                      }}
                    >
                      <svg className="bw-remove__icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {removedLine}
    </div>
  );
}
