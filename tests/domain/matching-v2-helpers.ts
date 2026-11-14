import { pairKey, TravelDataMissingError, type Employee, type NetworkBusiness, type Shipment, type TravelProvider } from '../../shared/v2/types';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTrips } from '../../server/domain/v2/trips';
import type { MatchContext } from '../../server/domain/v2/matching';

export class TableTravel implements TravelProvider {
  constructor(readonly pairs: Record<string, { durationMin: number; distanceM: number }> = {}) {}
  private get(from: string, to: string) {
    if (from === to) return { durationMin: 0, distanceM: 0 };
    const pair = this.pairs[pairKey(from, to)];
    if (!pair) throw new TravelDataMissingError(from, to);
    return pair;
  }
  durationMin(from: string, to: string) { return this.get(from, to).durationMin; }
  distanceM(from: string, to: string) { return this.get(from, to).distanceM; }
  polyline() { return null; }
}

export const business = (id: string): NetworkBusiness => ({
  id, name: id, address: 'Test', neighborhood: 'Test', borough: 'Queens', kind: 'office', lat: 0, lng: 0,
});
export const employee = (id: string, businessId: string, overrides: Partial<Employee> = {}): Employee => ({
  id, name: id, businessId, homeId: `home-${id}`, eveningDepartureMin: 1020, morningDepartureMin: 1935,
  availableEvening: true, availableMorning: true, maxExtraMin: 8, ...overrides,
});
export const shipment = (overrides: Partial<Shipment> = {}): Shipment => ({
  id: 'shp-1', clientRequestId: 'test-1', label: 'Test', originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: 960, deadlineMin: 1980, category: 'envelope', description: '', weightGrams: 100,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: 1, ...overrides,
});

/** Complete table from test coordinates; production never estimates travel. */
export function lineTravel(positions: Record<string, number>): TableTravel {
  const travel = new TableTravel();
  for (const [from, x] of Object.entries(positions)) {
    for (const [to, y] of Object.entries(positions)) {
      travel.pairs[pairKey(from, to)] = { durationMin: Math.abs(x - y), distanceM: Math.abs(x - y) * 350 };
    }
  }
  return travel;
}

export function context(employees: Employee[], positions: Record<string, number>): MatchContext {
  const travel = lineTravel(positions);
  return { employees, travel, trips: employees.flatMap(e => buildTrips(e, travel)),
    businesses: Object.keys(positions).filter(id => id.startsWith('biz-')).map(business), settings: { ...DEFAULT_SETTINGS } };
}

export function relayContext(): MatchContext {
  return context([
    employee('emp-1', 'biz-a', { availableMorning: false }),
    employee('emp-2', 'biz-b', { availableEvening: false }),
  ], { 'biz-a': 0, 'biz-r': 10, 'biz-b': 30, 'home-emp-1': 15, 'home-emp-2': 5 });
}
