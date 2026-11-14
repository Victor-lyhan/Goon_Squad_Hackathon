import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainShipment, type ExplainRow, type ExplainRule } from '../../server/domain/v2/storyExplain';
import { assignShipments, type MatchContext } from '../../server/domain/v2/matching';
import { TravelDataMissingError, type Shipment } from '../../shared/v2/types';
import { context, employee, relayContext, shipment, TableTravel } from './matching-v2-helpers';
import { directCase, rebuildTrips } from './matching-v2-cases';

const ruledOut = (row: ExplainRow) => {
  if (row.feasible) throw new Error('expected a ruled-out row');
  return row;
};

describe('explainShipment: one direct option', () => {
  it.each(['evening', 'morning'] as const)('%s direct, feasible: places, carrier, minutes and times', direction => {
    const { ctx, request } = directCase(direction);
    const plan = assignShipments([request], ctx).plans[0];
    expect(explainShipment(request, ctx)).toEqual([{
      kind: `${direction}_direct`, feasible: true,
      placeIds: direction === 'evening' ? ['biz-a', 'biz-b', 'home-emp-1'] : ['home-emp-1', 'biz-a', 'biz-b'],
      carrierIds: ['emp-1'],
      carriers: [{ employeeId: 'emp-1', tripId: plan.legs[0].tripId, direction, placeIds: plan.legs[0].placeIds,
        extraMin: 4, maxExtraMin: 8, waitMin: 0 }],
      pickupMin: plan.legs[0].stops[0].serviceStartMin, deliveryMin: plan.deliveryMin, lateMin: 0, missMin: 0,
    }]);
  });

  type Case = {
    name: string; rule: ExplainRule; reason: string; change: (ctx: MatchContext, request: Shipment) => void;
    row?: Partial<ExplainRow>; carrier?: Partial<ExplainRow['carriers'][number]>;
  };
  const cases: Case[] = [
    { name: 'deadline one minute too early', rule: 'deadline', reason: 'The evening commute cannot arrive before the deadline',
      change: (_, s) => { s.deadlineMin = 1028; },
      row: { deliveryMin: 1029, lateMin: 1, missMin: 1 }, carrier: { extraMin: 4 } },
    { name: 'waiting for the package goes over the limit', rule: 'not_ready',
      reason: "The evening commute is not available after the package is ready: waiting for it would exceed the employee's added-time limit",
      change: (_, s) => { s.readyMin = 1025; },
      row: { pickupMin: 1025, deliveryMin: 1034, lateMin: 0, missMin: 1 }, carrier: { extraMin: 9, waitMin: 5 } },
    { name: 'the route alone goes over the limit', rule: 'detour_limit',
      reason: "The evening route would exceed the employee's added-time limit",
      change: c => { c.employees[0].maxExtraMin = 3; },
      row: { deliveryMin: 1029, lateMin: 0, missMin: 1 }, carrier: { extraMin: 4, maxExtraMin: 3, waitMin: 0 } },
    { name: 'over the limit and late: the limit comes first, the miss counts both', rule: 'detour_limit',
      reason: "The evening route would exceed the employee's added-time limit",
      change: (c, s) => { c.employees[0].maxExtraMin = 3; s.deadlineMin = 1028; },
      row: { lateMin: 1, missMin: 2 } },
    { name: 'over the limit even without the wait', rule: 'detour_limit',
      reason: "The evening route would exceed the employee's added-time limit",
      change: (c, s) => { c.employees[0].maxExtraMin = 3; s.readyMin = 1025; },
      row: { missMin: 6 }, carrier: { extraMin: 9, waitMin: 5 } },
    { name: 'no evening commute', rule: 'unavailable', reason: 'No sender evening commute is available for this employee',
      change: c => { c.employees[0].availableEvening = false; rebuildTrips(c); },
      row: { pickupMin: null, deliveryMin: null, lateMin: null, missMin: null,
        placeIds: ['biz-a', 'biz-b', 'home-emp-1'], carrierIds: ['emp-1'] },
      carrier: { tripId: null, extraMin: null, waitMin: null, maxExtraMin: 8 } },
    { name: 'no finite route (an explicit non-finite value, not a missing pair)', rule: 'unavailable',
      reason: 'No available commute route can visit the required pickup and drop-off stops',
      change: c => { (c.travel as TableTravel).pairs['biz-a|biz-b'].durationMin = Infinity; },
      row: { pickupMin: null, deliveryMin: null, missMin: null, placeIds: ['biz-a', 'biz-b', 'home-emp-1'] },
      carrier: { extraMin: null } },
  ];
  it.each(cases)('$name: $rule', ({ rule, reason, change, row, carrier }) => {
    const { ctx, request } = directCase();
    change(ctx, request);
    const rows = explainShipment(request, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'evening_direct', feasible: false, rule, reason, ...row });
    expect(rows[0].carriers[0]).toMatchObject({ employeeId: 'emp-1', direction: 'evening', ...carrier });
    expect(reason).not.toMatch(/hub|road/i);
    // The matcher agrees that nothing is feasible.
    expect(assignShipments([request], ctx).plans).toEqual([]);
  });

  it.each(['evening', 'morning'] as const)('%s boundaries: the last feasible minute, then the rule', direction => {
    const { ctx, request } = directCase(direction);
    const pickup = ctx.trips[0].departureMin;
    expect(explainShipment({ ...request, readyMin: pickup + 4, deadlineMin: pickup + 13 }, ctx)[0].feasible).toBe(true);
    expect(explainShipment({ ...request, readyMin: pickup + 5 }, ctx)[0]).toMatchObject({ rule: 'not_ready', missMin: 1 });
    expect(explainShipment({ ...request, deadlineMin: pickup + 8 }, ctx)[0]).toMatchObject({ rule: 'deadline', missMin: 1 });
  });
});

