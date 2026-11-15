// #954: the best plan of each kind (server/domain/v2/kindMatch.ts), on a small line city. Positions are minutes
// along one road: the sender biz-a at 0, a relay point biz-r at 10, the recipient biz-b at 30.
//   emp-1 (biz-a) lives at 15: on the evening drive home biz-r is on the way (relay deposit), biz-b is not.
//   emp-2 (biz-b) lives at 5: on the morning drive in biz-r is on the way (relay collection).
//   emp-3 (biz-a) lives at 35: biz-b is on the evening drive home (direct).
import { describe, expect, it } from 'vitest';
import { bestPlansByKind, type KindAnswer } from '../../server/domain/v2/kindMatch';
import { assignShipments, rankCandidates, type MatchContext } from '../../server/domain/v2/matching';
import type { DeliveryPlan, Employee } from '../../shared/v2/types';
import { context, employee, shipment } from './matching-v2-helpers';

const POSITIONS = { 'biz-a': 0, 'biz-r': 10, 'biz-b': 30, 'home-emp-1': 15, 'home-emp-2': 5, 'home-emp-3': 35 };

function city(over: Partial<Record<'emp-1' | 'emp-2' | 'emp-3', Partial<Employee> | null>> = {}): MatchContext {
  const all = [
    over['emp-1'] === null ? null : employee('emp-1', 'biz-a', { availableMorning: false, ...over['emp-1'] }),
    over['emp-2'] === null ? null : employee('emp-2', 'biz-b', { availableEvening: false, ...over['emp-2'] }),
    over['emp-3'] === null ? null : employee('emp-3', 'biz-a', { availableMorning: false, ...over['emp-3'] }),
  ].filter((e): e is Employee => e !== null);
  return context(all, POSITIONS);
}

const planOf = (answer: KindAnswer): DeliveryPlan => {
  if (!('plan' in answer)) throw new Error(`no plan: ${answer.reason}`);
  return answer.plan;
};
const reasonOf = (answer: KindAnswer): string => ('reason' in answer ? answer.reason : `a plan: ${answer.plan.kind}`);

describe('bestPlansByKind (#954)', () => {
  it('both kinds feasible: the best direct plan and the best relay plan, the relay even though it costs more', () => {
    const ctx = city();
    const answers = bestPlansByKind(shipment(), ctx);
    const direct = planOf(answers.direct);
    const relay = planOf(answers.relay);
    expect(direct).toMatchObject({ kind: 'direct', legs: [{ employeeId: 'emp-3' }] });
    expect(relay).toMatchObject({ kind: 'relay', relayBusinessId: 'biz-r', legs: [{ employeeId: 'emp-1' }, { employeeId: 'emp-2' }] });
    expect(direct.customerPriceCents).toBeLessThan(relay.customerPriceCents);
    // Each is the matcher's own pick among the candidates of its kind, and the matcher's overall pick is the better one.
    const overall = assignShipments([shipment()], ctx).plans[0];
    expect(overall).toStrictEqual(rankCandidates([direct, relay], ctx.settings)[0]);
    expect(overall).toStrictEqual(direct);
  });

  it('only direct: the relay has the matcher\'s reason, from its own rules', () => {
    // The relay reaches biz-b only the next morning; the direct trip arrives the same evening.
    expect(reasonOf(bestPlansByKind(shipment({ deadlineMin: 1200 }), city()).relay)).toBe('A relay cannot arrive before the deadline');
    expect(planOf(bestPlansByKind(shipment({ deadlineMin: 1200 }), city()).direct).kind).toBe('direct');

    const off = city();
    off.settings = { ...off.settings, allowRelay: false };
    expect(reasonOf(bestPlansByKind(shipment(), off).relay)).toBe('Relays are turned off for this run');
    expect(reasonOf(bestPlansByKind(shipment(), city({ 'emp-2': null })).relay)).toBe('No one at biz-b has a morning commute');
  });

  it('only relay: the direct plan has its reason', () => {
    // Without emp-3 nobody drives past biz-b: the only direct trip would be emp-1's 30-minute detour.
    const answers = bestPlansByKind(shipment(), city({ 'emp-3': null }));
    expect(planOf(answers.relay).kind).toBe('relay');
    expect(reasonOf(answers.direct)).toBe('A direct trip would add more than 8 minutes to a commute');
  });

  it('an added-time limit: the number when every plan is over the highest limit, plain words otherwise', () => {
    // emp-1's deposit adds 4 minutes (two 2-minute stops on the way).
    const tight = city({ 'emp-3': null, 'emp-1': { maxExtraMin: 3 }, 'emp-2': { maxExtraMin: 3 } });
    expect(reasonOf(bestPlansByKind(shipment(), tight).relay)).toBe('A relay would add more than 3 minutes to a commute');
    const mixed = city({ 'emp-3': null, 'emp-1': { maxExtraMin: 3 } });
    expect(reasonOf(bestPlansByKind(shipment(), mixed).relay)).toBe('A relay would be a longer detour than its carrier allows');
  });

  it('trips already reserved stay reserved, and the reason names the commutes that are taken', () => {
    const ctx = city();
    const first = assignShipments([shipment({ id: 'shp-0' })], ctx, { mode: 'with_relay' }).plans;
    // shp-0 took emp-3's evening trip (the direct one): no direct is left; the relay is free.
    const answers = bestPlansByKind(shipment(), ctx, first);
    expect(reasonOf(answers.direct)).toBe('Every evening commute from biz-a is already carrying a package');
    expect(planOf(answers.relay).kind).toBe('relay');

    // emp-3 can also drop the package at biz-r, so a relay needs either evening; emp-2's is the only morning.
    const relay = planOf(bestPlansByKind(shipment({ id: 'shp-0' }), ctx).relay);
    expect(relay.legs.map((leg) => leg.employeeId)).toStrictEqual(['emp-1', 'emp-2']);
    // Both evenings taken (the direct plan and an earlier relay's first leg): the evenings are named.
    const evenings = [...first, { ...relay, legs: [relay.legs[0]] }];
    expect(reasonOf(bestPlansByKind(shipment(), ctx, evenings).relay)).toBe('Every evening commute from biz-a is already carrying a package');
    // The one morning taken (here by a whole earlier relay): the morning is named, as one evening is still free.
    expect(reasonOf(bestPlansByKind(shipment(), ctx, [relay]).relay)).toBe('Every morning commute to biz-b is already carrying a package');
    // Only emp-1's evening taken: the relay is the next best, through emp-3.
    expect(planOf(bestPlansByKind(shipment(), ctx, [{ ...relay, legs: [relay.legs[0]] }]).relay).legs[0].employeeId).toBe('emp-3');
  });

  it('changes nothing and is deterministic', () => {
    const ctx = city();
    const copy = structuredClone({ trips: ctx.trips, employees: ctx.employees, businesses: ctx.businesses, settings: ctx.settings });
    const a = bestPlansByKind(shipment(), ctx);
    const b = bestPlansByKind(shipment(), ctx);
    expect(a).toStrictEqual(b);
    expect({ trips: ctx.trips, employees: ctx.employees, businesses: ctx.businesses, settings: ctx.settings }).toStrictEqual(copy);
  });
});
