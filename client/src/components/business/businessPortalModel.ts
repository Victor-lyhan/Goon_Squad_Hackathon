import type { PatchShipmentRequest, CreateShipmentRequest } from '../../../../shared/schemas';
import type { Notification } from '../../../../shared/types';

/** Newest first (highest createdSeq). Does not mutate the input. */
export function newestFirst(list: Notification[]): Notification[] {
  return [...list].sort((a, b) => b.createdSeq - a.createdSeq || (a.id < b.id ? 1 : -1));
}

/**
 * Which `delivery_matched` notifications appeared since the previous poll.
 * `seenIds` null = first poll (nothing counts as new, so a page load never toasts old items).
 */
export function newMatchedNotifications(seenIds: ReadonlySet<string> | null, current: Notification[]): Notification[] {
  if (seenIds === null) return [];
  return newestFirst(current.filter((n) => n.kind === 'delivery_matched' && !seenIds.has(n.id)));
}

/** PATCH body for Edit request: everything except the create-only fields. */
export function patchFromRequest(req: CreateShipmentRequest): PatchShipmentRequest {
  const { clientRequestId: _c, originBusinessId: _o, ...rest } = req;
  return rest;
}

export const NAV_ITEMS = [
  { key: 'overview', label: 'Overview' },
  { key: 'send', label: 'Send a package' },
  { key: 'outgoing', label: 'Outgoing' },
  { key: 'incoming', label: 'Incoming' },
] as const;
export type NavKey = (typeof NAV_ITEMS)[number]['key'];

/** Poll interval for the dashboard (ms). */
export const POLL_MS = 1000;

/**
 * Spec §3A doesn't fix a list order, so we pick one: newest first (highest `createdSeq`),
 * ties broken by shipment id so the order is stable across polls. Does not mutate the input.
 */
export function sortShipmentViews<T extends { shipment: { id: string; createdSeq: number } }>(views: T[]): T[] {
  return [...views].sort((a, b) => b.shipment.createdSeq - a.shipment.createdSeq || (a.shipment.id < b.shipment.id ? -1 : 1));
}

/** "Direct" or "Relay via <hub name>" (hub falls back to a generic word, never a raw id). */
export function modeText(plan: { kind: 'direct' | 'relay'; hubId?: string } | null, hubs: { id: string; name: string }[]): string {
  if (!plan) return '';
  if (plan.kind === 'direct') return 'Direct';
  const hub = hubs.find((h) => h.id === plan.hubId)?.name;
  return hub ? `Relay via ${hub}` : 'Relay via a hub';
}

/** Count line that always matches the rows shown, e.g. "3 packages". */
export function countText(n: number): string {
  return `${n} ${n === 1 ? 'package' : 'packages'}`;
}