describe('explainShipment: relay options', () => {
  it('lists both direct misses and the relay, in the matcher order (cheaper direct first)', () => {
    const rows = explainShipment(shipment(), relayContext());
    expect(rows.map(r => [r.kind, r.feasible, r.missMin])).toEqual([
      ['morning_direct', false, 6], ['evening_direct', false, 26], ['relay', true, 0]]);
    expect(rows[2]).toMatchObject({
      relayBusinessId: 'biz-r', carrierIds: ['emp-1', 'emp-2'],
      placeIds: ['biz-a', 'biz-r', 'home-emp-1', 'home-emp-2', 'biz-r', 'biz-b'],
      pickupMin: 1020, deliveryMin: 1964, lateMin: 0,
      carriers: [
        { employeeId: 'emp-1', direction: 'evening', placeIds: ['biz-a', 'biz-r', 'home-emp-1'], extraMin: 4, maxExtraMin: 8 },
        { employeeId: 'emp-2', direction: 'morning', placeIds: ['home-emp-2', 'biz-r', 'biz-b'], extraMin: 4, maxExtraMin: 8 },
      ],
    });
  });

  it('names the carrier that breaks the limit and still shows the other one', () => {
    for (const [index, direction] of [[0, 'evening'], [1, 'morning']] as const) {
      const ctx = relayContext();
      ctx.employees[index].maxExtraMin = 3;
      const relay = ruledOut(explainShipment(shipment(), ctx).find(r => r.kind === 'relay')!);
      expect(relay).toMatchObject({ rule: 'detour_limit', failedCarrier: index, missMin: 1, deliveryMin: 1964,
        reason: `The ${direction} route would exceed the employee's added-time limit` });
      expect(relay.carriers.map(c => [c.extraMin, c.maxExtraMin])).toEqual(
        index === 0 ? [[4, 3], [4, 8]] : [[4, 8], [4, 3]]);
    }
  });

  it('relay_order: the morning carrier would wait for the relay drop-off past the limit', () => {
    const ctx = relayContext();
    ctx.employees[1].morningDepartureMin = 1020; // reaches the relay point at 1025; the drop-off ends at 1034
    rebuildTrips(ctx);
    const relay = ruledOut(explainShipment(shipment(), ctx).find(r => r.kind === 'relay')!);
    expect(relay).toMatchObject({ rule: 'relay_order', failedCarrier: 1, missMin: 5,
      reason: "The morning commute reaches the relay point before the package is dropped off there: waiting for it would exceed the employee's added-time limit" });
    expect(relay.carriers[1]).toMatchObject({ extraMin: 13, waitMin: 9 });
    expect(relay.reason).not.toMatch(/hub/i);
    // Four minutes of waiting are still inside the limit.
    ctx.employees[1].morningDepartureMin = 1025;
    rebuildTrips(ctx);
    expect(explainShipment(shipment(), ctx).find(r => r.kind === 'relay')).toMatchObject({ feasible: true });
  });

  it('a relay drop-off after the deadline is a deadline miss on the evening carrier', () => {
    const relay = ruledOut(explainShipment(shipment({ deadlineMin: 1033 }), relayContext()).find(r => r.kind === 'relay')!);
    expect(relay).toMatchObject({ rule: 'deadline', failedCarrier: 0, lateMin: 1964 - 1033, missMin: 1964 - 1033 });
  });

  it('unavailable: no commute on one side or on both, one row per relay business', () => {
    const sentences = [
      ['emp-1', 'No sender evening commute is available', ['emp-2']],
      ['emp-2', 'No recipient morning commute is available', ['emp-1']],
    ] as const;
    for (const [removed, reason, left] of sentences) {
      const ctx = relayContext();
      ctx.trips = ctx.trips.filter(t => t.employeeId !== removed);
      const relays = explainShipment(shipment(), ctx).filter(r => r.kind === 'relay');
      expect(relays).toHaveLength(1);
      expect(relays[0]).toMatchObject({ feasible: false, rule: 'unavailable', reason, carrierIds: left,
        pickupMin: null, deliveryMin: null, missMin: null });
      expect(relays[0].carriers[0].extraMin).toBe(4); // the side that exists is still measured
    }
    const none = { ...relayContext(), trips: [] };
    expect(explainShipment(shipment(), none).filter(r => r.kind === 'relay')[0]).toMatchObject({
      rule: 'unavailable', carrierIds: [], placeIds: [],
      reason: 'No sender evening commute or recipient morning commute is available' });
    // Each employee who could carry it directly still gets a row.
    expect(explainShipment(shipment(), none).map(r => [r.kind, r.carrierIds])).toEqual([
      ['evening_direct', ['emp-1']], ['morning_direct', ['emp-2']], ['relay', []]]);
  });

  it('several relay businesses: every feasible pair, and one nearest miss where none is feasible', () => {
    const ctx = context([
      employee('emp-1', 'biz-a', { availableMorning: false }),
      employee('emp-2', 'biz-a', { availableMorning: false, maxExtraMin: 4 }),
      employee('emp-3', 'biz-b', { availableEvening: false }),
      employee('emp-4', 'biz-b', { availableEvening: false, maxExtraMin: 20 }),
    ], { 'biz-a': 0, 'biz-r': 10, 'biz-far': 60, 'biz-b': 30,
      'home-emp-1': 15, 'home-emp-2': 15, 'home-emp-3': 5, 'home-emp-4': 5 });
    const relays = explainShipment(shipment(), ctx).filter(r => r.kind === 'relay');
    const near = relays.filter(r => r.relayBusinessId === 'biz-r');
    expect(near.map(r => [r.carrierIds.join('+'), r.feasible])).toEqual([
      ['emp-1+emp-3', true], ['emp-1+emp-4', true], ['emp-2+emp-3', true], ['emp-2+emp-4', true]]);
    const far = relays.filter(r => r.relayBusinessId === 'biz-far');
    expect(far).toHaveLength(1);
    // Via biz-far the evening detour is 94 min, the morning one 64, and the delivery ends at 2024:
    // the pair with the largest limits misses least.
    expect(far[0]).toMatchObject({ feasible: false, rule: 'detour_limit', failedCarrier: 0,
      carrierIds: ['emp-1', 'emp-4'], deliveryMin: 2024, lateMin: 44, missMin: (94 - 8) + (64 - 20) + 44 });
  });

  it('no relay rows when relays are switched off, like the matcher', () => {
    const ctx = relayContext();
    ctx.settings.allowRelay = false;
    expect(explainShipment(shipment(), ctx).map(r => r.kind)).toEqual(['morning_direct', 'evening_direct']);
  });
});

