// Hand-built MVP II EmployeeDashboard for the employee-v2-workspace tests.
import type { EmployeeDashboard, EmployeeJobView } from '../../shared/v2/api';
import type { DeliveryPlan, Job, NetworkBusiness, Shipment, Stop, Trip } from '../../shared/v2/types';

export const businesses: NetworkBusiness[] = [
  { id: 'biz-acme', name: 'Acme Studio', address: '12 W 21st St, New York, NY', neighborhood: 'Flatiron', borough: 'Manhattan', kind: 'office', lat: 40.7411, lng: -73.9925 },
  { id: 'biz-luna', name: 'Cafe Luna', address: '30-01 Broadway, Queens, NY', neighborhood: 'Astoria', borough: 'Queens', kind: 'cafe', lat: 40.7616, lng: -73.9249 },
  { id: 'biz-books', name: 'Corner Books', address: '41-10 31st Ave, Queens, NY', neighborhood: 'Long Island City', borough: 'Queens', kind: 'shop', lat: 40.7505, lng: -73.9396 },
  { id: 'biz-paper', name: 'Paper Goods', address: '200 Bedford Ave, Brooklyn, NY', neighborhood: 'Williamsburg', borough: 'Brooklyn', kind: 'shop', lat: 40.7171, lng: -73.9568 },
];

const shipment = (id: string, label: string, from: string, to: string): Shipment => ({
  id, clientRequestId: `req-${id}`, label, originBusinessId: from, destinationBusinessId: to,
  readyMin: 1020, deadlineMin: 2100, category: 'small_box', description: 'Samples', weightGrams: 800,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
});
const stop = (placeId: string, kind: Stop['kind'], at: number): Stop =>
  ({ placeId, kind, arrivalMin: at, serviceStartMin: at, serviceEndMin: at + 2 });
const leg = (tripId: string, employeeId: string, stops: Stop[], extraMin: number, rewardCents: number) => ({
  tripId, employeeId, placeIds: stops.map((s) => s.placeId), stops,
  finishMin: stops[stops.length - 1].serviceEndMin, extraMin, extraDistanceM: 1200, rewardCents,
});

// Direct job on the evening commute.
const s1 = shipment('shp-001', 'Fabric swatches', 'biz-acme', 'biz-luna');
const p1Stops = [stop('biz-acme', 'pickup', 1050), stop('biz-luna', 'delivery', 1086)];
const p1: DeliveryPlan = {
  id: 'plan-shp-001', shipmentId: s1.id, kind: 'direct', deliveryMin: 1086,
  legs: [leg('emp-001-eve', 'emp-001', p1Stops, 7, 800)], customerPriceCents: 1500, platformContributionCents: 0,
};
const j1: Job = { id: 'plan-shp-001-L0', planId: p1.id, shipmentId: s1.id, employeeId: 'emp-001', legIndex: 0, tripId: 'emp-001-eve', pickup: p1Stops[0], dropoff: p1Stops[1], rewardCents: 800 };

// Relay: leg 1 by someone else, leg 2 (this employee) on the morning commute from the relay point.
const s2 = shipment('shp-002', 'Print proofs', 'biz-paper', 'biz-acme');
const l1Stops = [stop('biz-paper', 'pickup', 1060), stop('biz-books', 'hub_drop', 1090)];
const l2Stops = [stop('biz-books', 'hub_pickup', 1960), stop('biz-acme', 'delivery', 1990)];
const p2: DeliveryPlan = {
  id: 'plan-shp-002', shipmentId: s2.id, kind: 'relay', relayBusinessId: 'biz-books', deliveryMin: 1990,
  legs: [leg('emp-002-eve', 'emp-002', l1Stops, 5, 600), leg('emp-001-morn', 'emp-001', l2Stops, 4, 700)],
  customerPriceCents: 2000, platformContributionCents: 0,
};
const j2: Job = { id: 'plan-shp-002-L1', planId: p2.id, shipmentId: s2.id, employeeId: 'emp-001', legIndex: 1, tripId: 'emp-001-morn', pickup: l2Stops[0], dropoff: l2Stops[1], rewardCents: 700 };

// Completed direct job.
const s3 = shipment('shp-003', 'Signed contract', 'biz-acme', 'biz-books');
const p3Stops = [stop('biz-acme', 'pickup', 1052), stop('biz-books', 'delivery', 1070)];
const p3: DeliveryPlan = {
  id: 'plan-shp-003', shipmentId: s3.id, kind: 'direct', deliveryMin: 1070,
  legs: [leg('emp-001-eve', 'emp-001', p3Stops, 3, 500)], customerPriceCents: 1200, platformContributionCents: 0,
};
const j3: Job = { id: 'plan-shp-003-L0', planId: p3.id, shipmentId: s3.id, employeeId: 'emp-001', legIndex: 0, tripId: 'emp-001-eve', pickup: p3Stops[0], dropoff: p3Stops[1], rewardCents: 500 };

export const directView: EmployeeJobView = { job: j1, status: 'assigned', shipment: s1, plan: p1 };
export const relayView: EmployeeJobView = { job: j2, status: 'assigned', shipment: s2, plan: p2 };
export const completedView: EmployeeJobView = { job: j3, status: 'completed', shipment: s3, plan: p3 };

export const trips: Trip[] = [
  { id: 'emp-001-eve', employeeId: 'emp-001', direction: 'evening', originPlaceId: 'biz-acme', destinationPlaceId: 'home-story-maya', departureMin: 1050, baselineDurationMin: 34, baselineDistanceM: 8400 },
  { id: 'emp-001-morn', employeeId: 'emp-001', direction: 'morning', originPlaceId: 'home-story-maya', destinationPlaceId: 'biz-acme', departureMin: 1950, baselineDurationMin: 36, baselineDistanceM: 8650 },
];

export const dashboard: EmployeeDashboard = {
  employee: {
    id: 'emp-001', name: 'Maya Chen', businessId: 'biz-acme', homeId: 'home-story-maya',
    eveningDepartureMin: 1050, morningDepartureMin: 1950, maxExtraMin: 15,
    availableEvening: true, availableMorning: true,
  },
  home: { id: 'home-story-maya', neighborhood: 'Astoria', lat: 40.76421, lng: -73.92351 },
  trips,
  assigned: [directView, relayView],
  completed: [completedView],
  earnedCents: 500, projectedCents: 2000,
  notifications: [], phase: 'planning', version: 3,
};

export const noMorning: EmployeeDashboard = {
  ...dashboard,
  employee: { ...dashboard.employee, availableMorning: false },
  trips: [trips[0]],
  assigned: [directView],
};

export const emptyDashboard: EmployeeDashboard = {
  ...dashboard, assigned: [], completed: [], earnedCents: 0, projectedCents: 0,
};

export const lockedDashboard: EmployeeDashboard = { ...dashboard, phase: 'locked' };
