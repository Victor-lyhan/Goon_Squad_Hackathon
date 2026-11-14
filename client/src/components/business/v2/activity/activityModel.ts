// Pure model for the MVP II Business workspace header and activity (notifications) section.
// It only formats what the API returned: every number comes from `dashboard.totals` and every
// message is the server's text, unchanged (DECISIONS pass 50; frontend computes no metrics).
import type { BusinessDashboard, ShipmentView } from '../../../../../../shared/v2/api';
import type { NetworkBusiness, Notification } from '../../../../../../shared/v2/types';
import { formatCents, formatClock } from '../../../../ui/format';

export const DASH = '—';
export const ROLE_LINE = 'Network business · relay point';
export const RELAY_TAG = 'Relay point';
export const VISIBLE_ROWS = 20;
export const EMPTY_TEXT = 'No notifications yet.';

export type TotalItem = { key: 'sent' | 'matched' | 'delivered' | 'spend'; label: string; value: string };

export type HeaderModel = {
  id: string;
  name: string;
  address: string;
  /** "Astoria · Queens". */
  area: string;
  role: string;
  phaseLabel: string;
  phaseText: string;
  totals: TotalItem[];
  /** The totals as one line: "3 sent · 2 matched · 1 delivered · $30.50 spend". */
  totalsLine: string;
};

const PHASE: Record<BusinessDashboard['phase'], { label: string; text: string }> = {
  planning: { label: 'Planning', text: 'Deliveries can be added until the simulation starts.' },
  locked: { label: 'Locked', text: 'The simulation is running; deliveries are read-only.' },
};

const count = (n: number) => (Number.isFinite(n) ? String(Math.round(n)) : DASH);

export function headerModel(dashboard: BusinessDashboard): HeaderModel {
  const b = dashboard.business;
  const t = dashboard.totals;
  const totals: TotalItem[] = [
    { key: 'sent', label: 'sent', value: count(t.sent) },
    { key: 'matched', label: 'matched', value: count(t.matched) },
    { key: 'delivered', label: 'delivered', value: count(t.delivered) },
    { key: 'spend', label: 'spend', value: Number.isFinite(t.spendCents) ? formatCents(t.spendCents) : DASH },
  ];
  const phase = PHASE[dashboard.phase] ?? PHASE.planning;
  return {
    id: b.id,
    name: b.name,
    address: b.address,
    area: [b.neighborhood, b.borough].filter(Boolean).join(' · '),
    role: ROLE_LINE,
    phaseLabel: phase.label,
    phaseText: phase.text,
    totals,
    totalsLine: totals.map((x) => `${x.value} ${x.label}`).join(' · '),
  };
}

/** How this business is involved in the notification's shipment. */
export type NotificationRole = 'sender' | 'recipient' | 'relay' | 'other';

export type NotificationRow = {
  id: string;
  /**
   * Clock time ("5:00 PM") of the package's ready time when the dashboard has the shipment, or when it is
   * the open package held here as the relay point (`held`, #581); else "—".
   */
  time: string;
  message: string;
  role: NotificationRole;
  /** "Relay point" when the package is held at this business overnight; else null. */
  tag: string | null;
  /** Shipment to open, or null when the notification has none. */
  shipmentId: string | null;
  isNew: boolean;
};

/**
 * Newest first (server `createdSeq`). The role is read from the notification's own fields:
 * a business notification addressed to this business whose shipment this business neither sends
 * nor receives is about a package held here as a relay point. The message text is never parsed.
 * `businesses` is accepted for the page's call signature; names already come in the server text.
 * `held` is the open delivery the page read with GET /shipments/:id because the dashboard does not list it.
 */
export function notificationRows(
  dashboard: BusinessDashboard,
  _businesses: NetworkBusiness[] = [],
  seenIds: ReadonlySet<string> = new Set(),
  held: ShipmentView | null = null,
): NotificationRow[] {
  const me = dashboard.business.id;
  const views = new Map([...(held ? [held] : []), ...dashboard.outgoing, ...dashboard.incoming].map((v) => [v.shipment.id, v]));
  return [...dashboard.notifications]
    .filter((n) => n.audience === 'business' && n.audienceId === me)
    .sort((a, b) => b.createdSeq - a.createdSeq || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((n) => {
      const shipmentId = n.shipmentId && n.shipmentId.trim() ? n.shipmentId : null;
      const view = shipmentId ? views.get(shipmentId) : undefined;
      const role = roleOf(n, view?.shipment, me);
      const ready = view?.shipment.readyMin;
      return {
        id: n.id,
        time: typeof ready === 'number' && Number.isFinite(ready) ? formatClock(ready) : DASH,
        message: n.message,
        role,
        tag: role === 'relay' ? RELAY_TAG : null,
        shipmentId,
        isNew: !seenIds.has(n.id),
      };
    });
}

function roleOf(
  n: Notification, s: { originBusinessId: string; destinationBusinessId: string } | undefined, me: string,
): NotificationRole {
  if (s?.originBusinessId === me) return 'sender';
  if (s?.destinationBusinessId === me) return 'recipient';
  // No shipment at all: nothing is held here, so it is not a relay notification.
  if (!n.shipmentId || !n.shipmentId.trim()) return 'other';
  return 'relay';
}

/** First `VISIBLE_ROWS` rows unless expanded; `hiddenCount` > 0 means "Show all (N)" is offered. */
export function visibleRows<T>(rows: T[], showAll: boolean): { rows: T[]; hiddenCount: number; total: number } {
  if (showAll || rows.length <= VISIBLE_ROWS) return { rows, hiddenCount: 0, total: rows.length };
  return { rows: rows.slice(0, VISIBLE_ROWS), hiddenCount: rows.length - VISIBLE_ROWS, total: rows.length };
}
