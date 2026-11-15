import type { Run, Scenario } from '../../../shared/v2/types';
import { buildTrips } from '../../domain/v2/trips';
import { matchContext, materializeAssignment, type PipelineDeps } from './pipeline';
import { assignStoryFirst } from './storyFirst';

/**
 * The first run of a scenario: trips for every employee, every shipment matched,
 * clock at the start of the planning phase. No fs: the caller supplies the scenario.
 * A demo scenario with more employees than the story's 60 is matched story first (storyFirst.ts, #966):
 * its 24 plans are those of the 60-employee run, and the added employees carry nothing yet.
 * A `TravelDataMissingError` from the provider propagates unchanged.
 */
export function createInitialRun(scenario: Scenario, deps: PipelineDeps): Run {
  const trips = scenario.employees.flatMap((e) => buildTrips(e, deps.travel));
  const base: Run = {
    runId: 'run-1',
    version: 0,
    scenario,
    trips,
    assignments: { plans: [], unmatched: [], computeMs: 0 },
    jobs: [],
    notifications: [],
    events: [],
    clock: { phase: 'planning', playing: false, timeMin: scenario.settings.simStartMin, speed: 120 },
  };
  const t0 = performance.now();
  const result = assignStoryFirst(scenario.shipments, matchContext(base, deps.travel), scenario);
  result.computeMs = performance.now() - t0;
  return { ...base, ...materializeAssignment(base, result, deps) };
}
