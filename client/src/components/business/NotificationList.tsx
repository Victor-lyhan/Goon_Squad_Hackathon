import type { Notification } from '../../../../shared/types';
import { Card, EmptyState } from '../../ui';
import { newestFirst } from './businessPortalModel';
import './BusinessPortal.css';

export function NotificationList({ notifications, onSelect }: { notifications: Notification[]; onSelect?: (shipmentId: string) => void }) {
  const list = newestFirst(notifications);
  return (
    <Card title="Notifications">
      {list.length === 0 ? (
        <EmptyState title="No notifications yet" />
      ) : (
        <ul className="bp-notes">
          {list.map((n) => (
            <li key={n.id}>
              {onSelect ? <button type="button" className="bp-notes__btn" onClick={() => onSelect(n.shipmentId)}>{n.message}</button> : n.message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
