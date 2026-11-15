import { useState } from 'react';
import type { BusinessDashboard, ShipmentView } from '../../../../../../shared/v2/api';
import type { NetworkBusiness } from '../../../../../../shared/v2/types';
import {
  EMPTY_TEXT, OPEN_LABEL, TIME_LABEL, arrivalText, hasTime, messageParts, notificationRows, rowName, visibleRows,
  type NotificationRow,
} from './activityModel';
import './activity.css';

type Props = {
  dashboard: BusinessDashboard;
  businesses?: NetworkBusiness[];
  onOpenShipment: (shipmentId: string) => void;
  /** The open package this business holds as the relay point (not in the dashboard's lists), for its row's time. */
  held?: ShipmentView | null;
};

/** What the panel remembers about one business, in memory only. */
type Seen = {
  businessId: string;
  /** Rows that are not "New": there on the first render, or opened since. */
  ids: Set<string>;
  /** Rows the live region has already spoken for (the first render's rows are never announced). */
  announced: Set<string>;
  /** The live region's sentence: the last arrival, '' until one comes. */
  arrival: string;
};

/**
 * The business's notifications, newest first. "New" marks live in memory only (DECISIONS pass 9):
 * the first render and a change of business flag nothing; a notification that arrives later is
 * "New" until its row is opened, and is read out once by the panel's polite live region (#892).
 */
export function NotificationsPanel({ dashboard, businesses = [], onOpenShipment, held = null }: Props) {
  const ids = () => new Set(dashboard.notifications.map((n) => n.id));
  const fresh = (): Seen => ({ businessId: dashboard.business.id, ids: ids(), announced: ids(), arrival: '' });
  const [seen, setSeen] = useState<Seen>(fresh);
  const [showAll, setShowAll] = useState(false);
  const sameBusiness = seen.businessId === dashboard.business.id;
  if (!sameBusiness) {
    // Render-time reset (React's "adjust state on prop change" pattern).
    setSeen(fresh());
    setShowAll(false);
  }
  const rows = notificationRows(dashboard, businesses, seen.ids, held);
  const arrived = sameBusiness ? rows.filter((r) => !seen.announced.has(r.id)) : [];
  if (arrived.length > 0) {
    // Same pattern: each arrival is noted once, so the sentence changes only when something new came.
    setSeen((s) => ({ ...s, announced: new Set([...s.announced, ...arrived.map((r) => r.id)]), arrival: arrivalText(arrived) }));
  }
  const open = (row: NotificationRow) => {
    if (!row.shipmentId) return;
    if (row.isNew) setSeen((s) => ({ ...s, ids: new Set([...s.ids, row.id]) }));
    onOpenShipment(row.shipmentId);
  };
  return (
    <NotificationsList rows={rows} showAll={showAll} onShowAll={() => setShowAll(true)} onOpen={open}
      arrival={sameBusiness ? seen.arrival : ''} />
  );
}

type ListProps = {
  rows: NotificationRow[];
  showAll: boolean;
  onShowAll: () => void;
  onOpen: (row: NotificationRow) => void;
  /** The sentence about the notifications that just arrived; '' when none has. Read out, not shown. */
  arrival?: string;
};

/** Stateless view of the panel (no hooks), so tests can call its handlers directly. */
export function NotificationsList({ rows, showAll, onShowAll, onOpen, arrival = '' }: ListProps) {
  const shown = visibleRows(rows, showAll);
  return (
    <section className="ba-notes" aria-labelledby="ba-notes-title">
      <h2 id="ba-notes-title" className="ba-notes__title">
        Notifications <span className="ba-notes__count">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="ba-notes__empty">{EMPTY_TEXT}</p>
      ) : (
        <ul className="ba-notes__list">
          {shown.rows.map((r) => <NotificationItem key={r.id} row={r} onOpen={onOpen} />)}
        </ul>
      )}
      {shown.hiddenCount > 0 && (
        <button type="button" className="ba-notes__more" onClick={onShowAll}>Show all ({shown.total})</button>
      )}
      {/* In the page from the first render and empty until something arrives, so a screen reader
          hears each arrival once, when it has time ("polite"). Not shown: the row itself is on screen. */}
      <p className="ba-notes__live" role="status" aria-live="polite">{arrival}</p>
    </section>
  );
}

export function NotificationItem({ row: r, onOpen }: { row: NotificationRow; onOpen: (row: NotificationRow) => void }) {
  const text = (
    <span className="ba-note__text">
      {r.isNew && <span className="ba-note__new">New</span>}
      {r.tag && <span className="ba-note__tag">{r.tag}</span>}
      {/* The server's sentence, unchanged; a price in it is its own mono element (docs/mvp3.md P4). */}
      <span className="ba-note__msg">
        {messageParts(r.message).map((part, i) => (
          part.mono ? <span key={i} className="ba-mono">{part.text}</span> : part.text
        ))}
      </span>
    </span>
  );
  // The package's ready time, with its word. A row without a time shows nothing here, not a dash.
  const ready = hasTime(r) && (
    <span className="ba-note__ready">{TIME_LABEL} <span className="ba-note__time">{r.time}</span></span>
  );
  return (
    <li className={r.isNew ? 'ba-note ba-note--new' : 'ba-note'}>
      {r.shipmentId ? (
        <button type="button" className="ba-note__btn" onClick={() => onOpen(r)} aria-label={rowName(r)}>
          {text}
          <span className="ba-note__foot">
            {ready}
            <span className="ba-note__action">{OPEN_LABEL} <span className="ba-note__open">{r.shipmentId}</span></span>
          </span>
        </button>
      ) : (
        <div className="ba-note__static">
          {text}
          {ready && <span className="ba-note__foot">{ready}</span>}
        </div>
      )}
    </li>
  );
}
