import { useCallback, useEffect, useRef, useState } from 'react';
import type { Employee } from '../../../../shared/types';
import type { MapResponse, SimulatorResponse } from '../../../../shared/api';
import type { SimControlRequest } from '../../../../shared/schemas';
import { getEmployees, getMap, getSimulator, simulatorControl } from '../../api';
import { needsMapFetch } from './simPageModel';

export const POLL_MS = 1000;

export type SimulatorData = {
  sim: SimulatorResponse | null;
  map: MapResponse | null;
  employees: Employee[];
  error: string | null;
  busy: boolean;
  control: (req: SimControlRequest) => Promise<void>;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');

export function useSimulatorData(): SimulatorData {
  const [sim, setSim] = useState<SimulatorResponse | null>(null);
  const [map, setMap] = useState<MapResponse | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const staticRunId = useRef<string | null>(null);

  const accept = useCallback((next: SimulatorResponse) => {
    setSim(next);
    setError(null);
    if (needsMapFetch(staticRunId.current, next.runId)) {
      staticRunId.current = next.runId;
      Promise.all([getMap(), getEmployees()])
        .then(([m, e]) => { setMap(m); setEmployees(e.employees); })
        .catch((e) => { staticRunId.current = null; setError(msg(e)); });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (inFlight.current) return; // no overlapping requests
      inFlight.current = true;
      try {
        const next = await getSimulator();
        if (alive) accept(next);
      } catch (e) {
        if (alive) setError(msg(e));
      } finally {
        inFlight.current = false;
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [accept]);

  const control = useCallback(async (req: SimControlRequest) => {
    setBusy(true);
    try {
      accept(await simulatorControl(req));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }, [accept]);

  return { sim, map, employees, error, busy, control };
}
