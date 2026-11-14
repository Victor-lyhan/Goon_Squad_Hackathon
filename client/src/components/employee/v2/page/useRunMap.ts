// React wrapper around the run-map loader (#463): one loader per employee, synced with the page's
// run ID on every render. Switching employee or unmounting aborts the pending request.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { getMap } from '../../../../api/v2';
import {
  createRunMapLoader, initialRunMapState, runMapReducer, type GetMap, type RunMapLoader, type RunMapState,
} from './runMapModel';

export type RunMap = RunMapState & { refresh: () => void; retry: () => void };

export function useRunMap(employeeId: string, runId: string | null, fetchMap: GetMap = getMap): RunMap {
  const [state, dispatch] = useReducer(runMapReducer, initialRunMapState);
  const loader = useRef<RunMapLoader | null>(null);
  const runRef = useRef(runId);
  runRef.current = runId;

  useEffect(() => {
    dispatch({ type: 'reset' });
    const l = createRunMapLoader(fetchMap, dispatch);
    loader.current = l;
    l.sync(runRef.current);
    return () => { l.stop(); if (loader.current === l) loader.current = null; };
  }, [employeeId, fetchMap]);

  useEffect(() => { loader.current?.sync(runId); }, [runId]);

  const refresh = useCallback(() => loader.current?.refresh(), []);
  const retry = useCallback(() => loader.current?.retry(), []);
  return { ...state, refresh, retry };
}
