import { describe, expect, it } from 'vitest';
import { assignShipments, type MatchContext } from '../../server/domain/v2/matching';
import type { Shipment } from '../../shared/v2/types';
import { TableTravel } from './matching-v2-helpers';
import { directCase, rebuildTrips } from './matching-v2-cases';

type Case = { name: string; reason: string; change: (ctx: MatchContext, request: Shipment) => void };
const cases: Case[] = [
  { name: 'same sender and recipient', reason: 'Sender and recipient must be different businesses',
    change: (_, s) => { s.destinationBusinessId = s.originBusinessId; } },
  { name: 'missing business', reason: 'Sender or recipient business is missing',
    change: c => { c.businesses.pop(); } },
  { name: 'no employees', reason: 'No employees are available to carry packages', change: c => { c.employees = []; } },
  { name: 'no trips', reason: 'No commute is available after the package is ready', change: c => { c.trips = []; } },
  { name: 'no sender evening or recipient morning commute', reason: 'No sender evening commute or recipient morning commute is available',
    change: c => { c.employees[0].availableEvening = false; c.employees[0].availableMorning = true; rebuildTrips(c); } },
  { name: 'window shorter than handling', reason: 'The delivery window is too short for pickup and delivery handling',
    change: (_, s) => { s.deadlineMin = s.readyMin + 3; } },
  { name: 'deadline before delivery completes', reason: 'No commute can arrive before the deadline',
    change: (_, s) => { s.deadlineMin = 1028; } },
  { name: 'not ready within waiting allowance', reason: 'No commute is available after the package is ready',
    change: (_, s) => { s.readyMin = 1025; } },
  { name: 'added-time limit', reason: "Every route would exceed the employees' added-time limit",
    change: c => { c.employees[0].maxExtraMin = 3; } },
  { name: 'deadline plus limit', reason: 'Delivery requires both a later deadline and a larger added-time limit',
    change: (c, s) => { c.employees[0].maxExtraMin = 3; s.deadlineMin = 1028; } },
  // Defensive fallback: complete finite tables always permit a route after relaxing
  // deadline and extra time. An explicit non-finite value is NOT a missing pair.
  { name: 'no route through required stops (non-finite provider value)',
    reason: 'No available commute route can visit the required pickup and drop-off stops',
    change: c => { (c.travel as TableTravel).pairs['biz-a|biz-b'].durationMin = Infinity; } },
];

describe('MVP II unmatched reasons', () => {
  it.each(cases)('$name', ({ reason, change }) => {
    const { ctx, request } = directCase();
    change(ctx, request);
    expect(assignShipments([request], ctx)).toEqual({ plans: [], computeMs: 0,
      unmatched: [{ shipmentId: request.id, reason }] });
    expect(reason).not.toMatch(/hub|road/i);
  });

  it('all matching commutes taken', () => {
    const { ctx, request } = directCase();
    const second = { ...request, id: 'shp-2', createdSeq: 2 };
    const result = assignShipments([request, second], ctx);
    expect(result.plans.map(p => p.shipmentId)).toEqual([request.id]);
    expect(result.unmatched).toEqual([{ shipmentId: second.id,
      reason: 'Every matching commute is already carrying a package' }]);
    expect(result.unmatched[0].reason).not.toMatch(/hub|road/i);
  });

  it.each(['evening', 'morning'] as const)('%s readiness and deadline boundaries include handling', direction => {
    const { ctx, request } = directCase(direction);
    const pickup = ctx.trips[0].departureMin;
    expect(assignShipments([{ ...request, readyMin: pickup + 4, deadlineMin: pickup + 13 }], ctx).plans).toHaveLength(1);
    expect(assignShipments([{ ...request, readyMin: pickup + 5 }], ctx).unmatched[0].reason)
      .toBe('No commute is available after the package is ready');
    expect(assignShipments([{ ...request, deadlineMin: pickup + 8 }], ctx).unmatched[0].reason)
      .toBe('No commute can arrive before the deadline');
  });
});
