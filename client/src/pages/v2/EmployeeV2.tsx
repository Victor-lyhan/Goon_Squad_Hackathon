// MVP II Employee workspace page (#438). Mounted at /nyc/employee/:id during the preview and at
// /employee/:id after the cutover: it only ever changes the query string (`?job=`), never the path.
// The NYC map is fetched once per run and again after a commute save (#463, DECISIONS pass 48), and
// within a run when the set of jobs changes or the open job's leg still has no route line (#596).
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import type { PutCommuteRequest } from '../../../../shared/v2/schemas';
import { geocode } from '../../api/v2';
import { useEmployeeWorkspace } from '../../components/employee/v2/live/useEmployeeWorkspace';
import { EmployeePageView } from '../../components/employee/v2/page/EmployeePageView';
import { pageScreen, searchFromGeocode, siblingEmployeePath } from '../../components/employee/v2/page/employeePageModel';
import { RouteSlot } from '../../components/employee/v2/page/RouteSlot';
import { runMapSlot } from '../../components/employee/v2/page/runMapModel';
import { useRunMap } from '../../components/employee/v2/page/useRunMap';
import {
  MAP_LINE_RETRY_MS, jobSetChanged, lineRetryDelayMs, lineRetryDue, mapJobsKey, type MapJobsKey,
} from '../../components/employee/v2/route/mapRefreshModel';

const search = searchFromGeocode(geocode);

export default function EmployeeV2() {
  const { id = '' } = useParams();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job') || null;
  const ws = useEmployeeWorkspace(id, jobId);
  const runId = ws.baseline?.runId ?? null;
  const runMap = useRunMap(id, runId);
  const { saveCommute: wsSave } = ws;
  const { refresh: refreshMap } = runMap;

  const onCloseJob = useCallback(() => {
    setParams((p) => { const next = new URLSearchParams(p); next.delete('job'); return next; });
  }, [setParams]);
  const employeeHref = useCallback((other: string) => siblingEmployeePath(pathname, other), [pathname]);
  const saveCommute = useCallback(async (req: PutCommuteRequest) => {
    const res = await wsSave(req);
    refreshMap(); // a new home changes the route lines
    return res;
  }, [wsSave, refreshMap]);

  const job = ws.dashboard && pageScreen(ws, jobId).kind === 'job' ? ws.job : null;

  // A new delivery or a re-match changes the jobs but not the run: ask for the
  // map once more. `refresh` keeps the old map on screen until the new one is in.
  const jobsKey = ws.dashboard ? mapJobsKey(runId, ws.dashboard) : null;
  const jobsScope = jobsKey?.scope ?? null;
  const jobsIds = jobsKey?.jobs ?? null;
  const seenJobs = useRef<MapJobsKey | null>(null);
  useEffect(() => {
    const next = jobsScope !== null && jobsIds !== null ? { scope: jobsScope, jobs: jobsIds } : null;
    if (jobSetChanged(seenJobs.current, next)) refreshMap();
    seenJobs.current = next;
  }, [jobsScope, jobsIds, refreshMap]);

  // The open job's route lines can arrive after the job does (DECISIONS pass 47): while its leg has a
  // pair without a line, ask again about every 5 s, counted from the last map answer. The timer is
  // cleared when the line is in, the job is closed, a request is open or the page unmounts. It re-arms
  // itself after each request, so it does not depend on a render between the request and its answer.
  const { map: loadedMap, status: mapStatus } = runMap;
  const answeredAt = useRef(0);
  useEffect(() => {
    if (mapStatus !== 'loading') answeredAt.current = Date.now();
  }, [mapStatus, loadedMap]);
  const retryLine = useMemo(
    () => lineRetryDue({ job, map: loadedMap, status: mapStatus, reconnecting: ws.reconnecting }),
    [job, loadedMap, mapStatus, ws.reconnecting],
  );
  useEffect(() => {
    if (!retryLine) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (delayMs: number) => {
      timer = setTimeout(() => { refreshMap(); arm(MAP_LINE_RETRY_MS); }, delayMs);
    };
    arm(lineRetryDelayMs(Date.now() - answeredAt.current));
    return () => clearTimeout(timer);
  }, [retryLine, refreshMap]);
  const routePreview = ws.dashboard ? (
    <RouteSlot
      slot={runMapSlot(runMap)}
      dashboard={ws.dashboard}
      businesses={ws.businesses}
      job={job}
      onRetry={runMap.retry}
    />
  ) : null;

  return (
    <EmployeePageView
      key={id}
      state={ws}
      jobId={jobId}
      saveCommute={saveCommute}
      refetchNow={ws.refetchNow}
      markSeen={ws.markSeen}
      onCloseJob={onCloseJob}
      search={search}
      employeeHref={employeeHref}
      routePreview={routePreview}
    />
  );
}
