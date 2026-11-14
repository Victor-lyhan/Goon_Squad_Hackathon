// Hand-built BusinessDashboard and hook states for the Business page tests (not a test file itself).
import type { BusinessDashboard } from '../../shared/v2/api';
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

export function ready(d: BusinessDashboard = DASHBOARD, runId = 'run-1'): BusinessWorkspaceState {
  const s = businessWorkspaceReducer(initialBusinessWorkspaceState, { type: 'dashboard', dashboard: d, runId });
  return businessWorkspaceReducer(s, { type: 'directories', businesses: BUSINESSES, employees: EMPLOYEES });
}
