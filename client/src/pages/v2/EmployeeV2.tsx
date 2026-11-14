// MVP II Employee workspace page (#438). Mounted at /nyc/employee/:id during the preview and at
// /employee/:id after the cutover: it only ever changes the query string (`?job=`), never the path.
import { useCallback } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { geocode } from '../../api/v2';
import { useEmployeeWorkspace } from '../../components/employee/v2/live/useEmployeeWorkspace';
import { EmployeePageView } from '../../components/employee/v2/page/EmployeePageView';
import { searchFromGeocode, siblingEmployeePath } from '../../components/employee/v2/page/employeePageModel';

const search = searchFromGeocode(geocode);

export default function EmployeeV2() {
  const { id = '' } = useParams();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job') || null;
  const ws = useEmployeeWorkspace(id, jobId);

  const onCloseJob = useCallback(() => {
    setParams((p) => { const next = new URLSearchParams(p); next.delete('job'); return next; });
  }, [setParams]);
  const employeeHref = useCallback((other: string) => siblingEmployeePath(pathname, other), [pathname]);

  return (
    <EmployeePageView
      key={id}
      state={ws}
      jobId={jobId}
      saveCommute={ws.saveCommute}
      refetchNow={ws.refetchNow}
      markSeen={ws.markSeen}
      onCloseJob={onCloseJob}
      search={search}
      employeeHref={employeeHref}
    />
  );
}
