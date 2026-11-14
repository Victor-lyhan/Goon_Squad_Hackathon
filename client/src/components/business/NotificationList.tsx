import { useEffect, useRef } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import type { Business, Notification, Shipment } from '../../../../shared/types';
import { Card, EmptyState, Toast, useToasts } from '../../ui';
import { notificationRows, stepNotifications, type NotificationBaseline } from './notificationsModel';
import './BusinessPortal.css';

type Props = {
  notifications: Notification[];
  onSelect?: (shipmentId: string) => void;
  /** Optional: enables times and sender -> recipient names. */
  shipments?: Shipment[];
  businesses?: Business[];
  /** Optional: a change resets the "new since last poll" baseline. */
  runId?: string;
  /** Set false when the parent already shows toasts. Default true. */
  toasts?: boolean;
};

export function NotificationList({ notifications, onSelect, shipments, businesses, runId, toasts: showToasts = true }: Props) {
  const inRouter = useInRouterContext();
  const rows = notificationRows(notifications, shipments, businesses);
  const { toasts, push, dismiss } = useToasts();
  const base = useRef<NotificationBaseline | null>(null);
  useEffect(() => {
    const step = stepNotifications(base.current, runId, notifications);
    base.current = step.baseline;
    if (!showToasts) return;
    const byId = new Map(notifications.map((n) => [n.id, n]));
    for (const id of step.newIds) { const n = byId.get(id); if (n) push(n.message, 'success'); }
  }, [notifications, runId, showToasts, push]);

  return (
    <Card title="Notifications">
      {showToasts && <Toast toasts={toasts} onDismiss={dismiss} />}
      {rows.length === 0 ? (
        <EmptyState title="No notifications yet" />
      ) : (
        <ul className="bp-notes">
          {rows.map((r) => (
            <li key={r.id}>
              {onSelect ? <button type="button" className="bp-notes__btn" onClick={() => onSelect(r.shipmentId)}>{r.message}</button> : r.message}
              {(r.timeLabel || r.route) && <div className="bp-notes__meta">{[r.timeLabel, r.route].filter(Boolean).join(' · ')}</div>}
              {r.href && (inRouter ? <Link to={r.href}>Track package</Link> : <a href={r.href}>Track package</a>)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
