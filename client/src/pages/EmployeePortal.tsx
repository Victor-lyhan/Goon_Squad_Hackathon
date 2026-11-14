import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { JobResponse } from '../../../shared/api';
import type { PutCommuteRequest } from '../../../shared/schemas';
import { ApiRequestError, getJob, putCommute } from '../api';
import { Toast, useToasts } from '../ui';
import { EmployeePortalView } from '../components/employee/EmployeePortalView';
import { useEmployeeDashboard } from '../components/employee/useEmployeeDashboard';
import {
  NEW_JOB_TOAST, newJobNotifications, saveErrorMessage, saveMessage,
} from '../components/employee/employeePortalModel';

export default function EmployeePortal() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job');
  const data = useEmployeeDashboard(id);
  const { toasts, push, dismiss } = useToasts();
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  // New-delivery-job toast: first poll for an employee only seeds the seen set.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => { seen.current = null; setNotice(null); setFieldErrors(undefined); }, [id]);
  useEffect(() => {
    if (!data.dash) return;
    const fresh = newJobNotifications(seen.current, data.dash.notifications);
    seen.current = new Set([...(seen.current ?? []), ...data.dash.notifications.map((n) => n.id)]);
    if (fresh.length > 0) push(NEW_JOB_TOAST, 'info');
  }, [data.dash, push]);

  // Job detail from ?job=. Refetched while open so status stays current.
  useEffect(() => {
    setJobError(null);
    if (!jobId) { setJob(null); return; }
    let alive = true;
    const load = () => getJob(jobId)
      .then((j) => { if (alive) { setJob(j); setJobError(null); } })
      .catch((e: unknown) => { if (alive) setJobError(e instanceof Error ? e.message : 'Could not load job'); });
    void load();
    const t = setInterval(load, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [jobId]);

  const onViewJob = (j: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('job', j); return n; });
  const onCloseJob = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('job'); return n; });

  const onSave = async (req: PutCommuteRequest) => {
    setSaving(true);
    setFieldErrors(undefined);
    setNotice(null);
    try {
      const res = await putCommute(id, req);
      setNotice({ kind: 'success', text: saveMessage(res) });
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

  return (
    <>
      <EmployeePortalView
        {...data}
        saving={saving}
        fieldErrors={fieldErrors}
        saveNotice={notice}
        job={job}
        jobError={jobError}
        onSave={onSave}
        onViewJob={onViewJob}
        onCloseJob={onCloseJob}
        onRetry={() => void data.refetch()}
      />
      <Toast toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
