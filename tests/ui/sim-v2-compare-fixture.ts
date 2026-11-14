// Test-only: builds real CompareResponse objects from the v2 matcher's compareAssignments over the
// FakeProvider (DECISIONS pass 7: tests under tests/ui may import server code). No hand-written results.
import { createFakeProvider, type FakePair } from '../../server/geo/fakeProvider';
import { compareAssignments, type MatchContext } from '../../server/domain/v2/matching';
import { buildTrips } from '../../server/domain/v2/trips';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { computeMetrics } from '../../server/domain/metrics';
import type { DeliveryPlan as V1DeliveryPlan } from '../../shared/types';
import type { CompareResponse } from '../../shared/v2/api';
import type { AssignmentResult, Employee, NetworkBusiness, Shipment } from '../../shared/v2/types';

/** Places on a line (minutes from 0); every ordered pair gets |x - y| minutes and 350 m per minute. */
function lineProvider(positions: Record<string, number>) {
  const pairs: FakePair[] = [];
  for (const [from, x] of Object.entries(positions)) {
    for (const [to, y] of Object.entries(positions)) {
      if (from !== to) pairs.push({ from, to, durationMin: Math.abs(x - y), distanceM: Math.abs(x - y) * 350 });
    }
  }
  return createFakeProvider({ pairs });
}

const business = (id: string): NetworkBusiness => ({
  id, name: id, address: 'Test address', neighborhood: 'Test', borough: 'Queens', kind: 'office', lat: 40.7, lng: -73.9,
});
export const employee = (id: string, businessId: string, over: Partial<Employee> = {}): Employee => ({
  id, name: id, businessId, homeId: `home-${id}`, eveningDepartureMin: 1020, morningDepartureMin: 1935,
  availableEvening: true, availableMorning: true, maxExtraMin: 8, ...over,
});
export const shipment = (id: string, from: string, to: string, seq: number): Shipment => ({
  id, clientRequestId: `req-${id}`, label: `Package ${id}`, originBusinessId: from, destinationBusinessId: to,
  readyMin: 960, deadlineMin: 1980, category: 'envelope', description: '', weightGrams: 100,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: seq,
});

/**
 * The server's compare side: metrics with no events yet. `server/domain/v2/metrics.ts` is not merged;
 * DECISIONS pass 45 says it keeps MVP 1's rules, and computeMetrics reads only plan fields both shapes share.
 */
function side(shipments: Shipment[], result: AssignmentResult) {
  const metrics = computeMetrics({
    shipments, plans: result.plans as unknown as V1DeliveryPlan[], unmatched: result.unmatched,
    occurredEvents: [], settings: DEFAULT_SETTINGS,
  });
  return { result, metrics };
}

export function buildCompare(employees: Employee[], positions: Record<string, number>, shipments: Shipment[]): CompareResponse {
  const travel = lineProvider(positions);
  const ctx: MatchContext = {
    travel, employees, trips: employees.flatMap((e) => buildTrips(e, travel)),
    businesses: Object.keys(positions).filter((id) => id.startsWith('biz-')).map(business),
    settings: { ...DEFAULT_SETTINGS },
  };
  const { directOnly, withRelay } = compareAssignments(shipments, ctx);
  return { directOnly: side(shipments, directOnly), withRelay: side(shipments, withRelay) };
}

const POSITIONS = {
  'biz-a': 0, 'biz-r': 10, 'biz-b': 30, 'biz-c': 2,
  'home-emp-1': 15, 'home-emp-2': 5, 'home-emp-3': 3, 'home-emp-4': 16,
};

/**
 * One package goes direct (emp-3 drives biz-a -> biz-c -> home on the way), one only matches through the
 * relay point biz-r (emp-1 evening to biz-r, emp-2 the next morning to biz-b).
 */
export function relayGainCompare(): CompareResponse {
  return buildCompare([
    employee('emp-1', 'biz-a', { availableMorning: false }),
    employee('emp-2', 'biz-b', { availableEvening: false }),
    employee('emp-3', 'biz-a', { availableMorning: false }),
  ], POSITIONS, [shipment('shp-1', 'biz-a', 'biz-b', 1), shipment('shp-2', 'biz-a', 'biz-c', 2)]);
}

/** Nobody can carry anything: every commuter is unavailable both ways. */
export function allUnmatchedCompare(): CompareResponse {
  return buildCompare([
    employee('emp-1', 'biz-a', { availableEvening: false, availableMorning: false }),
    employee('emp-2', 'biz-b', { availableEvening: false, availableMorning: false }),
  ], POSITIONS, [shipment('shp-1', 'biz-a', 'biz-b', 1), shipment('shp-2', 'biz-a', 'biz-c', 2)]);
}

/** Only a direct match exists, so both sides match the same package. */
export function equalSidesCompare(): CompareResponse {
  return buildCompare([
    employee('emp-3', 'biz-a', { availableMorning: false }),
  ], POSITIONS, [shipment('shp-2', 'biz-a', 'biz-c', 1)]);
}
