import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import { NotificationList } from '../../client/src/components/business/NotificationList';
import { notificationRows, stepNotifications } from '../../client/src/components/business/notificationsModel';
import type { Notification } from '../../shared/types';

const n = (id: string, seq: number): Notification => ({
  id, audience: 'business', audienceId: 'biz-1', kind: 'delivery_matched', shipmentId: `s-${id}`, planId: 'p', message: `m ${id}`, createdSeq: seq,
});

describe('stepNotifications', () => {
  it('flags nothing on first load', () => {
    expect(stepNotifications(null, 'r1', [n('a', 1)]).newIds).toEqual([]);
  });
  it('flags only ids not in the baseline, oldest first', () => {
    const s1 = stepNotifications(null, 'r1', [n('a', 1)]);
    const s2 = stepNotifications(s1.baseline, 'r1', [n('c', 3), n('a', 1), n('b', 2)]);
    expect(s2.newIds).toEqual(['b', 'c']);
    expect(stepNotifications(s2.baseline, 'r1', [n('c', 3), n('a', 1), n('b', 2)]).newIds).toEqual([]);
  });
  it('resets on runId change', () => {
    const s1 = stepNotifications(null, 'r1', [n('a', 1)]);
    const s2 = stepNotifications(s1.baseline, 'r2', [n('a', 1), n('z', 9)]);
    expect(s2.newIds).toEqual([]);
    expect(s2.baseline.runId).toBe('r2');
  });
});

describe('NotificationList with Demo-city data', () => {
  const run = createInitialRun(loadDefaultScenario());
  const { businesses } = run.scenario;
  const snap = snapshotAt(run, run.scenario.settings.simEndMin);
  for (const b of businesses) {
    it(`renders ${b.name} cleanly, newest first, with links`, () => {
      const d = businessDashboard(run, snap, b.id)!;
      const ships = [...d.outgoing, ...d.incoming].map((v) => v.shipment);
      const html = renderToStaticMarkup(
        <MemoryRouter><NotificationList notifications={d.notifications} shipments={ships} businesses={businesses} runId="r" /></MemoryRouter>);
      for (const re of [/NaN/, /undefined/, /\bnull\b/, /n-\d+-\d+/]) expect(re.test(html)).toBe(false);
      const rows = notificationRows(d.notifications, ships, businesses, b.id);
      const seqs = rows.map((r) => d.notifications.find((x) => x.id === r.id)!.createdSeq);
      expect(seqs).toEqual([...seqs].sort((x, y) => y - x));
      for (const r of rows) {
        expect(html).toContain(`href="/business/${b.id}?shipment=${r.shipmentId}"`);
        expect(r.timeLabel).toMatch(/^Ready Day \d+, /);
        expect(r.route).toContain('→');
      }
      if (rows.length === 0) expect(html).toContain('No notifications yet');
    });
  }
  it('works without a router and without optional props', () => {
    const html = renderToStaticMarkup(<NotificationList notifications={[n('a', 1)]} />);
    expect(html).toContain('m a');
  });
});
