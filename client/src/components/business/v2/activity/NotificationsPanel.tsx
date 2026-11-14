import { useState } from 'react';
import type { BusinessDashboard } from '../../../../../../shared/v2/api';
import type { NetworkBusiness } from '../../../../../../shared/v2/types';
import { EMPTY_TEXT, notificationRows, visibleRows, type NotificationRow } from './activityModel';
import './activity.css';

type Props = {
  dashboard: BusinessDashboard;
  businesses?: NetworkBusiness[];
  onOpenShipment: (shipmentId: string) => void;
};

/**
 * The business's notifications, newest first. "New" marks live in memory only (DECISIONS pass 9):
 * the first render and a change of business flag nothing; a notification that arrives later is
 * "New" until its row is opened.
 */
export function NotificationsPanel({ dashboard, businesses = [], onOpenShipment }: Props) {
  const ids = () => new Set(dashboard.notifications.map((n) => n.id));
  const [seen, setSeen] = useState<{ businessId: string; ids: Set<string> }>(() => ({
    businessId: dashboard.business.id, ids: ids(),
  }));
  const [showAll, setShowAll] = useState(false);
  if (seen.businessId !== dashboard.business.id) {
    // Render-time reset (React's "adjust state on prop change" pattern).
    setSeen({ businessId: dashboard.business.id, ids: ids() });
    setShowAll(false);
  }
  const rows = notificationRows(dashboard, businesses, seen.ids);
  const open = (row: NotificationRow) => {
    if (!row.shipmentId) return;
    if (row.isNew) setSeen((s) => ({ ...s, ids: new Set([...s.ids, row.id]) }));
    onOpenShipment(row.shipmentId);
  };
  return <NotificationsList rows={rows} showAll={showAll} onShowAll={() => setShowAll(true)} onOpen={open} />;
}

type ListProps = {
  rows: NotificationRow[];
  showAll: boolean;
  onShowAll: () => void;
  onOpen: (row: NotificationRow) => void;
};

/** Stateless view of the panel (no hooks), so tests can call its handlers directly. */
export function NotificationsList({ rows, showAll, onShowAll, onOpen }: ListProps) {
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
    </section>
  );
}

export function NotificationItem({ row: r, onOpen }: { row: NotificationRow; onOpen: (row: NotificationRow) => void }) {
  const body = (
    <>
      <span className="ba-note__time">{r.time}</span>
      <span className="ba-note__text">
        {r.isNew && <span className="ba-note__new">New</span>}
        {r.tag && <span className="ba-note__tag">{r.tag}</span>}
        <span className="ba-note__msg">{r.message}</span>
      </span>
    </>
  );
  return (
    <li className={r.isNew ? 'ba-note ba-note--new' : 'ba-note'}>
      {r.shipmentId ? (
        <button type="button" className="ba-note__btn" onClick={() => onOpen(r)}
          aria-label={`${r.isNew ? 'New. ' : ''}${r.tag ? `${r.tag}. ` : ''}${r.message} Open delivery ${r.shipmentId}`}>
          {body}
          <span className="ba-note__open">Open {r.shipmentId}</span>
        </button>
      ) : (
        <div className="ba-note__static">{body}</div>
      )}
    </li>
  );
}
