// Demo step 6: every portal agrees with the simulator at the same clock time.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore, type Store } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { BusinessDashboard, EmployeeDashboard, SimulatorResponse } from '../../shared/api';

let server: Server;
let base: string;
let store: Store;

beforeAll(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-consistency-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const getJson = async <T>(url: string) => (await fetch(`${base}${url}`)).json() as Promise<T>;
const control = async (body: object) => {
  const r = await fetch(`${base}/api/simulator/control`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(r.status).toBe(200);
  return (await r.json()) as SimulatorResponse;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

async function readAll() {
  const sim = await getJson<SimulatorResponse>('/api/simulator');
  const { employees, businesses } = store.get().scenario;
  const emps = await Promise.all(employees.map((e) => getJson<EmployeeDashboard>(`/api/employees/${e.id}/dashboard`)));
  const biz = await Promise.all(businesses.map((b) => getJson<BusinessDashboard>(`/api/businesses/${b.id}/dashboard`)));
  return { sim, emps, biz };
}

describe('metrics consistency across portals (demo step 6)', () => {
  it('portals, simulator and metrics agree at four clock times', async () => {
    const { settings } = store.get().scenario;
    const events = (await getJson<SimulatorResponse>('/api/simulator')).snapshot.occurredEvents;
    expect(events).toEqual([]);
    await control({ action: 'finish' });
    const all = (await getJson<SimulatorResponse>('/api/simulator')).snapshot.occurredEvents;
    const lastDay1 = Math.max(...all.filter((e) => e.timeMin < 1440).map((e) => e.timeMin));

    const times: Array<[string, () => Promise<SimulatorResponse>]> = [
      ['start', () => control({ action: 'reset_playback' })],
      ['after last Day 1 event', () => control({ action: 'seek', timeMin: lastDay1 })],
      ['after jump_to_morning', () => control({ action: 'jump_to_morning' })],
      ['simEndMin', () => control({ action: 'seek', timeMin: settings.simEndMin })],
    ];

    let sawPartial = false;
    for (const [label, go] of times) {
      const moved = await go();
      const { sim, emps, biz } = await readAll();
      const ctx = `${label} @${moved.clock.timeMin}`;
      expect(sim.clock.timeMin, ctx).toBe(moved.clock.timeMin);
      expect(sim.snapshot.timeMin, ctx).toBe(sim.clock.timeMin);
      const m = sim.snapshot.metrics;

      // earnings
      expect(m.earnedRewardsCents, ctx).toBe(sum(emps.map((e) => e.earnedCents)));
      expect(sum(Object.values(sim.snapshot.earningsCents)), ctx).toBe(m.earnedRewardsCents);

      // delivered count = distinct delivered shipments across business outgoing lists
      const deliveredIds = new Set(
        biz.flatMap((b) => b.outgoing).filter((v) => v.status === 'delivered').map((v) => v.shipment.id),
      );
      expect(m.delivered, ctx).toBe(deliveredIds.size);
      expect(sum(biz.map((b) => b.totals.delivered)), ctx).toBe(m.delivered);

      // statuses agree between sender, recipient and simulator queue
      const outgoing = new Map(biz.flatMap((b) => b.outgoing).map((v) => [v.shipment.id, v.status]));
      const incoming = new Map(biz.flatMap((b) => b.incoming).map((v) => [v.shipment.id, v.status]));
      expect(sim.shipments.length, ctx).toBeGreaterThan(0);
      for (const s of sim.shipments) {
        const queue = sim.snapshot.shipmentStatus[s.id] ?? (sim.plans.some((p) => p.shipmentId === s.id) ? 'scheduled' : 'unmatched');
        expect(outgoing.get(s.id), `${ctx} ${s.id} outgoing`).toBe(queue);
        expect(incoming.get(s.id), `${ctx} ${s.id} incoming`).toBe(queue);
      }

      // committed spend = matched x price
      expect(sum(biz.map((b) => b.totals.spendCents)), ctx).toBe(m.matched * settings.priceCents);
      expect(sum(biz.map((b) => b.totals.matched)), ctx).toBe(m.matched);
      expect(sum(sim.plans.map((p) => p.customerPriceCents)), ctx).toBe(m.matched * settings.priceCents);

      if (label === 'start') {
        expect(m.earnedRewardsCents).toBe(0);
        expect(m.delivered).toBe(0);
        expect(m.earnedPlatformContributionCents).toBe(0);
        expect(sum(emps.map((e) => e.earnedCents))).toBe(0);
      }
      if (label === 'simEndMin') {
        expect(m.earnedRewardsCents).toBe(sum(sim.jobs.map((j) => j.rewardCents)));
        expect(sum(emps.map((e) => e.projectedCents))).toBe(m.earnedRewardsCents);
        expect(m.earnedPlatformContributionCents).toBe(m.projectedPlatformContributionCents);
        expect(m.delivered).toBe(m.matched);
      }
      if (m.earnedRewardsCents > 0 && m.delivered < m.matched) sawPartial = true;
    }
    // at least one mid-run time exercised a partially finished state
    expect(sawPartial).toBe(true);
  });
});
