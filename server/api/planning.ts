import type { Request, Response } from 'express';
import type { CompareResponse, SimulatorResponse } from '../../shared/api';
import type { ApiError } from '../../shared/schemas';
import type { AssignmentResult, Run } from '../../shared/types';
import { assignShipments, compareAssignments, type MatchContext } from '../domain/matching';
import { computeMetrics } from '../domain/metrics';
import { createRouter } from '../domain/routing';
import type { Store } from '../store';
import { materializeAssignment } from './pipeline';
import { buildSimulatorResponse } from './simulator';

const contextFor = (run: Run): MatchContext => ({
  router: createRouter(run.scenario.graph),
  trips: run.trips,
  employees: run.scenario.employees,
  businesses: run.scenario.businesses,
  hubs: run.scenario.hubs,
  settings: run.scenario.settings,
});

/** Full re-match of every shipment, replacing assignments, jobs, events and notifications. */
function recomputeInPlace(run: Run): void {
  const t0 = performance.now();
  const result = assignShipments(run.scenario.shipments, contextFor(run));
  result.computeMs = performance.now() - t0;
  const m = materializeAssignment(run, result);
  run.assignments = m.assignments;
  run.jobs = m.jobs;
  run.events = m.events;
  run.notifications = m.notifications;
}

export const postCompare = (store: Store) => (_req: Request, res: Response<CompareResponse | ApiError>) => {
  try {
    const run = store.get();
    const ctx = contextFor(run);
    const { shipments } = run.scenario;
    const compared = compareAssignments(shipments, ctx);
    const side = (mode: 'direct_only' | 'with_relay', result: AssignmentResult) => {
      // compareAssignments is pure and untimed; re-time this side alone for its computeMs.
      const t0 = performance.now();
      assignShipments(shipments, ctx, { mode });
      const timed: AssignmentResult = { ...result, computeMs: performance.now() - t0 };
      const metrics = computeMetrics({
        shipments, plans: timed.plans, unmatched: timed.unmatched,
        occurredEvents: [], settings: run.scenario.settings,
      });
      return { result: timed, metrics };
    };
    res.json({ directOnly: side('direct_only', compared.directOnly), withRelay: side('with_relay', compared.withRelay) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
};

export const postRecompute =
  (store: Store) => async (_req: Request, res: Response<SimulatorResponse | ApiError>) => {
    if (store.get().clock.phase === 'locked') {
      res.status(409).json({ error: 'Planning is locked. Start a new planning cycle to recompute.' });
      return;
    }
    try {
      const run = await store.mutate((r) => {
        if (r.clock.phase === 'locked') throw new Error('locked');
        recomputeInPlace(r);
      });
      res.json(buildSimulatorResponse(run));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'locked') res.status(409).json({ error: 'Planning is locked.' });
      else res.status(500).json({ error: msg });
    }
  };

export const postPlanningReset =
  (store: Store) => async (_req: Request, res: Response<SimulatorResponse | ApiError>) => {
    try {
      const run = await store.mutate((r) => {
        const n = Number(/^run-(\d+)$/.exec(r.runId)?.[1] ?? 1);
        r.runId = `run-${n + 1}`;
        r.clock = {
          phase: 'planning', playing: false, timeMin: r.scenario.settings.simStartMin, speed: r.clock.speed,
        };
        recomputeInPlace(r);
      });
      res.json(buildSimulatorResponse(run));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  };
