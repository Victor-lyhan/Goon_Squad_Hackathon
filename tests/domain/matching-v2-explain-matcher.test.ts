import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import { createRng } from '../../server/domain/generator';
import { buildTrips } from '../../server/domain/v2/trips';
import { assignShipments, generateCandidates, type MatchContext } from '../../server/domain/v2/matching';
import { explainShipment, type ExplainRow, type ExplainRule } from '../../server/domain/v2/storyExplain';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import type { DeliveryPlan, Shipment } from '../../shared/v2/types';
import { business, employee, shipment } from './matching-v2-helpers';
import { relayFixtureTravel } from './matching-v2-grid-helper';
import { nycShapedWorkload } from './matching-v2-workload';

const planKey = (plan: DeliveryPlan) =>
  [plan.kind, plan.relayBusinessId ?? '', ...plan.legs.map(l => l.tripId)].join('|');
const rowKey = (row: ExplainRow) =>
  [row.kind === 'relay' ? 'relay' : 'direct', row.relayBusinessId ?? '', ...row.carriers.map(c => c.tripId)].join('|');

/** A feasible row and a matcher plan describe the same option with the same numbers. */
function expectRowIsPlan(row: ExplainRow, plan: DeliveryPlan) {
  expect(row.feasible).toBe(true);
  expect(rowKey(row)).toBe(planKey(plan));
  expect(row.kind).toBe(plan.kind === 'relay' ? 'relay'
    : plan.legs[0].tripId.endsWith('eve') ? 'evening_direct' : 'morning_direct');
  expect(row.carrierIds).toEqual(plan.legs.map(l => l.employeeId));
  expect(row.placeIds).toEqual(plan.legs.flatMap(l => l.placeIds));
  expect(row.carriers.map(c => c.placeIds)).toEqual(plan.legs.map(l => l.placeIds));
  expect(row.carriers.map(c => c.extraMin)).toEqual(plan.legs.map(l => l.extraMin));
  expect(row.pickupMin).toBe(plan.legs[0].stops[0].serviceStartMin);
  expect(row.deliveryMin).toBe(plan.deliveryMin);
  expect(row.missMin).toBe(0);
}

/** Everything the acceptance criteria say about one request, against the matcher itself. */
function expectExplains(request: Shipment, ctx: MatchContext) {
  const rows = explainShipment(request, ctx);
  const feasible = rows.filter(r => r.feasible);
  // Same rule code: the feasible rows are the matcher's candidates, no more and no fewer.
  const candidates = new Map(generateCandidates(request, ctx).map(plan => [planKey(plan), plan]));
  expect(feasible.map(rowKey).sort()).toEqual([...candidates.keys()].sort());
  for (const row of feasible) expectRowIsPlan(row, candidates.get(rowKey(row))!);
  // Same sort: the first feasible row is the plan of an uncontested allocation.
  const result = assignShipments([request], ctx);
  if (feasible.length === 0) expect(result.plans).toEqual([]);
  else expectRowIsPlan(feasible[0], result.plans[0]);

  const employees = new Map(ctx.employees.map(e => [e.id, e]));
  for (const row of rows) {
    expect(row.carrierIds).toEqual(row.carriers.map(c => c.employeeId));
    expect(row.placeIds).toEqual(row.carriers.flatMap(c => c.placeIds));
    for (const c of row.carriers) expect(c.maxExtraMin).toBe(employees.get(c.employeeId)!.maxExtraMin);
    if (row.feasible) continue;
    expect(row.reason).not.toMatch(/hub|road/i);
    const failed = row.failedCarrier === undefined ? undefined : row.carriers[row.failedCarrier];
    // The rule agrees with the row's own numbers.
    if (row.rule === 'unavailable') {
      expect(row.missMin).toBeNull();
      expect(row.deliveryMin).toBeNull();
    } else {
      expect(row.missMin).toBeGreaterThan(0);
      expect(row.missMin).toBe(row.lateMin! + row.carriers.reduce((n, c) => n + Math.max(0, c.extraMin! - c.maxExtraMin), 0));
      if (row.rule === 'deadline') {
        expect(failed!.extraMin).toBeLessThanOrEqual(failed!.maxExtraMin);
        expect(row.lateMin).toBeGreaterThan(0);
      } else {
        expect(failed!.extraMin).toBeGreaterThan(failed!.maxExtraMin);
        const withoutWait = failed!.extraMin! - failed!.waitMin!;
        if (row.rule === 'detour_limit') expect(withoutWait).toBeGreaterThan(failed!.maxExtraMin);
        else expect(withoutWait).toBeLessThanOrEqual(failed!.maxExtraMin);
      }
    }
  }
  // One evening-direct row per sender employee, one morning-direct row per recipient employee.
  for (const [kind, businessId] of [['evening_direct', request.originBusinessId], ['morning_direct', request.destinationBusinessId]] as const) {
    expect(rows.filter(r => r.kind === kind).map(r => r.carrierIds[0]).sort())
      .toEqual(ctx.employees.filter(e => e.businessId === businessId).map(e => e.id).sort());
  }
  // Every other business is explained as a relay point: all its feasible pairs, or exactly one miss.
  for (const b of ctx.businesses) {
    const relays = rows.filter(r => r.kind === 'relay' && r.relayBusinessId === b.id);
    if (b.id === request.originBusinessId || b.id === request.destinationBusinessId) expect(relays).toEqual([]);
    else expect(relays.some(r => !r.feasible) ? relays.length : Math.min(relays.length, 1)).toBe(1);
  }
  return { rows, feasible, result };
}

