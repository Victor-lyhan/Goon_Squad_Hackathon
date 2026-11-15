import { describe, expect, it } from 'vitest';
import {
  headerModel, notificationRows, visibleRows, RELAY_TAG, ROLE_LINE, VISIBLE_ROWS,
} from '../../client/src/components/business/v2/activity/activityModel';
import { BUSINESSES, DASHBOARD, ME, plan, shipment, view } from './business-v2-table-sample';
import { many, note, RECIPIENT, RELAY, SENDER, withNotes } from './business-v2-activity-sample';

describe('headerModel', () => {
  it('names the business, its place and its relay-point role', () => {
    const m = headerModel(DASHBOARD);
    expect(m.name).toBe('Acme Studio');
    expect(m.id).toBe('biz-acme');
    expect(m.address).toBe('1 Test St');
    expect(m.area).toBe('Midtown · Manhattan');
    expect(m.role).toBe(ROLE_LINE);
    expect(m.role).toBe('This business is also a relay point: packages can be held here overnight.');
    expect(m.phaseLabel).toBe('Planning');
    expect(headerModel({ ...DASHBOARD, phase: 'locked' }).phaseLabel).toBe('Locked');
  });

  it('shows dashboard.totals as one line (non-zero)', () => {
    expect(headerModel(DASHBOARD).totalsLine).toBe('3 sent · 2 matched · 1 delivered · $30.50 spend');
  });

  it('shows dashboard.totals as one line (zero)', () => {
    const m = headerModel({ ...DASHBOARD, totals: { sent: 0, matched: 0, delivered: 0, spendCents: 0 } });
    expect(m.totalsLine).toBe('0 sent · 0 matched · 0 delivered · $0.00 spend');
  });

  it('takes the totals from the server, not from the shipment lists', () => {
    const m = headerModel({ ...DASHBOARD, outgoing: [], incoming: [], totals: { sent: 9, matched: 8, delivered: 7, spendCents: 123456 } });
    expect(m.totalsLine).toBe('9 sent · 8 matched · 7 delivered · $1,234.56 spend');
  });

  it('never says hub', () => {
    expect(JSON.stringify(headerModel(DASHBOARD)).toLowerCase()).not.toContain('hub');
  });
});

describe('notificationRows', () => {
  it('orders rows newest first and keeps the server text unchanged', () => {
    const rows = notificationRows(withNotes([SENDER, RELAY, RECIPIENT]), BUSINESSES, new Set());
    expect(rows.map((r) => r.id)).toEqual([RELAY.id, RECIPIENT.id, SENDER.id]);
    expect(rows[2].message).toBe(SENDER.message);
  });

  it('tags a relay notification and not a sender or recipient one', () => {
    const rows = notificationRows(withNotes([SENDER, RECIPIENT, RELAY]), BUSINESSES, new Set());
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get(RELAY.id)).toMatchObject({ role: 'relay', tag: RELAY_TAG });
    expect(by.get(SENDER.id)).toMatchObject({ role: 'sender', tag: null });
    expect(by.get(RECIPIENT.id)).toMatchObject({ role: 'recipient', tag: null });
  });

  it('does not read the message text to decide the kind', () => {
    const tricky = { ...SENDER, message: 'Something via X (relay point).' };
    const [row] = notificationRows(withNotes([tricky]), BUSINESSES, new Set());
    expect(row.tag).toBeNull();
  });

  it('flags isNew against the seen set', () => {
    const rows = notificationRows(withNotes([SENDER, RECIPIENT]), BUSINESSES, new Set([SENDER.id]));
    expect(rows.find((r) => r.id === SENDER.id)!.isNew).toBe(false);
    expect(rows.find((r) => r.id === RECIPIENT.id)!.isNew).toBe(true);
  });

  it('gives a shipment ID to open, and none when the notification has no shipment', () => {
    const none = note('ntf-x', 5, { shipmentId: '' });
    const rows = notificationRows(withNotes([SENDER, none]), BUSINESSES, new Set());
    expect(rows.find((r) => r.id === SENDER.id)!.shipmentId).toBe('shp-1');
    const row = rows.find((r) => r.id === 'ntf-x')!;
    expect(row.shipmentId).toBeNull();
    expect(row.tag).toBeNull();
  });

  it('formats the time as a clock from the shipment ready time, or a dash', () => {
    const rows = notificationRows(withNotes([SENDER, RELAY]), BUSINESSES, new Set());
    expect(rows.find((r) => r.id === SENDER.id)!.time).toBe('5:00 PM'); // readyMin 1020
    expect(rows.find((r) => r.id === RELAY.id)!.time).toBe('—');
  });

  it('a relay notification shows the held package\'s time once the page has read it (#581)', () => {
    // shp-9 is in neither list; the page read it with GET /shipments/:id because it is open.
    const held = view(
      shipment('shp-9', { originBusinessId: 'biz-print', destinationBusinessId: 'biz-bakery', readyMin: 1035 }),
      plan('shp-9', { kind: 'relay', relayBusinessId: ME.id }), 'at_hub',
    );
    const rows = notificationRows(withNotes([SENDER, RELAY]), BUSINESSES, new Set(), held);
    const relay = rows.find((r) => r.id === RELAY.id)!;
    expect(relay.time).toBe('5:15 PM');
    expect(relay).toMatchObject({ role: 'relay', tag: RELAY_TAG, shipmentId: 'shp-9' });
    expect(rows.find((r) => r.id === SENDER.id)).toMatchObject({ time: '5:00 PM', role: 'sender' });
    // A held view never overrides one of the dashboard's own deliveries.
    const own = view(shipment('shp-1', { readyMin: 1 }), null, 'unmatched');
    expect(notificationRows(withNotes([SENDER]), BUSINESSES, new Set(), own)[0].time).toBe('5:00 PM');
    // Without it (closed, or not read yet) the row is unchanged.
    expect(notificationRows(withNotes([RELAY]), BUSINESSES, new Set(), null)[0].time).toBe('—');
  });

  it('keeps only this business\'s notifications', () => {
    const other = note('ntf-other', 9, { audienceId: 'biz-bakery' });
    const emp = note('ntf-emp', 10, { audience: 'employee', audienceId: 'emp-1' });
    expect(notificationRows(withNotes([SENDER, other, emp])).map((r) => r.id)).toEqual([SENDER.id]);
  });
});

describe('visibleRows', () => {
  it('shows the first 20 and counts the rest', () => {
    const rows = many(25);
    expect(visibleRows(rows, false)).toMatchObject({ hiddenCount: 5, total: 25 });
    expect(visibleRows(rows, false).rows).toHaveLength(VISIBLE_ROWS);
    expect(visibleRows(rows, true).rows).toHaveLength(25);
    expect(visibleRows(many(3), false)).toMatchObject({ hiddenCount: 0, total: 3 });
  });
});
