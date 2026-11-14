import { useCallback, useEffect, useRef, useState } from 'react';
import type { Employee } from '../../../../shared/types';
import type { MapResponse, SimulatorResponse } from '../../../../shared/api';
import type { SimControlRequest } from '../../../../shared/schemas';
import { isAbortError, isNetworkError, getEmployees, getMap, getSimulator, simulatorControl } from '../../api';
import { mapForRun, needsMapFetch } from './simPageModel';

export const POLL_MS = 1000;

export type SimulatorData = {
  sim: SimulatorResponse | null;
  map: MapResponse | null;
  employees: Employee[];
  error: string | null;
  /** True when the last failure was a lost connection or timeout (not an HTTP error). */
  networkError: boolean;
  busy: boolean;
  control: (req: SimControlRequest) => Promise<void>;
  /** Polls now (used after Generate/Import/reset so the new runId shows without waiting for the next tick). */
  refresh: () => Promise<void>;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');

export function useSimulatorData(): SimulatorData {
  const [sim, setSim] = useState<SimulatorResponse | null>(null);
  const [mapState, setMapState] = useState<{ runId: string; map: MapResponse } | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const staticRunId = useRef<string | null>(null);
  const mounted = useRef(true);
  const mapAbort = useRef<AbortController | null>(null);
  const pollAbort = useRef<AbortController | null>(null);

  /** Records a failed request; aborts are silent. */
  const fail = useCallback((e: unknown) => {
    if (isAbortError(e) || !mounted.current) return;
    setNetworkError(isNetworkError(e));
    setError(msg(e));
  }, []);

  const accept = useCallback((next: SimulatorResponse) => {
    if (!mounted.current) return;
    setSim(next);
    setError(null);
    setNetworkError(false);
    if (needsMapFetch(staticRunId.current, next.runId)) {
      staticRunId.current = next.runId;
      const runId = next.runId;
      mapAbort.current?.abort(); // an older run's fetch is cancelled, not just ignored
      const ctl = new AbortController();
      mapAbort.current = ctl;
      Promise.all([getMap({ signal: ctl.signal }), getEmployees({ signal: ctl.signal })])
        .then(([m, e]) => {
          if (!mounted.current || ctl.signal.aborted || staticRunId.current !== runId) return; // a newer run superseded this fetch
          setMapState({ runId, map: m });
          setEmployees(e.employees);
        })
        .catch((e) => {
          if (isAbortError(e) || ctl.signal.aborted) return;
          if (staticRunId.current === runId) { staticRunId.current = null; fail(e); }
        });
    }
  }, [fail]);

  useEffect(() => {
    mounted.current = true;
    const tick = async () => {
      if (inFlight.current) return; // no overlapping requests
      inFlight.current = true;
      const ctl = new AbortController();
      pollAbort.current = ctl;
      try {
        const next = await getSimulator({ signal: ctl.signal });
        if (!ctl.signal.aborted) accept(next);
      } catch (e) {
        fail(e);
      } finally {
        inFlight.current = false;
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
      pollAbort.current?.abort();
      mapAbort.current?.abort();
    };
  }, [accept, fail]);

  const control = useCallback(async (req: SimControlRequest) => {
    setBusy(true);
    try {
      accept(await simulatorControl(req));
    } catch (e) {
      fail(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [accept, fail]);

  const refresh = useCallback(async () => {
    try {
      accept(await getSimulator());
    } catch (e) {
      fail(e);
    }
  }, [accept, fail]);

  const map = mapForRun(mapState?.map ?? null, mapState?.runId ?? null, sim?.runId);
  return { sim, map, employees, error, networkError, busy, control, refresh };
}