describe('explainShipment: inputs', () => {
  it('returns no rows for a request the matcher cannot have candidates for', () => {
    const { ctx, request } = directCase();
    expect(explainShipment({ ...request, destinationBusinessId: request.originBusinessId }, ctx)).toEqual([]);
    expect(explainShipment({ ...request, destinationBusinessId: 'biz-unknown' }, ctx)).toEqual([]);
  });

  it('a missing travel pair throws TravelDataMissingError; nothing is guessed', () => {
    const ctx = relayContext();
    const table = ctx.travel as TableTravel;
    for (const key of ['biz-a|biz-r', 'biz-r|biz-b', 'home-emp-2|biz-r', 'biz-a|biz-b', 'home-emp-2|biz-a']) {
      const pair = table.pairs[key];
      delete table.pairs[key];
      expect(() => explainShipment(shipment(), ctx), key).toThrow(TravelDataMissingError);
      table.pairs[key] = pair;
    }
    expect(explainShipment(shipment(), ctx)).toHaveLength(3);
  });

  it('is deterministic, does not change its inputs and does not depend on input order', () => {
    const ctx = relayContext();
    const request = shipment();
    const before = JSON.stringify([ctx.employees, ctx.trips, ctx.businesses, ctx.settings, request]);
    const rows = explainShipment(request, ctx);
    expect(explainShipment(request, ctx)).toEqual(rows);
    expect(JSON.stringify([ctx.employees, ctx.trips, ctx.businesses, ctx.settings, request])).toBe(before);
    expect(explainShipment(request, { ...ctx, employees: [...ctx.employees].reverse(),
      trips: [...ctx.trips].reverse(), businesses: [...ctx.businesses].reverse() })).toEqual(rows);
  });

  it('is pure: no fs, clock or random in the module, and the rules come from the matcher', () => {
    const source = readFileSync(new URL('../../server/domain/v2/storyExplain.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfs\b|Date\.now|new Date|Math\.random|performance\.now|process\./);
    expect(source).toMatch(/import \{[^}]*\bscheduleLeg\b[^}]*\} from '\.\/matching'/s);
    // No travel lookup of its own: every minute comes out of scheduleLeg.
    expect(source).not.toMatch(/durationMin\(|distanceM\(|baselineDurationMin|handlingMin/);
  });
});
