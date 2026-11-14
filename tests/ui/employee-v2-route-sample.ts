// Hand-built MVP II EmployeeDashboard + MapResponse for the commute route preview tests (not a test file itself).
import polyline from '@mapbox/polyline';
import type { EmployeeDashboard, EmployeeJobView, MapResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Job, NetworkBusiness, Shipment, Trip } from '../../shared/v2/types';

const biz = (id: string, name: string, neighborhood: string, lat: number, lng: number): NetworkBusiness => ({
  id, name, address: '100 Sample Ave', neighborhood, borough: 'Manhattan', kind: 'office', lat, lng,
});

export const WORK = biz('biz-acme', 'Acme Studio', 'Midtown', 40.7540, -73.9840);
export const SENDER = biz('biz-bakery', 'Bakery Row', 'Chelsea', 40.7420, -74.0010);
export const RELAY = biz('biz-books', 'Atlas Books', 'Long Island City', 40.7440, -73.9480);
export const OTHER = biz('biz-cafe', 'Corner Cafe', 'DUMBO', 40.7030, -73.9890);
export const BUSINESSES: NetworkBusiness[] = [WORK, SENDER, RELAY, OTHER];

export const HOME = { id: 'home-story-maya', neighborhood: 'Astoria', lat: 40.7644, lng: -73.9235 };

export const TRIPS: Trip[] = [
  { id: 'trip-emp-1-evening', employeeId: 'emp-1', direction: 'evening', originPlaceId: WORK.id, destinationPlaceId: HOME.id,
    departureMin: 1050, baselineDurationMin: 34, baselineDistanceM: 9800 },
  { id: 'trip-emp-1-morning', employeeId: 'emp-1', direction: 'morning', originPlaceId: HOME.id, destinationPlaceId: WORK.id,
    departureMin: 1950, baselineDurationMin: 31, baselineDistanceM: 9650 },
];

const shipment: Shipment = {
  id: 'shp-1', clientRequestId: 'req-1', label: 'Sample boxes',
  originBusinessId: SENDER.id, destinationBusinessId: OTHER.id,
  readyMin: 1020, deadlineMin: 2040, category: 'small_box', description: '', weightGrams: 500,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
};

const pickup = { placeId: SENDER.id, kind: 'pickup' as const, arrivalMin: 1062, serviceStartMin: 1062, serviceEndMin: 1064 };
const relayDrop = { placeId: RELAY.id, kind: 'hub_drop' as const, arrivalMin: 1080, serviceStartMin: 1080, serviceEndMin: 1082 };

export const PLAN: DeliveryPlan = {
  id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'relay', relayBusinessId: RELAY.id, deliveryMin: 1990,
  customerPriceCents: 1800, platformContributionCents: 0,
  legs: [
    { tripId: 'trip-emp-1-evening', employeeId: 'emp-1', placeIds: [WORK.id, SENDER.id, RELAY.id, HOME.id],
      stops: [pickup, relayDrop], finishMin: 1100, extraMin: 9, extraDistanceM: 2100, rewardCents: 600 },
    { tripId: 'trip-emp-2-morning', employeeId: 'emp-2', placeIds: ['home-002', RELAY.id, OTHER.id, 'biz-x'],
      stops: [
        { placeId: RELAY.id, kind: 'hub_pickup', arrivalMin: 1960, serviceStartMin: 1960, serviceEndMin: 1962 },
        { placeId: OTHER.id, kind: 'delivery', arrivalMin: 1988, serviceStartMin: 1988, serviceEndMin: 1990 },
      ], finishMin: 2000, extraMin: 7, extraDistanceM: 1500, rewardCents: 500 },
  ],
};

const job: Job = {
  id: 'job-plan-shp-1-0', planId: PLAN.id, shipmentId: 'shp-1', employeeId: 'emp-1',
  legIndex: 0, tripId: 'trip-emp-1-evening', pickup, dropoff: relayDrop, rewardCents: 600,
};

export const JOB: EmployeeJobView = { job, status: 'assigned', shipment, plan: PLAN };

export const DASHBOARD: EmployeeDashboard = {
  employee: {
    id: 'emp-1', name: 'Maya Chen', businessId: WORK.id, homeId: HOME.id,
    eveningDepartureMin: 1050, morningDepartureMin: 1950, maxExtraMin: 15,
    availableEvening: true, availableMorning: true,
  },
  home: HOME, trips: TRIPS,
  assigned: [JOB], completed: [],
  earnedCents: 0, projectedCents: 600, notifications: [],
  phase: 'planning', version: 3,
};

const enc = (pts: [number, number][]) => polyline.encode(pts);
const line = (from: string, to: string, encoded: string | null) => ({ from, to, encoded });

/** Every commute and job-leg line cached. */
export const MAP: MapResponse = {
  runId: 'run-1',
  businesses: BUSINESSES,
  homes: [HOME],
  employees: [{ id: 'emp-1', name: 'Maya Chen', businessId: WORK.id, homeId: HOME.id }],
  polylines: [
    line(WORK.id, HOME.id, enc([[40.754, -73.984], [40.76, -73.95], [40.7644, -73.9235]])),
    line(HOME.id, WORK.id, enc([[40.7644, -73.9235], [40.758, -73.96], [40.754, -73.984]])),
    line(WORK.id, SENDER.id, enc([[40.754, -73.984], [40.742, -74.001]])),
    line(SENDER.id, RELAY.id, enc([[40.742, -74.001], [40.744, -73.948]])),
    line(RELAY.id, HOME.id, enc([[40.744, -73.948], [40.7644, -73.9235]])),
  ],
};

export const withLine = (from: string, to: string, encoded: string | null): MapResponse => ({
  ...MAP,
  polylines: [...MAP.polylines.filter((p) => !(p.from === from && p.to === to)), line(from, to, encoded)],
});
