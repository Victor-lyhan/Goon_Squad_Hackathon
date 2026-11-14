// Hand-built MVP II ShipmentViews for the delivery details tests (not a test file itself).
import type { ShipmentView } from '../../shared/v2/api';
import type { DeliveryPlan, Leg, NetworkBusiness, Shipment, ShipmentProgress, Stop } from '../../shared/v2/types';

const biz = (id: string, name: string, neighborhood: string): NetworkBusiness => ({
  id, name, address: '1 Test St', neighborhood, borough: 'Manhattan', kind: 'office', lat: 40.75, lng: -73.98,
});

export const ACME = biz('biz-acme', 'Acme Studio', 'Chelsea');
export const BAKERY = biz('biz-bakery', 'Bakery Row', 'Williamsburg');
export const ATLAS = biz('biz-atlas', 'Atlas Books', 'Long Island City');
export const BUSINESSES = [ACME, BAKERY, ATLAS];
export const EMPLOYEES = [{ id: 'emp-1', name: 'Maya Chen' }, { id: 'emp-2', name: 'Luis Ortega' }];

export const shipment = (over: Partial<Shipment> = {}): Shipment => ({
  id: 'shp-7', clientRequestId: 'req-7', label: 'Sample boxes',
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id,
  readyMin: 1020, deadlineMin: 2040,
  category: 'small_box', description: 'Fabric swatches', weightGrams: 1500,
  pickupInstructions: 'Front desk', dropoffInstructions: '', createdSeq: 1,
  ...over,
});

const stop = (placeId: string, kind: Stop['kind'], min: number): Stop => ({
  placeId, kind, arrivalMin: min - 1, serviceStartMin: min, serviceEndMin: min + 2,
});

const leg = (employeeId: string, dir: 'eve' | 'morn', placeIds: string[], stops: Stop[], extraMin: number): Leg => ({
  tripId: `${employeeId}-${dir}`, employeeId, placeIds, stops,
  finishMin: stops[stops.length - 1].serviceEndMin + 20, extraMin, extraDistanceM: 1000, rewardCents: 500,
});

export const directPlan: DeliveryPlan = {
  id: 'plan-shp-7', shipmentId: 'shp-7', kind: 'direct', deliveryMin: 1110,
  customerPriceCents: 1250, platformContributionCents: 0,
  legs: [leg('emp-1', 'eve', ['biz-acme', 'biz-bakery', 'home-001'],
    [stop('biz-acme', 'pickup', 1050), stop('biz-bakery', 'delivery', 1110)], 9)],
};

export const relayPlan: DeliveryPlan = {
  id: 'plan-shp-7', shipmentId: 'shp-7', kind: 'relay', relayBusinessId: ATLAS.id, deliveryMin: 1985,
  customerPriceCents: 1600, platformContributionCents: 200,
  legs: [
    leg('emp-1', 'eve', ['biz-acme', 'biz-atlas', 'home-001'],
      [stop('biz-acme', 'pickup', 1050), stop('biz-atlas', 'hub_drop', 1090)], 6),
    leg('emp-2', 'morn', ['home-002', 'biz-atlas', 'biz-bakery'],
      [stop('biz-atlas', 'hub_pickup', 1930), stop('biz-bakery', 'delivery', 1985)], 11),
  ],
};

export const view = (
  plan: DeliveryPlan | null, status: ShipmentProgress, over: Partial<ShipmentView> = {}, s: Partial<Shipment> = {},
): ShipmentView => ({
  shipment: shipment(s), plan, jobIds: plan ? plan.legs.map((_, i) => `${plan.id}-L${i}`) : [],
  status, deliveredAtMin: null, unmatchedReason: null, ...over,
});

export const UNMATCHED_REASON = 'No employee commute passes both businesses before the deadline.';
export const unmatchedView = () => view(null, 'unmatched', { unmatchedReason: UNMATCHED_REASON });
