// Hand-built MVP II JobResponses for the employee v2 job detail tests (issue #387).
import type { JobResponse } from '../../shared/v2/api';
import type { DeliveryPlan, JobStatus, Leg, NetworkBusiness, Shipment, Stop, Trip } from '../../shared/v2/types';

export const businesses: NetworkBusiness[] = [
  { id: 'biz-studio', name: 'Ink Studio', address: '55 Water St, Brooklyn', neighborhood: 'DUMBO', borough: 'Brooklyn', kind: 'office', lat: 40.703, lng: -73.989 },
  { id: 'biz-agency', name: 'Midtown Agency', address: '1 Bryant Park, New York', neighborhood: 'Midtown', borough: 'Manhattan', kind: 'office', lat: 40.755, lng: -73.984 },
  { id: 'biz-cafe', name: 'River Cafe Roasters', address: '10 Front St, Brooklyn', neighborhood: 'DUMBO', borough: 'Brooklyn', kind: 'cafe', lat: 40.702, lng: -73.99 },
  { id: 'biz-bakery', name: 'LIC Bakery', address: '5-25 46th Ave, Queens', neighborhood: 'Long Island City', borough: 'Queens', kind: 'shop', lat: 40.747, lng: -73.954 },
];

const shipment = (over: Partial<Shipment> = {}): Shipment => ({
  id: 'shp-0001', clientRequestId: 'c1', label: 'Brand proofs',
  originBusinessId: 'biz-studio', destinationBusinessId: 'biz-agency',
  readyMin: 960, deadlineMin: 2040, category: 'envelope', description: 'Printed proofs', weightGrams: 300,
  pickupInstructions: 'Ask for Maya at reception', dropoffInstructions: 'Leave with the front desk',
  createdSeq: 1, ...over,
});

const stop = (placeId: string, kind: Stop['kind'], arrivalMin: number): Stop =>
  ({ placeId, kind, arrivalMin, serviceStartMin: arrivalMin, serviceEndMin: arrivalMin + 2 });

const leg = (tripId: string, employeeId: string, placeIds: string[], stops: Stop[], finishMin: number, extraMin: number, extraDistanceM: number, rewardCents: number): Leg =>
  ({ tripId, employeeId, placeIds, stops, finishMin, extraMin, extraDistanceM, rewardCents });

const trip = (id: string, employeeId: string, direction: Trip['direction'], originPlaceId: string, destinationPlaceId: string, departureMin: number, baselineDurationMin: number): Trip =>
  ({ id, employeeId, direction, originPlaceId, destinationPlaceId, departureMin, baselineDurationMin, baselineDistanceM: 12000 });

function response(plan: DeliveryPlan, legIndex: number, t: Trip, ship: Shipment, status: JobStatus): JobResponse {
  const l = plan.legs[legIndex];
  return {
    job: {
      id: `job-${plan.id}-${legIndex}`, planId: plan.id, shipmentId: ship.id, employeeId: l.employeeId,
      legIndex, tripId: t.id, pickup: l.stops[0], dropoff: l.stops[l.stops.length - 1], rewardCents: l.rewardCents,
    },
    status, shipment: ship, plan, trip: t,
  };
}

/** Evening direct: Ink Studio -> Midtown Agency -> home (Astoria). */
export function eveningDirect(status: JobStatus = 'assigned'): JobResponse {
  const t = trip('trip-emp-01-evening', 'emp-01', 'evening', 'biz-studio', 'home-story-maya', 1035, 38);
  const plan: DeliveryPlan = {
    id: 'plan-0001', shipmentId: 'shp-0001', kind: 'direct', deliveryMin: 1066,
    legs: [leg(t.id, 'emp-01', ['biz-studio', 'biz-agency', 'home-story-maya'],
      [stop('biz-studio', 'pickup', 1035), stop('biz-agency', 'delivery', 1064)], 1081, 8, 3400, 450)],
    customerPriceCents: 900, platformContributionCents: 0,
  };
  return response(plan, 0, t, shipment(), status);
}

/** Morning direct: home (Park Slope) -> Ink Studio -> Midtown Agency (workplace). */
export function morningDirect(status: JobStatus = 'assigned'): JobResponse {
  const t = trip('trip-emp-02-morning', 'emp-02', 'morning', 'home-042', 'biz-agency', 1950, 45);
  const plan: DeliveryPlan = {
    id: 'plan-0002', shipmentId: 'shp-0002', kind: 'direct', deliveryMin: 2000,
    legs: [leg(t.id, 'emp-02', ['home-042', 'biz-studio', 'biz-agency'],
      [stop('biz-studio', 'pickup', 1968), stop('biz-agency', 'delivery', 1998)], 2000, 5, 1250, 300)],
    customerPriceCents: 700, platformContributionCents: 0,
  };
  return response(plan, 0, t, shipment({ id: 'shp-0002' }), status);
}

function relayPlan(): DeliveryPlan {
  return {
    id: 'plan-0003', shipmentId: 'shp-0003', kind: 'relay', relayBusinessId: 'biz-cafe', deliveryMin: 2010,
    legs: [
      leg('trip-emp-03-evening', 'emp-03', ['biz-bakery', 'biz-cafe', 'home-007'],
        [stop('biz-bakery', 'pickup', 1050), stop('biz-cafe', 'hub_drop', 1074)], 1099, 9, 4100, 520),
      leg('trip-emp-04-morning', 'emp-04', ['home-c-40.67000_-73.98000', 'biz-cafe', 'biz-agency'],
        [stop('biz-cafe', 'hub_pickup', 1965), stop('biz-agency', 'delivery', 2008)], 2010, 7, 2300, 480),
    ],
    customerPriceCents: 1400, platformContributionCents: 0,
  };
}
const relayShipment = () => shipment({
  id: 'shp-0003', label: 'Gift box', originBusinessId: 'biz-bakery', destinationBusinessId: 'biz-agency',
  pickupInstructions: 'Box is behind the counter', dropoffInstructions: 'Hand to the office manager',
});

/** Relay leg 1: LIC Bakery -> River Cafe Roasters (relay) -> home (Astoria). */
export function relayLeg1(status: JobStatus = 'assigned'): JobResponse {
  const t = trip('trip-emp-03-evening', 'emp-03', 'evening', 'biz-bakery', 'home-007', 1050, 42);
  return response(relayPlan(), 0, t, relayShipment(), status);
}

/** Relay leg 2: home -> River Cafe Roasters (relay) -> Midtown Agency (workplace). */
export function relayLeg2(status: JobStatus = 'assigned'): JobResponse {
  const t = trip('trip-emp-04-morning', 'emp-04', 'morning', 'home-c-40.67000_-73.98000', 'biz-agency', 1950, 50);
  return response(relayPlan(), 1, t, relayShipment(), status);
}

export const STATUSES: JobStatus[] = ['assigned', 'in_progress', 'completed'];
