import type { Employee, NetworkBusiness, Run, Shipment, TravelProvider } from '../../shared/v2/types';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { generateCandidates, type MatchContext } from '../../server/domain/v2/matching';
import { buildTrips } from '../../server/domain/v2/trips';
import { createFakeProvider } from '../../server/geo/fakeProvider';

export const businesses: NetworkBusiness[] = [
  { id: 'biz-a', name: 'A', address: 'A', neighborhood: 'Test', borough: 'Queens', kind: 'office', lat: 40, lng: -74 },
  { id: 'biz-r', name: 'Relay', address: 'R', neighborhood: 'Test', borough: 'Queens', kind: 'cafe', lat: 40.005, lng: -73.995 },
  { id: 'biz-b', name: 'B', address: 'B', neighborhood: 'Test', borough: 'Queens', kind: 'office', lat: 40.01, lng: -73.99 },
];

const homes = [
  { id: 'home-eve', neighborhood: 'Test', lat: 40.015, lng: -73.985 },
  { id: 'home-morn', neighborhood: 'Test', lat: 39.995, lng: -74.005 },
];

const placeOrder = [...businesses, ...homes];

export function travelWithTimes(times: Record<string, number>) {
  return createFakeProvider({ pairs: placeOrder.flatMap(from => placeOrder.flatMap(to =>
    from.id === to.id ? [] : [{ from: from.id, to: to.id, durationMin: times[`${from.id}|${to.id}`] ?? 10, distanceM: 1_000 }],
  )) });
}

export function employee(id: string, businessId: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id, name: id, businessId, homeId: id === 'emp-eve' ? 'home-eve' : 'home-morn',
    eveningDepartureMin: 1020, morningDepartureMin: 1935, maxExtraMin: 8,
    availableEvening: false, availableMorning: false, ...overrides,
  };
}

export function shipment(id = 'shp-1'): Shipment {
  return {
    id, clientRequestId: id, label: id, originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
    readyMin: 960, deadlineMin: 2_100, category: 'envelope', description: '', weightGrams: 100,
    pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
  };
}

export function runFor(employees: Employee[], shipmentToPlan: Shipment, travel: TravelProvider, kind: 'direct' | 'relay'): Run {
  const trips = employees.flatMap(candidate => buildTrips(candidate, travel));
  const context: MatchContext = { travel, trips, employees, businesses, settings: { ...DEFAULT_SETTINGS } };
  const plan = generateCandidates(shipmentToPlan, context).find(candidate => candidate.kind === kind);
  if (plan === undefined) throw new Error(`Expected a ${kind} plan`);
  return {
    runId: 'run-test', version: 1,
    scenario: { schemaVersion: 2, name: 'Test', preset: 'custom', seed: 1, businesses, homes, employees,
      shipments: [shipmentToPlan], settings: { ...DEFAULT_SETTINGS } },
    trips, assignments: { plans: [plan], unmatched: [], computeMs: 0 }, jobs: [], notifications: [], events: [],
    clock: { phase: 'planning', playing: false, timeMin: 900, speed: 30 },
  };
}
