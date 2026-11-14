import type { Request, Response } from 'express';
import type { SimulatorResponse } from '../../shared/api';
import { GenerateScenarioRequest, type ApiError } from '../../shared/schemas';
import type { Run, Scenario } from '../../shared/types';
import { generateScenario } from '../domain/generator';
import type { Store } from '../store';
import { createInitialRun, loadDefaultScenario } from './initialRun';
import { buildSimulatorResponse } from './simulator';

/** `run-<n>` -> `run-<n+1>`; anything unparseable counts as n = 0. */
export function nextRunId(current: string): string {
  const n = /^run-(\d+)$/.exec(current)?.[1];
  return `run-${(n ? Number(n) : 0) + 1}`;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Returns a map of missing/invalid required fields of an imported Run (empty = ok). */
function importErrors(body: unknown): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!isObj(body)) return { body: 'Expected a Run object' };
  const scenario = isObj(body.scenario) ? body.scenario : undefined;
  const graph = scenario && isObj(scenario.graph) ? scenario.graph : undefined;
  if (!graph || !Array.isArray(graph.nodes)) errs['scenario.graph.nodes'] = 'Required array';
  for (const k of ['businesses', 'employees', 'shipments']) {
    if (!scenario || !Array.isArray(scenario[k])) errs[`scenario.${k}`] = 'Required array';
  }
  if (!Array.isArray(body.trips)) errs.trips = 'Required array';
  if (!isObj(body.assignments) || !Array.isArray(body.assignments.plans)) errs.assignments = 'Required object with plans';
  if (!isObj(body.clock)) errs.clock = 'Required object';
  return errs;
}

export const postGenerateScenario =
  (store: Store) => async (req: Request, res: Response<SimulatorResponse | ApiError>) => {
    const parsed = GenerateScenarioRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[issue.path.join('.') || 'body'] ??= issue.message;
      res.status(400).json({ error: 'Invalid scenario request', fieldErrors });
      return;
    }
    try {
      const o = parsed.data;
      const scenario: Scenario =
        o.preset === 'demo'
          ? loadDefaultScenario()
          : generateScenario({
              preset: 'random', seed: o.seed, employees: o.employees,
              packages: o.packages, hubs: o.hubs, maxExtraMin: o.maxExtraMin,
            });
      const fresh = createInitialRun(scenario);
      const run = await store.mutate((r) => {
        fresh.runId = nextRunId(r.runId);
        return fresh;
      });
      res.json(buildSimulatorResponse(run));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  };

export const getExportScenario = (store: Store) => (_req: Request, res: Response<Run>) => {
  res.json(store.get());
};

export const postImportScenario =
  (store: Store) => async (req: Request, res: Response<SimulatorResponse | ApiError>) => {
    const fieldErrors = importErrors(req.body);
    if (Object.keys(fieldErrors).length > 0) {
      res.status(400).json({ error: 'Invalid scenario file', fieldErrors });
      return;
    }
    try {
      const imported = structuredClone(req.body as Run);
      const run = await store.mutate((r) => {
        imported.runId = nextRunId(r.runId);
        imported.clock = { ...imported.clock, playing: false };
        return imported;
      });
      res.json(buildSimulatorResponse(run));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  };
