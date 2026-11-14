// Hand-built SimulatorResponse + MapResponse for the package list tests (#418):
// one direct plan, one relay plan, one unmatched shipment, and one direct plan whose recipient
// does not resolve to a business on the map. Shipments are listed out of createdSeq order on purpose.
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Leg, Shipment, ShipmentProgress, Stop } from '../../shared/v2/types';

const D2 = 1440;

export const BIZ = {
  studio: 'biz-dumbo-studio', agency: 'biz-midtown-agency', cafe: 'biz-dumbo-cafe',
  bakery: 'biz-lic-bakery', office: 'biz-chelsea-office', gone: 'biz-closed-shop',
} as const;

const stop = (placeId: string, kind: Stop['kind'], t: number): Stop =>
  ({ placeId, kind, arrivalMin: t - 1, serviceStartMin: t, serviceEndMin: t + 2 });

const shipment = (n: number, label: string, from: string, to: string): Shipment => ({
  id: `shp-${n}`, clientRequestId: `req-${n}`, label,
  originBusinessId: from, destinationBusinessId: to,
  readyMin: 990, deadlineMin: D2 + 600, category: 'small_box', description: '', weightGrams: 800,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: n,
});

export const SHIPMENTS: Shipment[] = [
  shipment(3, 'Signed lease', BIZ.office, BIZ.studio),
  shipment(1, 'Brand proofs', BIZ.studio, BIZ.agency),
  shipment(4, 'Spare keys', BIZ.agency, BIZ.gone),
  shipment(2, 'Gift box', BIZ.bakery, BIZ.office),
];

const leg = (employeeId: string, placeIds: string[], stops: Stop[]): Leg => ({
  tripId: `${employeeId}-eve`, employeeId, placeIds, stops,
  finishMin: stops[1].serviceEndMin + 20, extraMin: 5, extraDistanceM: 1000, rewardCents: 400,
});

export const PLANS: DeliveryPlan[] = [
  { id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'direct', deliveryMin: 1080,
    legs: [leg('emp-1', [BIZ.studio, BIZ.agency, 'home-001'], [stop(BIZ.studio, 'pickup', 1050), stop(BIZ.agency, 'delivery', 1078)])],
    customerPriceCents: 900, platformContributionCents: 0 },
  { id: 'plan-shp-2', shipmentId: 'shp-2', kind: 'relay', relayBusinessId: BIZ.cafe, deliveryMin: D2 + 492,
    legs: [
      leg('emp-2', [BIZ.bakery, BIZ.cafe, 'home-002'], [stop(BIZ.bakery, 'pickup', 1060), stop(BIZ.cafe, 'hub_drop', 1085)]),
      leg('emp-3', ['home-003', BIZ.cafe, BIZ.office], [stop(BIZ.cafe, 'hub_pickup', D2 + 460), stop(BIZ.office, 'delivery', D2 + 490)]),
    ],
    customerPriceCents: 1200, platformContributionCents: 100 },
  { id: 'plan-shp-4', shipmentId: 'shp-4', kind: 'direct', deliveryMin: 1100,
    legs: [leg('emp-4', [BIZ.agency, BIZ.gone, 'home-004'], [stop(BIZ.agency, 'pickup', 1070), stop(BIZ.gone, 'delivery', 1098)])],
    customerPriceCents: 900, platformContributionCents: 0 },
];

export const UNMATCHED_REASON = 'No commute passes both businesses before the deadline.';

export const STATUS_EVENING: Record<string, ShipmentProgress> = {
  'shp-1': 'picked_up', 'shp-2': 'at_hub', 'shp-3': 'unmatched', 'shp-4': 'picked_up',
};
export const STATUS_MORNING: Record<string, ShipmentProgress> = {
  'shp-1': 'delivered', 'shp-2': 'out_for_delivery', 'shp-3': 'unmatched', 'shp-4': 'delivered',
};

export function makeSim(status: Record<string, ShipmentProgress> = STATUS_EVENING, version = 7): SimulatorResponse {
  const timeMin = status === STATUS_MORNING ? D2 + 470 : 1200;
  return {
    runId: 'run-1', version,
    clock: { phase: 'locked', playing: true, timeMin, speed: 120 },
    snapshot: {
      runId: 'run-1', version, timeMin,
      shipmentStatus: { ...status },
      deliveredAtMin: {}, jobStatus: {}, earningsCents: {},
      markers: [], packagePositions: {}, occurredEvents: [],
      metrics: {
        requested: 4, matched: 3, delivered: 0, direct: 2, relay: 1, unmatched: 1,
        avgExtraMinPerTrip: 5, maxExtraMin: 5, earnedRewardsCents: 0,
        projectedCustomerSavingsCents: 0, projectedCustomerSpendCents: 0,
        projectedPlatformContributionCents: 0, earnedPlatformContributionCents: 0, extraDistanceM: 4000,
      },
    },
    plans: PLANS, jobs: [], shipments: SHIPMENTS,
    unmatched: [{ shipmentId: 'shp-3', reason: UNMATCHED_REASON }],
    computeMs: 3, nextEventMin: null,
  };
}

const biz = (id: string, name: string) => ({
  id, name, address: '1 Main St, New York, NY', neighborhood: 'DUMBO', borough: 'Brooklyn' as const,
  kind: 'office' as const, lat: 40.7, lng: -73.99,
});

/** Note: BIZ.gone is deliberately missing, so shp-4's recipient does not resolve. */
export function makeMap(): MapResponse {
  return {
    runId: 'run-1',
    businesses: [
      biz(BIZ.studio, 'Dumbo Design Studio'),
      biz(BIZ.agency, 'Midtown Ad Agency'),
      biz(BIZ.cafe, 'Front Street Café'),
      biz(BIZ.bakery, 'Vernon Bakery'),
      biz(BIZ.office, 'Chelsea Office'),
    ],
    homes: [], employees: [], polylines: [],
  };
}
