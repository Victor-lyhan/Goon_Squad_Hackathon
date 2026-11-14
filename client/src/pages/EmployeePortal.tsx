import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { Trip } from '../../../shared/types';
import type { JobResponse } from '../../../shared/api';
import type { PutCommuteRequest } from '../../../shared/schemas';
import { ApiRequestError, getEmployees, getJob, isAbortError, putCommute } from '../api';
import { Drawer, Toast, useToasts } from '../ui';
import { EmployeeNotFound, JobLinkNotice } from '../components/employee/JobDetail';
import { employeeLookup, jobLinkState, type EmployeeLookup } from '../components/employee/jobDetailModel';
import { EmployeePortalView } from '../components/employee/EmployeePortalView';
import { useEmployeeDashboard } from '../components/employee/useEmployeeDashboard';
import { saveErrorMessage } from '../components/employee/employeePortalModel';
import { RECONNECTING_TEXT } from '../components/employee/dashboardState';
import { toastText } from '../components/employee/newJobsModel';

export default function EmployeePortal() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job');
  const data = useEmployeeDashboard(id);
  const { toasts, push, dismiss } = useToasts();
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [saved, setSaved] = useState<{ trips: Trip[]; rematchedShipmentIds: string[] } | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobMissing, setJobMissing] = useState(false);
  const [lookup, setLookup] = useState<EmployeeLookup>({ kind: 'found' });

  // One toast per newly arrived job (first poll for an employee only seeds the baseline).
  useEffect(() => { setNotice(null); setSaved(null); setFieldErrors(undefined); }, [id]);
  useEffect(() => {
    for (const a of data.arrived) push(toastText(a.packageName), 'info');
  }, [data.arrived, push]);

  // Job detail from ?job=. Refetched while open so status stays current.
  useEffect(() => {
    setJobError(null);
    setJobMissing(false);
    if (!jobId) { setJob(null); return; }
    let alive = true;
    const ctl = new AbortController();
    const load = () => getJob(jobId, { signal: ctl.signal })
      .then((j) => { if (alive) { setJob(j); setJobError(null); setJobMissing(false); } })
      .catch((e: unknown) => {
        if (!alive || isAbortError(e)) return;
        if (e instanceof ApiRequestError && e.status === 404) { setJob(null); setJobError(null); setJobMissing(true); return; }
        setJobError(e instanceof Error ? e.message : 'Could not load job');
      });
    let t: ReturnType<typeof setTimeout> | undefined;
    const loop = () => { void load().finally(() => { if (alive) t = setTimeout(loop, 1000); }); };
    loop();
    return () => { alive = false; ctl.abort(); if (t) clearTimeout(t); };
  }, [jobId, id, data.runId]);

  // Unknown employee: when the dashboard fails, ask the API who exists (also catches a runId change).
  useEffect(() => {
    // While reconnecting with data on screen there is nothing to look up; only a missing dashboard needs it.
    if (!data.error || data.reconnecting) { setLookup({ kind: 'found' }); return; }
    let alive = true;
    getEmployees()
      .then((r) => { if (alive) setLookup(employeeLookup(r.employees, id)); })
      .catch(() => { if (alive) setLookup({ kind: 'found' }); });
    return () => { alive = false; };
  }, [data.error, data.reconnecting, id]);

  const onViewJob = (j: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('job', j); return n; });
  const onCloseJob = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('job'); return n; });

  const onSave = async (req: PutCommuteRequest) => {
    setSaving(true);
    setFieldErrors(undefined);
    setNotice(null);
    setSaved(null);
    try {
      const res = await putCommute(id, req);
      setSaved({ trips: res.trips, rematchedShipmentIds: res.rematchedShipmentIds });
      await data.refetch();
    } catch (e) {
      if (e instanceof ApiRequestError) {
        if (e.status === 400 && e.fieldErrors) setFieldErrors(e.fieldErrors);
        setNotice({ kind: 'error', text: saveErrorMessage(e.status, e.message) });
      } else {
        setNotice({ kind: 'error', text: 'Could not save your commute' });
      }
    } finally {
      setSaving(false);
    }
  };

  if (lookup.kind === 'unknown') return <EmployeeNotFound firstId={lookup.firstId} />;

  const linkState = jobLinkState(jobId, job, jobMissing, id);
  const noticeOpen = linkState.kind === 'missing' || linkState.kind === 'other';

  return (
    <>
      {data.reconnecting && (
        <p className="emp-portal__reconnect" role="status" style={{ opacity: 0.7, fontSize: 13, margin: '8px 16px 0', textAlign: 'right' }}>
          {RECONNECTING_TEXT}
        </p>
      )}
      <EmployeePortalView
        {...data}
        saving={saving}
        fieldErrors={fieldErrors}
        saved={saved}
        saveNotice={notice}
        job={linkState.kind === 'ok' ? job : null}
        jobError={noticeOpen ? null : jobError}
        onSave={onSave}
        onViewJob={onViewJob}
        onCloseJob={onCloseJob}
        onRetry={() => void data.refetch()}
      />
      <Drawer open={noticeOpen} onClose={onCloseJob} title="Job detail">
        <JobLinkNotice state={linkState} onBack={onCloseJob} />
      </Drawer>
      <Toast toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
