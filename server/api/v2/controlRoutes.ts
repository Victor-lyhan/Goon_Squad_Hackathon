// Route group: the simulator clock control (DECISIONS pass 48). Paths are relative to /api/v2.
// The v2 bootstrap registers it in createV2Router and passes the real snapshot function.
import type express from 'express';
import type { SimulatorResponse } from '../../../shared/v2/api';
import type { ApiError } from '../../../shared/v2/schemas';
import type { Run, Snapshot } from '../../../shared/v2/types';
import type { Store } from '../../store';
import { controlError, planControl, type ControlPlan } from './controlOps';
import { simulatorResponse } from './views';

export type ControlRouteDeps = {
  store: Store<Run>;
  snapshotAt: (run: Run, timeMin: number) => Snapshot;
};

// Thrown inside store.mutate to leave the run untouched (no version bump, no file write) for a bad request.
class ControlRefused extends Error {
  constructor(readonly plan: Extract<ControlPlan, { kind: 'invalid' }>) {
    super(plan.error);
  }
}

export function registerControlRoutes(router: express.Router, { store, snapshotAt }: ControlRouteDeps): void {
  router.post('/simulator/control', async (req, res: express.Response<SimulatorResponse | ApiError>) => {
    let run: Run;
    try {
      // Planned on the store's newest run, inside the mutation queue, so a control never undoes a tick
      // (or another control) that was queued before it.
      run = await store.mutate((draft) => {
        const plan = planControl(draft, req.body);
        if (plan.kind === 'invalid') throw new ControlRefused(plan);
        draft.clock = plan.clock;
      });
    } catch (e) {
      if (!(e instanceof ControlRefused)) throw e;
      res.status(e.plan.status).json(controlError(e.plan));
      return;
    }
    res.json(simulatorResponse(run, snapshotAt(run, run.clock.timeMin)));
  });
}
