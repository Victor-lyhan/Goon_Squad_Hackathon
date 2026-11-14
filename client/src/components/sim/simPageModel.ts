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

export const PACKAGE_PARAM = 'package';

/** Resolves the `?package=` deep link against the loaded run. Nothing is resolved until the run has loaded. */
export function resolveDeepLink(
  param: string | null | undefined,
  shipments: Pick<Shipment, 'id'>[] | null | undefined,
): { selectedId: string | undefined; notFound: boolean } {
  if (!param || !shipments) return { selectedId: undefined, notFound: false };
  const selectedId = resolveSelection(param, shipments);
  return { selectedId, notFound: selectedId === undefined };
}

/** Returns new search params with `package` set (or removed when id is empty). Other params are kept. */
export function withPackageParam(params: URLSearchParams, id: string | null | undefined): URLSearchParams {
  const next = new URLSearchParams(params);
  if (id) next.set(PACKAGE_PARAM, id); else next.delete(PACKAGE_PARAM);
  return next;
}

/**
 * What to do when a poll reports a runId. The first run seen (prev null) only fetches the map;
 * a later change refetches the map once and clears a selection that no longer exists.
 */
export function handleRunIdChange(
  prevRunId: string | null | undefined,
  nextRunId: string,
  selectedId: string | null | undefined,
  shipments: Pick<Shipment, 'id'>[],
): { refetchMap: boolean; clearSelection: boolean } {
  const refetchMap = needsMapFetch(prevRunId, nextRunId);
  const changed = refetchMap && !!prevRunId;
  return { refetchMap, clearSelection: changed && !!selectedId && resolveSelection(selectedId, shipments) === undefined };
}
