import type { SimulatorResponse } from '../../../../shared/api';
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

/**
 * Routes to highlight for the selected shipment: one node list per plan leg.
 * SimulatorResponse carries no trips, so baselines (trip.baselineNodeIds) are not available and stay empty.
 */
export function selectedRoutes(
  sim: Pick<SimulatorResponse, 'plans'> | null | undefined,
  selectedId: string | undefined | null,
): { legs: string[][]; baselines: string[][] } {
  const empty = { legs: [] as string[][], baselines: [] as string[][] };
  if (!sim || !selectedId) return empty;
  const plan = sim.plans.find((p) => p.shipmentId === selectedId);
  if (!plan) return empty;
  return { legs: plan.legs.map((l) => l.routeNodeIds), baselines: [] };
}
