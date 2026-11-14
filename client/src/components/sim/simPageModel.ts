import type { Shipment } from '../../../../shared/types';

/** The static map is fetched once per runId. */
export function needsMapFetch(prevRunId: string | null | undefined, nextRunId: string): boolean {
  return prevRunId !== nextRunId;
}

/** Drops a selection that no longer exists in the current shipments. */
export function resolveSelection(selectedId: string | undefined | null, shipments: Pick<Shipment, 'id'>[]): string | undefined {
  if (!selectedId) return undefined;
  return shipments.some((s) => s.id === selectedId) ? selectedId : undefined;
}