describe('explainShipment on the spec §9 fixture', () => {
  // As in matching-v2-fixture.test.ts: Infinity is the fixture's "no route", not missing data.
  const travel = relayFixtureTravel();
  const employees = [
    employee('emp-1', 'biz-a', { homeId: 'home-x', availableMorning: false }),
    employee('emp-2', 'biz-b', { homeId: 'home-y', availableEvening: false }),
  ];
  const ctx: MatchContext = { travel, employees, trips: employees.flatMap(e => buildTrips(e, travel)),
    businesses: ['biz-a', 'biz-b', 'biz-h'].map(business), settings: { ...DEFAULT_SETTINGS } };

  it('the first feasible row is the §9 relay plan, with its carriers, detours and times', () => {
    const { feasible } = expectExplains(shipment(), ctx);
    expect(feasible).toHaveLength(1);
    expect(feasible[0]).toMatchObject({ kind: 'relay', relayBusinessId: 'biz-h', carrierIds: ['emp-1', 'emp-2'],
      placeIds: ['biz-a', 'biz-h', 'home-x', 'home-y', 'biz-h', 'biz-b'], deliveryMin: 1961 });
    expect(feasible[0].carriers.map(c => c.extraMin)).toEqual(fixture.expected.legs.map(l => l.extraMin));
  });

  it.each([0, 1])('carrier %i with five extra minutes: the relay row says whose limit and by how much', index => {
    const tight = { ...ctx, employees: employees.map((e, i) => ({ ...e, maxExtraMin: i === index ? 5 : 8 })) };
    const { rows, feasible } = expectExplains(shipment(), tight);
    expect(feasible).toEqual([]);
    const relay = rows.find(r => r.kind === 'relay')!;
    expect(relay).toMatchObject({ feasible: false, rule: 'detour_limit', failedCarrier: index,
      missMin: fixture.expected.legs[index].extraMin - 5 });
  });
});

describe('explainShipment against the matcher on 200 seeded workload cases', () => {
  const cities = [nycShapedWorkload({ employees: 60, packages: 24 }), nycShapedWorkload({ employees: 120, packages: 60 })];
  const seen = { direct: 0, relay: 0, none: 0, rules: new Map<ExplainRule, number>() };

  /** One request and one changed city per seed: limits, missing commutes, ready time and deadline all vary. */
  function seededCase(seed: number) {
    const rng = createRng(seed);
    const city = cities[seed % 2];
    // Every third case is the workload's featured pair (shipment 1), where only a relay fits the limits.
    const featured = seed % 3 === 0;
    const base = featured ? city.shipments[0] : city.shipments[rng.int(0, city.shipments.length - 1)];
    const moved = !featured && rng.next() < 0.5;
    const from = rng.int(0, 17);
    const request: Shipment = { ...base,
      ...(moved ? { originBusinessId: city.ctx.businesses[from].id,
        destinationBusinessId: city.ctx.businesses[(from + rng.int(1, 17)) % 18].id } : {}),
      readyMin: rng.pick([900, 960, 1015, 1022, 1030, 1045]),
      deadlineMin: rng.pick(featured ? [1965, 1980, 2040, 2100] : [1040, 1060, 1100, 1950, 1965, 1980, 2040]) };
    const ctx: MatchContext = { ...city.ctx,
      employees: city.ctx.employees.map(e => ({ ...e, maxExtraMin: rng.int(3, 16) })),
      trips: city.ctx.trips.filter(() => rng.next() > 0.15) };
    return { request, ctx };
  }

  it.each(Array.from({ length: 200 }, (_, seed) => seed))('seed %i', seed => {
    const { request, ctx } = seededCase(seed);
    const { rows, feasible } = expectExplains(request, ctx);
    seen[feasible.length === 0 ? 'none' : feasible[0].kind === 'relay' ? 'relay' : 'direct']++;
    for (const row of rows) if (!row.feasible) seen.rules.set(row.rule, (seen.rules.get(row.rule) ?? 0) + 1);
  });

  it('the 200 cases cover direct, relay and unmatched outcomes and every reachable rule', () => {
    expect(seen.direct + seen.relay + seen.none).toBe(200);
    expect(seen.direct).toBeGreaterThanOrEqual(20);
    expect(seen.relay).toBeGreaterThanOrEqual(20);
    expect(seen.none).toBeGreaterThanOrEqual(20);
    for (const rule of ['detour_limit', 'not_ready', 'deadline', 'unavailable'] as const) {
      expect(seen.rules.get(rule) ?? 0, rule).toBeGreaterThan(0);
    }
  });
});
