// Hand-built notifications for the Business activity tests (not a test file itself).
import type { BusinessDashboard } from '../../shared/v2/api';
import type { Notification } from '../../shared/v2/types';
import { DASHBOARD, ME } from './business-v2-table-sample';

export const note = (id: string, createdSeq: number, over: Partial<Notification> = {}): Notification => ({
  id, audience: 'business', audienceId: ME.id, kind: 'delivery_matched',
  shipmentId: 'shp-1', planId: 'plan-shp-1', message: `Message ${id}.`, createdSeq, ...over,
});

// shp-1 is sent by ME, shp-4 is received by ME, shp-9 is a relay package (in neither list).
export const SENDER = note('ntf-plan-shp-1-biz-acme', 1, { message: 'Delivery arranged: "Contracts" to Bakery Row, $12.50.' });
export const RECIPIENT = note('ntf-plan-shp-4-biz-acme', 2, {
  shipmentId: 'shp-4', planId: 'plan-shp-4', message: 'Incoming delivery: "Invoices" from Corner Cafe.',
});
export const RELAY = note('ntf-plan-shp-9-biz-acme', 3, {
  shipmentId: 'shp-9', planId: 'plan-shp-9',
  message: 'Overnight drop: "Prints" from Print Shop to Bakery Row via Acme Studio (relay point).',
});

export const withNotes = (notifications: Notification[], over: Partial<BusinessDashboard> = {}): BusinessDashboard =>
  ({ ...DASHBOARD, notifications, ...over });

export const many = (n: number): Notification[] =>
  Array.from({ length: n }, (_, i) => note(`ntf-${String(i + 1).padStart(3, '0')}`, i + 1));
