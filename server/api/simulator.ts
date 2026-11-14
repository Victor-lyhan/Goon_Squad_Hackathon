import type { Request, Response } from 'express';
import type { SimulatorResponse } from '../../shared/api';
import { SimControlRequest, type ApiError } from '../../shared/schemas';
import type { Run } from '../../shared/types';
import { applyControl } from '../clock';
import { snapshotAt } from '../domain/simulation';
import type { Store } from '../store';

export function buildSimulatorResponse(run: Run): SimulatorResponse {
  let nextEventMin: number | null = null;
  for (const e of run.events) {
    if (e.timeMin > run.clock.timeMin && (nextEventMin === null || e.timeMin < nextEventMin)) nextEventMin = e.timeMin;
  }
  return {
    runId: run.runId,
    version: run.version,
    clock: run.clock,
    snapshot: snapshotAt(run, run.clock.timeMin),
    plans: run.assignments.plans,
    jobs: run.jobs,
    shipments: run.scenario.shipments,
    unmatched: run.assignments.unmatched,
    computeMs: run.assignments.computeMs,
    nextEventMin,
  };
}

export const getSimulator = (store: Store) => (_req: Request, res: Response<SimulatorResponse>) => {
  res.json(buildSimulatorResponse(store.get()));
};

export const postSimulatorControl =
  (store: Store) => async (req: Request, res: Response<SimulatorResponse | ApiError>) => {
    const parsed = SimControlRequest.safeParse(req.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join('.') || 'body'] ??= issue.message;
      }
      res.status(400).json({ error: 'Invalid simulator control', fieldErrors });
      return;
    }
    if (parsed.data.action === 'seek') {
      const { simStartMin, simEndMin } = store.get().scenario.settings;
      if (parsed.data.timeMin < simStartMin || parsed.data.timeMin > simEndMin) {
        res.status(400).json({
          error: 'Invalid simulator control',
          fieldErrors: { timeMin: `Must be between ${simStartMin} and ${simEndMin}` },
        });
        return;
      }
    }
    try {
      const run = await store.mutate((r) => {
        r.clock = applyControl(r.clock, parsed.data, r.events, r.scenario.settings);
      });
      res.json(buildSimulatorResponse(run));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  };
