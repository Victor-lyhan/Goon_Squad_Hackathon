import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { assignShipments, compareAssignments } from '../../server/domain/v2/matching';
import { countingTravel, nycShapedWorkload } from './matching-v2-workload';
import { relayContext, shipment, TableTravel } from './matching-v2-helpers';
import { pairKey, TravelDataMissingError } from '../../shared/v2/types';

// Local pre/post memoization: default 12/14 ms, maximum 46/50 ms, compare 5/8 ms.
// The fixed 500 ms budgets leave >3x headroom and keep default far below 2 s.
// Construct once per file; no matrix generation or assertions inside timing.
const defaultCity = nycShapedWorkload({ employees: 60, packages: 24 });
const maximumCity = nycShapedWorkload({ employees: 120, packages: 60 });

for (const [name, city] of [['default 60/24', defaultCity], ['maximum 120/60', maximumCity]] as const) {
  it(`assignShipments: ${name}`, () => {
    city.counter.reset();
    const start = performance.now();
    const result = assignShipments(city.shipments, city.ctx);
    const elapsed = performance.now() - start;
    process.stdout.write(`${name}: ${elapsed.toFixed(1)} ms; lookups ${JSON.stringify(city.counter.counts)}\n`);
    expect(city.counter.counts.durationMin).toBeGreaterThan(0);
    expect(city.counter.counts.durationMin).toBeLessThanOrEqual(Object.keys(city.table.pairs).length);
    expect(city.counter.counts.distanceM).toBe(city.counter.counts.durationMin);
    expect(elapsed).toBeLessThan(500);
    expect(result.plans.some(p => p.kind === 'direct')).toBe(true);
    expect(result.plans.some(p => p.kind === 'relay')).toBe(true);
    expect(result.unmatched.length).toBeGreaterThanOrEqual(5);
    expect(result.unmatched.filter(u => u.reason ===
      'Delivery requires both a later deadline and a larger added-time limit')).toHaveLength(5);
    const again = assignShipments(city.shipments, city.ctx);
    expect(again.plans).toEqual(result.plans);
    expect(again.unmatched).toEqual(result.unmatched);
  }, 10_000);
}

it('compareAssignments: default 60/24', () => {
  defaultCity.counter.reset();
  const start = performance.now();
  const result = compareAssignments(defaultCity.shipments, defaultCity.ctx);
  const elapsed = performance.now() - start;
  process.stdout.write(`compare default 60/24: ${elapsed.toFixed(1)} ms; lookups ${JSON.stringify(defaultCity.counter.counts)}\n`);
  expect(elapsed).toBeLessThan(500);
  expect(result.directOnly.plans.every(p => p.kind === 'direct')).toBe(true);
  expect(result.withRelay.plans.some(p => p.kind === 'relay')).toBe(true);
}, 10_000);

it('models the NYC matrix coverage and business distribution', () => {
  for (const city of [defaultCity, maximumCity]) {
    expect(['Manhattan', 'Brooklyn', 'Queens'].map(borough =>
      city.ctx.businesses.filter(b => b.borough === borough).length)).toEqual([8, 6, 4]);
    expect(Object.keys(city.table.pairs)).toHaveLength(18 * 18 + 2 * 18 * city.ctx.employees.length);
    for (const e of city.ctx.employees) {
      for (const b of city.ctx.businesses) {
        expect(city.table.pairs[pairKey(e.homeId, b.id)]).toBeDefined();
        expect(city.table.pairs[pairKey(b.id, e.homeId)]).toBeDefined();
      }
    }
    expect(() => city.ctx.travel.durationMin(city.ctx.employees[0].homeId,
      city.ctx.employees[1].homeId)).toThrow(TravelDataMissingError);
  }
}, 10_000);

it('memoizes each metric once per pair and reads provider changes on the next call', () => {
  const ctx = relayContext();
  const table = ctx.travel as TableTravel;
  const seen = { durationMin: new Set<string>(), distanceM: new Set<string>() };
  const counter = countingTravel({
    durationMin(from, to) { seen.durationMin.add(pairKey(from, to)); return table.durationMin(from, to); },
    distanceM(from, to) { seen.distanceM.add(pairKey(from, to)); return table.distanceM(from, to); },
    polyline() { return null; },
  });
  ctx.travel = counter.travel;
  const requests = [shipment(), shipment({ id: 'shp-2', createdSeq: 2 })];
  const first = assignShipments(requests, ctx);
  expect(counter.counts).toEqual({ durationMin: seen.durationMin.size, distanceM: seen.distanceM.size });
  const key = pairKey('biz-a', 'biz-r');
  const pair = table.pairs[key];
  delete table.pairs[key];
  expect(() => assignShipments(requests, ctx)).toThrow(TravelDataMissingError);
  table.pairs[key] = { durationMin: pair.durationMin + 1, distanceM: pair.distanceM + 100 };
  const updated = assignShipments(requests, ctx);
  expect(updated.plans[0].legs[0].extraMin).toBe(first.plans[0].legs[0].extraMin + 1);
  expect(updated.plans[0].legs[0].extraDistanceM).toBe(first.plans[0].legs[0].extraDistanceM + 100);
  expect(ctx.travel).toBe(counter.travel);
}, 10_000);
