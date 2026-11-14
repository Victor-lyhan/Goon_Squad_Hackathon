import type {
  LatLng,
  MarkerPosition,
  Run,
  Snapshot,
  TravelProvider,
} from '../../../shared/v2/types.js';
import { computeMetrics } from './metrics.js';
import { progressAt } from './timeline.js';

/**
 * Geometry is injected so snapshot assembly stays independent of route-line
 * implementation and can be tested without depending on the geometry module.
 */
export type Movement = {
  markersAt(run: Run, timeMin: number, travel: Pick<TravelProvider, 'polyline'>): MarkerPosition[];
  packagePositionsAt(run: Run, timeMin: number, markers: MarkerPosition[]): Record<string, LatLng>;
};

/** Creates the pure snapshot reader around a supplied movement implementation. */
export function createSnapshotAt(movement: Movement) {
  return function snapshotAt(
    run: Run,
    timeMin: number,
    travel: Pick<TravelProvider, 'polyline'>,
  ): Snapshot {
    const progress = progressAt({
      shipments: run.scenario.shipments,
      plans: run.assignments.plans,
      jobs: run.jobs,
      events: run.events,
    }, timeMin);
    const markers = movement.markersAt(run, timeMin, travel);

    return {
      runId: run.runId,
      version: run.version,
      timeMin,
      ...progress,
      metrics: computeMetrics({
        shipments: run.scenario.shipments,
        plans: run.assignments.plans,
        unmatched: run.assignments.unmatched,
        occurredEvents: progress.occurredEvents,
        settings: run.scenario.settings,
      }),
      markers,
      packagePositions: movement.packagePositionsAt(run, timeMin, markers),
    };
  };
}

/** Returns the earliest stored event strictly after the requested simulation minute. */
export function nextEventMin(run: Run, timeMin: number): number | null {
  let next: number | null = null;
  for (const event of run.events) {
    if (event.timeMin > timeMin && (next === null || event.timeMin < next)) next = event.timeMin;
  }
  return next;
}
