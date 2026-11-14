// The one hook that owns the MVP II simulator page's server traffic (#380): the 1 s poll, the map
// refetch, the control actions and the read-only comparison. Pages render its state; they never fetch on their own.
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { CompareResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import { compareMatches, getMap, getSimulator, isAbortError, simulatorControl } from '../../../../api/v2';
import { INITIAL_SIM_DATA, errorMessage, simDataReducer, type SimDataAction, type SimDataState } from './simDataModel';
import { createSimPoller, type SimPollerApi } from './simPoller';

export type SimActionsApi = {
  simulatorControl: (req: SimControlRequest) => Promise<SimulatorResponse>;
  compareMatches: () => Promise<CompareResponse>;
};

export type SimulatorV2Api = SimPollerApi & SimActionsApi;

/** Each write resolves to the applied response, or null when it failed (the message is in `actionError`). */
export type SimActions = {
  control: (req: SimControlRequest) => Promise<SimulatorResponse | null>;
  /** Read-only what-if; nothing is applied. */
  compare: () => Promise<CompareResponse | null>;
};

export type SimulatorV2 = SimDataState & SimActions & {
  /** Polls now (the Retry button of the unavailable and error states). */
  refetch: () => void;
  dismissActionError: () => void;
};

export const SIMULATOR_V2_API: SimulatorV2Api = {
  getSimulator: (opts) => getSimulator(opts),
  getMap: (opts) => getMap(opts),
  simulatorControl: (req) => simulatorControl(req),
  compareMatches: () => compareMatches(),
};

/**
 * The actions without React. `busy` is true while any action other than a `seek` is open. A write
 * applies its SimulatorResponse at once, then calls `afterWrite` (the poller's refetchNow, which drops a
 * poll that may predate the write and fetches the map if the plans changed). Errors go to `actionError`.
 *
 * A `seek` (Play journey every 500 ms, a journey step) is quiet (#594, DECISIONS pass 61):
 * it never sets `busy`, so the playback buttons stay as they are. Its answer is
 * applied only when no write sent after it has already been applied, so a slow answer never steps the
 * clock back. A dropped answer still resolves to the response (the server accepted the seek); only a
 * failure resolves to null and sets `actionError`.
 */
export function createSimActions(
  api: SimActionsApi, dispatch: (a: SimDataAction) => void, afterWrite: () => void,
): SimActions & { dispose: () => void } {
  let open = 0;
  let disposed = false;
  /** Order of the writes: each gets the next number when sent; `applied` is the newest one applied. */
  let sent = 0;
  let applied = 0;

  async function run<T>(call: () => Promise<T>, apply: ((r: T) => void) | null, quiet = false): Promise<T | null> {
    if (disposed) return null;
    if (!quiet && open++ === 0) dispatch({ type: 'busy', busy: true });
    try {
      const res = await call();
      if (!disposed && apply) apply(res);
      return res;
    } catch (e) {
      if (!disposed && !isAbortError(e)) dispatch({ type: 'actionFailed', message: errorMessage(e) });
      return null;
    } finally {
      if (!quiet && --open === 0 && !disposed) dispatch({ type: 'busy', busy: false });
    }
  }

  const write = (call: () => Promise<SimulatorResponse>, quiet = false) => {
    const seq = ++sent;
    return run(call, (sim) => {
      // Only a seek waits its turn; every other write applies as it always did.
      if (quiet && seq < applied) return;
      applied = Math.max(applied, seq);
      dispatch({ type: 'sim', sim });
      afterWrite();
    }, quiet);
  };

  return {
    control: (req) => write(() => api.simulatorControl(req), req.action === 'seek'),
    compare: () => run(() => api.compareMatches(), null),
    dispose: () => { disposed = true; },
  };
}

export function useSimulatorV2(api: SimulatorV2Api = SIMULATOR_V2_API): SimulatorV2 {
  const [state, dispatch] = useReducer(simDataReducer, INITIAL_SIM_DATA);
  const live = useRef<{ actions: SimActions; refetch: () => void } | null>(null);

  useEffect(() => {
    const poller = createSimPoller(api, dispatch);
    const actions = createSimActions(api, dispatch, () => void poller.refetchNow());
    const entry = { actions, refetch: () => void poller.refetchNow() };
    live.current = entry;
    poller.start();
    return () => {
      poller.stop();
      actions.dispose();
      if (live.current === entry) live.current = null;
    };
  }, [api]);

  const control = useCallback((req: SimControlRequest) => live.current?.actions.control(req) ?? Promise.resolve(null), []);
  const compare = useCallback(() => live.current?.actions.compare() ?? Promise.resolve(null), []);
  const refetch = useCallback(() => live.current?.refetch(), []);
  const dismissActionError = useCallback(() => dispatch({ type: 'dismissActionError' }), []);

  // Same object while the state is unchanged, so an equal poll re-renders nothing downstream.
  return useMemo(
    () => ({ ...state, control, compare, refetch, dismissActionError }),
    [state, control, compare, refetch, dismissActionError],
  );
}
