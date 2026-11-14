// Hand-built MVP II BusinessDashboard for the shipments table tests (not a test file itself).
import type { BusinessDashboard, ShipmentView } from '../../shared/v2/api';
import type { DeliveryPlan, NetworkBusiness, Shipment, ShipmentProgress } from '../../shared/v2/types';

const biz = (id: string, name: string): NetworkBusiness => ({
  id, name, address: '1 Test St', neighborhood: 'Midtown', borough: 'Manhattan', kind: 'office', lat: 40.75, lng: -73.98,
});

export const ME = biz('biz-acme', 'Acme Studio');
export const BUSINESSES: NetworkBusiness[] = [
  ME,
  biz('biz-bakery', 'Bakery Row'),
  biz('biz-print', 'Print Shop'),
  biz('biz-cafe', 'Corner Cafe'),
  biz('biz-relay', 'Atlas Books'),
];

export const shipment = (id: string, over: Partial<Shipment>): Shipment => ({
  id, clientRequestId: `req-${id}`, label: `Package ${id}`,
  originBusinessId: ME.id, destinationBusinessId: 'biz-bakery',
  readyMin: 1020, deadlineMin: 2040,
  category: 'small_box', description: '', weightGrams: 500,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
  ...over,
});

export const plan = (shipmentId: string, over: Partial<DeliveryPlan>): DeliveryPlan => ({
  id: `plan-${shipmentId}`, shipmentId, kind: 'direct', legs: [], deliveryMin: 1100,
  customerPriceCents: 1200, platformContributionCents: 0,
  ...over,
});

export const view = (
  s: Shipment, p: DeliveryPlan | null, status: ShipmentProgress,
  extra: Partial<ShipmentView> = {},
): ShipmentView => ({
  shipment: s, plan: p, jobIds: [], status, deliveredAtMin: null, unmatchedReason: null, ...extra,
});

// Outgoing direct (delivered), outgoing relay (at the relay point), unmatched outgoing, incoming direct.
export const directOut = view(
  shipment('shp-1', { label: 'Contracts', destinationBusinessId: 'biz-bakery', deadlineMin: 1500, createdSeq: 1 }),
  plan('shp-1', { kind: 'direct', deliveryMin: 1090, customerPriceCents: 1250 }),
  'delivered', { deliveredAtMin: 1085 },
);
export const relayOut = view(
  shipment('shp-2', { label: 'Sample boxes', destinationBusinessId: 'biz-print', deadlineMin: 2100, createdSeq: 2 }),
  plan('shp-2', { kind: 'relay', relayBusinessId: 'biz-relay', deliveryMin: 1980, customerPriceCents: 1800 }),
  'at_hub',
);
export const unmatchedOut = view(
  shipment('shp-3', { label: 'Keys', destinationBusinessId: 'biz-cafe', deadlineMin: 1500, createdSeq: 3 }),
  null, 'unmatched', { unmatchedReason: 'No commute passes both businesses before the deadline.' },
);
export const incomingIn = view(
  shipment('shp-4', { label: 'Invoices', originBusinessId: 'biz-cafe', destinationBusinessId: ME.id, deadlineMin: 2040, createdSeq: 4 }),
  plan('shp-4', { kind: 'direct', deliveryMin: 1130, customerPriceCents: 900 }),
  'scheduled',
);

export const DASHBOARD: BusinessDashboard = {
  business: ME,
  outgoing: [directOut, relayOut, unmatchedOut],
  incoming: [incomingIn],
  notifications: [],
  totals: { sent: 3, matched: 2, delivered: 1, spendCents: 3050 },
  phase: 'planning',
  version: 7,
};

export const EMPTY_DASHBOARD: BusinessDashboard = { ...DASHBOARD, outgoing: [], incoming: [] };
