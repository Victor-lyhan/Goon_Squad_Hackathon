// MVP II Employee workspace page (#438). Mounted at /nyc/employee/:id during the preview and at
// /employee/:id after the cutover: it only ever changes the query string (`?job=`), never the path.
// The NYC map is fetched once per run and again after a commute save (#463, DECISIONS pass 48).
import { useCallback } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import type { PutCommuteRequest } from '../../../../shared/v2/schemas';
import { geocode } from '../../api/v2';
import { useEmployeeWorkspace } from '../../components/employee/v2/live/useEmployeeWorkspace';
import { EmployeePageView } from '../../components/employee/v2/page/EmployeePageView';
import { pageScreen, searchFromGeocode, siblingEmployeePath } from '../../components/employee/v2/page/employeePageModel';
import { RouteSlot } from '../../components/employee/v2/page/RouteSlot';
import { runMapSlot } from '../../components/employee/v2/page/runMapModel';
import { useRunMap } from '../../components/employee/v2/page/useRunMap';

const search = searchFromGeocode(geocode);

export default function EmployeeV2() {
  const { id = '' } = useParams();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job') || null;
  const ws = useEmployeeWorkspace(id, jobId);
  const runMap = useRunMap(id, ws.baseline?.runId ?? null);
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
