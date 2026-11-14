import type { Request, Response } from 'express';
import type { MapResponse } from '../../shared/api';
import type { Store } from '../store';

export const getMap = (store: Store) => (_req: Request, res: Response<MapResponse>) => {
  const run = store.get();
  const { graph, businesses, hubs, employees } = run.scenario;
  res.json({
    runId: run.runId,
    graph,
    businesses,
    hubs,
    homes: employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
  });
};
