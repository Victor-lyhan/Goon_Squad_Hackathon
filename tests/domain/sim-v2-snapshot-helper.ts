import { createFakeProvider } from '../../server/geo/fakeProvider.js';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing.js';
import { assignShipments } from '../../server/domain/v2/matching.js';
import { buildTrips } from '../../server/domain/v2/trips.js';
import { buildTimeline } from '../../server/domain/v2/timeline.js';
import type {
  Employee,
  Job,
  MarkerPosition,
  NetworkBusiness,
  Run,
  Shipment,
  TravelProvider,
} from '../../shared/v2/types.js';
import type { Movement as SnapshotMovement } from '../../server/domain/v2/simulation.js';

const placeIds = ['biz-a', 'biz-b', 'biz-c', 'biz-d', 'biz-r', 'home-direct', 'home-relay', 'home-morning'];
const axis: Record<string, number> = {
  'biz-a': 100, 'biz-b': 105, 'biz-c': 0, 'biz-d': 30, 'biz-r': 10,
  'home-direct': 110, 'home-relay': 15, 'home-morning': 15,
};

const travel = createFakeProvider({
  pairs: placeIds.flatMap((from) => placeIds.flatMap((to) => from === to ? [] : [{
    from, to, durationMin: Math.abs(axis[from]! - axis[to]!), distanceM: Math.abs(axis[from]! - axis[to]!) * 100,
  }])),
});

const business = (id: string): NetworkBusiness => ({
  id, name: id, address: 'Test address', neighborhood: 'Test', borough: 'Queens', kind: 'office',
  lat: axis[id]!, lng: axis[id]!,
});

const employee = (id: string, businessId: string, homeId: string, overrides: Partial<Employee> = {}): Employee => ({
  id, name: id, businessId, homeId, eveningDepartureMin: 1100, morningDepartureMin: 1950,
  maxExtraMin: 20, availableEvening: true, availableMorning: true, ...overrides,
});

const shipment = (id: string, originBusinessId: string, destinationBusinessId: string, createdSeq: number): Shipment => ({
  id, clientRequestId: `req-${id}`, label: id, originBusinessId, destinationBusinessId,
  readyMin: 900, deadlineMin: 2150, category: 'small_box', description: '', weightGrams: 100,
  pickupInstructions: '', dropoffInstructions: '', createdSeq,
});

function jobsFor(plans: Run['assignments']['plans']): Job[] {
  return plans.flatMap((plan) => plan.legs.map((leg, legIndex) => ({
    id: `${plan.id}-L${legIndex}`, planId: plan.id, shipmentId: plan.shipmentId,
    employeeId: leg.employeeId, legIndex, tripId: leg.tripId,
    pickup: leg.stops[0]!, dropoff: leg.stops.at(-1)!, rewardCents: leg.rewardCents,
  })));
}

/** A matcher-built run with direct, relay, and unmatched shipments. */
export function snapshotRun(): { run: Run; travel: typeof travel } {
  const businesses = ['biz-a', 'biz-b', 'biz-c', 'biz-d', 'biz-r'].map(business);
  const employees = [
    employee('emp-direct', 'biz-a', 'home-direct', { availableMorning: false, eveningDepartureMin: 1000 }),
    employee('emp-relay', 'biz-c', 'home-relay', { availableMorning: false }),
    employee('emp-morning', 'biz-d', 'home-morning', { availableEvening: false }),
  ];
  const shipments = [
    shipment('shp-direct', 'biz-a', 'biz-b', 1),
    shipment('shp-relay', 'biz-c', 'biz-d', 2),
    shipment('shp-unmatched', 'biz-c', 'biz-c', 3),
  ];
  const trips = employees.flatMap((person) => buildTrips(person, travel));
  const assignments = assignShipments(shipments, { travel, trips, employees, businesses, settings: DEFAULT_SETTINGS });
  const jobs = jobsFor(assignments.plans);

  return {
    travel,
    run: {
      runId: 'run-snapshot', version: 7,
      scenario: {
        schemaVersion: 2, name: 'Snapshot test', preset: 'custom', seed: 1,
        businesses,
        homes: employees.map((person) => ({ id: person.homeId, neighborhood: 'Test', lat: axis[person.homeId]!, lng: axis[person.homeId]! })),
        employees, shipments, settings: DEFAULT_SETTINGS,
      },
      trips, assignments, jobs, notifications: [], events: buildTimeline(assignments.plans, jobs),
      clock: { phase: 'locked', playing: false, timeMin: 900, speed: 30 },
    },
  };
}

export class TestMovement implements SnapshotMovement {
  receivedMarkers: MarkerPosition[] | undefined;

  markersAt(_run: Run, timeMin: number, _travel: Pick<TravelProvider, 'polyline'>): MarkerPosition[] {
    return [{ employeeId: 'marker-employee', lat: timeMin, lng: -timeMin, servicing: false }];
  }

  packagePositionsAt(_run: Run, _timeMin: number, markers: MarkerPosition[]) {
    this.receivedMarkers = markers;
    return {
      'shp-direct': { lat: markers[0]!.lat, lng: markers[0]!.lng },
      'shp-relay': { lat: 40.7, lng: -73.9 },
    };
  }
}
