// Hand-built BusinessDashboard and hook states for the Business page tests (not a test file itself).
import type { BusinessDashboard, ShipmentView } from '../../shared/v2/api';
import type { Notification } from '../../shared/v2/types';
import {
  businessWorkspaceReducer, initialBusinessWorkspaceState, type BusinessWorkspaceState,
} from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { ACME, ATLAS, BAKERY, BUSINESSES, EMPLOYEES, UNMATCHED_REASON, directPlan, relayPlan, view } from './business-v2-details-sample';

export { ACME, ATLAS, BAKERY, BUSINESSES, EMPLOYEES, UNMATCHED_REASON };

export const DIRECT = view(directPlan, 'scheduled', {}, { id: 'shp-7', label: 'Sample boxes' });
export const RELAY = view({ ...relayPlan, id: 'plan-shp-8', shipmentId: 'shp-8' }, 'at_hub', {}, {
  id: 'shp-8', clientRequestId: 'req-8', label: 'Fabric rolls', destinationBusinessId: BAKERY.id, createdSeq: 2,
});
export const UNMATCHED = view(null, 'unmatched', { unmatchedReason: UNMATCHED_REASON }, {
  id: 'shp-9', clientRequestId: 'req-9', label: 'Spare keys', createdSeq: 3,
});
export const INCOMING = view(
  { ...directPlan, id: 'plan-shp-10', shipmentId: 'shp-10', customerPriceCents: 900 }, 'picked_up', {},
  { id: 'shp-10', clientRequestId: 'req-10', label: 'Invoices', originBusinessId: BAKERY.id, destinationBusinessId: ACME.id, createdSeq: 4 },
);

export const DASHBOARD: BusinessDashboard = {
  business: ACME,
  outgoing: [DIRECT, RELAY, UNMATCHED],
  incoming: [INCOMING],
  notifications: [{
    id: 'ntf-plan-shp-7-biz-acme', audience: 'business', audienceId: ACME.id, kind: 'delivery_matched',
    shipmentId: 'shp-7', planId: 'plan-shp-7', message: 'Delivery arranged: "Sample boxes" to Bakery Row, $12.50.', createdSeq: 1,
  }],
  totals: { sent: 3, matched: 2, delivered: 0, spendCents: 2850 },
  phase: 'planning',
  version: 7,
};

// ---------- A relay-only business (#581) ----------
// Atlas Books neither sends nor receives shp-8; it holds it overnight (RELAY.plan.relayBusinessId). Its
// dashboard lists no delivery, only the server's relay notification (server/api/v2/pipeline.ts).
export const HELD_NOTE: Notification = {
  id: 'ntf-plan-shp-8-biz-atlas', audience: 'business', audienceId: ATLAS.id, kind: 'delivery_matched',
  shipmentId: 'shp-8', planId: 'plan-shp-8', createdSeq: 5,
  message: 'Relay point: "Fabric rolls" from Acme Studio to Bakery Row is dropped here in the evening and collected the next morning.',
};
export const ATLAS_DASHBOARD: BusinessDashboard = {
  business: ATLAS, outgoing: [], incoming: [], notifications: [HELD_NOTE],
  totals: { sent: 0, matched: 0, delivered: 0, spendCents: 0 }, phase: 'planning', version: 7,
};

/** The state after GET /shipments/:id answered for the open delivery: its view, or null for a 404. */
export function withHeld(s: BusinessWorkspaceState, shipmentId: string, v: ShipmentView | null): BusinessWorkspaceState {
  return businessWorkspaceReducer(s, v ? { type: 'held', shipmentId, view: v } : { type: 'heldMissing', shipmentId });
}

export function ready(d: BusinessDashboard = DASHBOARD, runId = 'run-1'): BusinessWorkspaceState {
  const s = businessWorkspaceReducer(initialBusinessWorkspaceState, { type: 'dashboard', dashboard: d, runId });
  return businessWorkspaceReducer(s, { type: 'directories', businesses: BUSINESSES, employees: EMPLOYEES });
}
