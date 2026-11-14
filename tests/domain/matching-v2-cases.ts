import { context, employee, shipment } from './matching-v2-helpers';
import { buildTrips } from '../../server/domain/v2/trips';
import type { MatchContext } from '../../server/domain/v2/matching';

export function directCase(direction: 'evening' | 'morning' = 'evening') {
  const evening = direction === 'evening';
  const ctx = context([employee('emp-1', evening ? 'biz-a' : 'biz-b', {
    availableEvening: evening, availableMorning: !evening,
  })], { 'biz-a': 0, 'biz-b': 5, 'home-emp-1': evening ? 10 : 0 });
  return { ctx, request: shipment() };
}

export function rebuildTrips(ctx: MatchContext) {
  ctx.trips = ctx.employees.flatMap(e => buildTrips(e, ctx.travel));
}

/** Independent direct job plus a job that requires both relay carriers. */
export function comparisonCase() {
  const ctx = context([
    employee('emp-1', 'biz-a', { availableMorning: false }),
    employee('emp-2', 'biz-b', { availableEvening: false }),
    employee('emp-3', 'biz-c', { availableMorning: false }),
  ], {
    'biz-a': 0, 'biz-r': 10, 'biz-b': 30, 'home-emp-1': 15, 'home-emp-2': 5,
    'biz-c': 100, 'biz-d': 110, 'home-emp-3': 120,
  });
  const shipments = [shipment(), shipment({ id: 'shp-2', clientRequestId: 'test-2', createdSeq: 2,
    originBusinessId: 'biz-c', destinationBusinessId: 'biz-d' })];
  return { ctx, shipments };
}
