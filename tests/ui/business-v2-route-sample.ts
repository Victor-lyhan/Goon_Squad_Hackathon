// Hand-built ShipmentViews + MapResponse for the Business delivery route map tests (#549; not a test file).
import polyline from '@mapbox/polyline';
import type { MapResponse, ShipmentView } from '../../shared/v2/api';
import type { DeliveryPlan, Leg, NetworkBusiness, Stop } from '../../shared/v2/types';

const biz = (id: string, name: string, neighborhood: string, lat: number, lng: number): NetworkBusiness => ({
  id, name, address: '1 Test St', neighborhood, borough: 'Manhattan', kind: 'office', lat, lng,
});

export const SENDER = biz('biz-acme', 'Acme Studio', 'Chelsea', 40.742, -74.001);
export const RECIPIENT = biz('biz-bakery', 'Bakery Row', 'Williamsburg', 40.714, -73.961);
export const RELAY = biz('biz-atlas', 'Atlas Books', 'Long Island City', 40.744, -73.948);
export const HOME_1 = { id: 'home-001', neighborhood: 'Astoria', lat: 40.7644, lng: -73.9235 };
export const HOME_2 = { id: 'home-002', neighborhood: 'Greenpoint', lat: 40.7290, lng: -73.9540 };

const stop = (placeId: string, kind: Stop['kind'], min: number): Stop => ({
  placeId, kind, arrivalMin: min - 1, serviceStartMin: min, serviceEndMin: min + 2,
});
const leg = (employeeId: string, dir: 'eve' | 'morn', placeIds: string[], stops: Stop[]): Leg => ({
  tripId: `${employeeId}-${dir}`, employeeId, placeIds, stops,
  finishMin: stops[stops.length - 1].serviceEndMin + 20, extraMin: 6, extraDistanceM: 1000, rewardCents: 500,
});

export const relayPlan: DeliveryPlan = {
  id: 'plan-shp-7', shipmentId: 'shp-7', kind: 'relay', relayBusinessId: RELAY.id, deliveryMin: 1985,
  customerPriceCents: 1600, platformContributionCents: 200,
  legs: [
    leg('emp-1', 'eve', [SENDER.id, RELAY.id, HOME_1.id], [stop(SENDER.id, 'pickup', 1050), stop(RELAY.id, 'hub_drop', 1090)]),
    leg('emp-2', 'morn', [HOME_2.id, RELAY.id, RECIPIENT.id], [stop(RELAY.id, 'hub_pickup', 1930), stop(RECIPIENT.id, 'delivery', 1985)]),
  ],
};

export const directPlan: DeliveryPlan = {
  id: 'plan-shp-7', shipmentId: 'shp-7', kind: 'direct', deliveryMin: 1110,
  customerPriceCents: 1250, platformContributionCents: 0,
  legs: [leg('emp-1', 'eve', [SENDER.id, RECIPIENT.id, HOME_1.id], [stop(SENDER.id, 'pickup', 1050), stop(RECIPIENT.id, 'delivery', 1110)])],
};

export const view = (plan: DeliveryPlan | null): ShipmentView => ({
  shipment: {
    id: 'shp-7', clientRequestId: 'req-7', label: 'Sample boxes',
    originBusinessId: SENDER.id, destinationBusinessId: RECIPIENT.id, readyMin: 1020, deadlineMin: 2040,
    category: 'small_box', description: 'Fabric swatches', weightGrams: 1500,
    pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
  },
  plan,
  jobIds: plan ? plan.legs.map((_, i) => `${plan.id}-L${i}`) : [],
  status: plan ? 'scheduled' : 'unmatched',
  deliveredAtMin: null,
  unmatchedReason: plan ? null : 'No employee commute passes both businesses before the deadline.',
});

const enc = (pts: [number, number][]) => polyline.encode(pts);
const line = (from: string, to: string, encoded: string | null) => ({ from, to, encoded });

/** Every pair of both plans listed; the relay plan's two stop pairs and the direct pair have road lines. */
export const MAP: MapResponse = {
  runId: 'run-1',
  businesses: [SENDER, RECIPIENT, RELAY],
  homes: [HOME_1, HOME_2],
  employees: [
    { id: 'emp-1', name: 'Maya Chen', businessId: SENDER.id, homeId: HOME_1.id },
    { id: 'emp-2', name: 'Luis Ortega', businessId: RECIPIENT.id, homeId: HOME_2.id },
  ],
  polylines: [
    line(SENDER.id, RELAY.id, enc([[40.742, -74.001], [40.75, -73.97], [40.744, -73.948]])),
    line(RELAY.id, HOME_1.id, enc([[40.744, -73.948], [40.7644, -73.9235]])),
    line(HOME_2.id, RELAY.id, enc([[40.729, -73.954], [40.744, -73.948]])),
    line(RELAY.id, RECIPIENT.id, enc([[40.744, -73.948], [40.73, -73.955], [40.714, -73.961]])),
    line(SENDER.id, RECIPIENT.id, enc([[40.742, -74.001], [40.72, -73.98], [40.714, -73.961]])),
    line(RECIPIENT.id, HOME_1.id, enc([[40.714, -73.961], [40.7644, -73.9235]])),
  ],
};

export const withLine = (from: string, to: string, encoded: string | null): MapResponse => ({
  ...MAP,
  polylines: [...MAP.polylines.filter((p) => !(p.from === from && p.to === to)), line(from, to, encoded)],
});
