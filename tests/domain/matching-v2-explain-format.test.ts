import { describe, expect, it } from 'vitest';
import { explainShipment, formatExplain, type ExplainRow } from '../../server/domain/v2/storyExplain';
import { relayContext, shipment } from './matching-v2-helpers';
import { rebuildTrips } from './matching-v2-cases';
import { nycShapedWorkload } from './matching-v2-workload';

const names = { 'biz-a': 'Atlas Print', 'biz-b': 'Midtown Agency', 'biz-r': 'Brooklyn Roasting, DUMBO',
  'emp-1': 'Dana Ruiz', 'emp-2': 'Li Wei' };

describe('formatExplain', () => {
  it('prints feasible rows first, then the misses, nearest first', () => {
    expect(formatExplain(explainShipment(shipment(), relayContext()), names)).toEqual([
      'feasible: relay via Brooklyn Roasting, DUMBO: evening carrier Dana Ruiz +4 min, limit 8; '
        + 'morning carrier Li Wei +4 min, limit 8; pickup Day 1 17:00, delivered Day 2 08:44',
      'ruled out: morning direct: carrier Li Wei +14 min, limit 8; pickup Day 2 08:20, delivered Day 2 08:54'
        + " — The morning route would exceed the employee's added-time limit",
      'ruled out: evening direct: carrier Dana Ruiz +34 min, limit 8; pickup Day 1 17:00, delivered Day 1 17:34'
        + " — The evening route would exceed the employee's added-time limit",
    ]);
  });

  it('a relay miss reads "relay via <name>: evening carrier <name> +N min, limit M"', () => {
    const ctx = relayContext();
    ctx.employees[0].maxExtraMin = 3;
    const lines = formatExplain(explainShipment(shipment(), ctx), names);
    expect(lines[0]).toBe('no feasible option');
    // The relay misses by 1 minute, the direct options by 6 and 31: nearest first.
    expect(lines.slice(1).map(l => l.split(':')[1].trim())).toEqual(
      ['relay via Brooklyn Roasting, DUMBO', 'morning direct', 'evening direct']);
    expect(lines[1]).toContain('relay via Brooklyn Roasting, DUMBO: evening carrier Dana Ruiz +4 min, limit 3; morning carrier Li Wei +4 min, limit 8');
  });

  it('shows the wait, the minutes after the deadline and a commute that does not exist', () => {
    const waiting = relayContext();
    waiting.employees[1].morningDepartureMin = 1020;
    rebuildTrips(waiting);
    expect(formatExplain(explainShipment(shipment(), waiting), names).find(l => l.includes('relay via')))
      .toContain('morning carrier Li Wei +13 min, limit 8 (waits 9 min); pickup Day 1 17:00, delivered Day 1 17:38 — The morning commute reaches the relay point');

    const late = formatExplain(explainShipment(shipment({ deadlineMin: 1960 }), relayContext()), names);
    expect(late[1]).toBe('ruled out: relay via Brooklyn Roasting, DUMBO: evening carrier Dana Ruiz +4 min, limit 8; '
      + 'morning carrier Li Wei +4 min, limit 8; pickup Day 1 17:00, delivered Day 2 08:44 (4 min after the deadline)'
      + ' — The morning commute cannot arrive before the deadline');

    const noTrips = { ...relayContext(), trips: [] };
    expect(formatExplain(explainShipment(shipment(), noTrips), names)).toEqual([
      'no feasible option',
      'ruled out: evening direct: carrier Dana Ruiz — No sender evening commute is available for this employee',
      'ruled out: morning direct: carrier Li Wei — No recipient morning commute is available for this employee',
      'ruled out: relay via Brooklyn Roasting, DUMBO — No sender evening commute or recipient morning commute is available',
    ]);
  });

  it('never prints a raw place ID when a name is given, and falls back to the ID when it is not', () => {
    const city = nycShapedWorkload({ employees: 60, packages: 24 });
    const placeNames = Object.fromEntries(city.ctx.businesses.map((b, i) => [b.id, `Business ${String.fromCharCode(65 + i)}`]));
    for (const request of city.shipments) {
      const rows = explainShipment(request, city.ctx);
      for (const line of formatExplain(rows, placeNames, 100)) expect(line).not.toMatch(/biz-|home-/);
    }
    const bare = formatExplain(explainShipment(shipment(), relayContext()), {});
    expect(bare[0]).toContain('relay via biz-r: evening carrier emp-1 +4 min');
    expect(bare.join('\n')).not.toMatch(/home-|hub/i);
  });

  it('limit caps each group and says how many rows are left out; the default is 5', () => {
    const city = nycShapedWorkload({ employees: 60, packages: 24 });
    const rows = explainShipment(city.shipments[0], city.ctx);
    const feasible = rows.filter(r => r.feasible).length;
    const misses = rows.length - feasible;
    expect(feasible).toBeGreaterThan(5);
    expect(misses).toBeGreaterThan(5);
    const lines = formatExplain(rows, {});
    expect(lines).toHaveLength(12);
    expect(lines.slice(0, 5).every(l => l.startsWith('feasible: '))).toBe(true);
    expect(lines[5]).toBe(`… ${feasible - 5} more feasible`);
    expect(lines.slice(6, 11).every(l => l.startsWith('ruled out: '))).toBe(true);
    expect(lines[11]).toBe(`… ${misses - 5} more ruled out`);
    expect(formatExplain(rows, {}, 2)).toHaveLength(6);
    expect(formatExplain(rows, {}, rows.length)).toHaveLength(rows.length);
    // The first feasible line is the first feasible row: the plan of an uncontested allocation.
    expect(lines[0]).toBe(formatExplain([rows.find(r => r.feasible)!], {})[0]);
  });

  it('orders misses by how far they miss, with options no minutes can fix last', () => {
    const city = nycShapedWorkload({ employees: 60, packages: 24 });
    const ctx = { ...city.ctx, trips: city.ctx.trips.filter((_, i) => i % 7 !== 0) };
    for (const request of city.shipments) {
      const rows = explainShipment(request, ctx);
      const ruledOut = rows.filter(r => !r.feasible);
      const lines = formatExplain(rows, {}, rows.length).filter(l => l.startsWith('ruled out: '));
      const sorted = [...ruledOut].sort((a, b) => (a.missMin ?? Infinity) - (b.missMin ?? Infinity));
      expect(lines).toEqual(sorted.map(r => formatExplain([r], {}, 1)[1]));
      expect(sorted.map(r => r.missMin ?? Infinity)).toEqual([...sorted.map(r => r.missMin ?? Infinity)].sort((a, b) => a - b));
    }
  });

  it('says so when there is nothing to explain', () => {
    expect(formatExplain([], names)).toEqual(['No direct or relay option exists for this delivery request']);
    const rows: ExplainRow[] = explainShipment(shipment({ destinationBusinessId: 'biz-a' }), relayContext());
    expect(formatExplain(rows, names)).toHaveLength(1);
  });
});
