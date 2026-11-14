import type { EmployeeDashboard, EmployeeJobView, JobResponse, MapResponse } from '../../../../shared/api';
import type { PutCommuteRequest } from '../../../../shared/schemas';
import type { Business, Hub, Trip } from '../../../../shared/types';
import { Button, Drawer, EmptyState, Spinner } from '../../ui';
import { CommuteEditor } from '../CommuteEditor';
import { JobCard } from '../JobCard';
import { EarningsSummary } from './EarningsSummary';
import { JobDetail } from './JobDetail';
import { jobNotifications } from './newJobsModel';
import { feedGroups, portalView, welcomeTitle } from './employeePortalModel';
import './EmployeePortal.css';

export type EmployeePortalViewProps = {
  dash: EmployeeDashboard | null;
  map: MapResponse | null;
  businesses: Business[];
  hubs: Hub[];
  error: string | null;
  saving?: boolean;
  fieldErrors?: Record<string, string>;
  saved?: { trips: Trip[]; rematchedShipmentIds: string[] } | null;
  saveNotice?: { kind: 'success' | 'error'; text: string } | null;
  job?: JobResponse | null;
  jobError?: string | null;
  newJobIds?: ReadonlySet<string>;
  onSeenJob?: (jobId: string) => void;
  onSave: (req: PutCommuteRequest) => void;
  onViewJob: (jobId: string) => void;
  onCloseJob: () => void;
  onRetry?: () => void;
};

export function EmployeePortalView(p: EmployeePortalViewProps) {
  const view = portalView(p.dash, p.error);
  if (view === 'loading') return <div className="emp-portal"><Spinner label="Loading your portal" /></div>;
  if (view === 'error' || !p.dash) {
    return (
      <div className="emp-portal">
        <EmptyState
          title="Could not load your portal"
          description={p.error}
          action={p.onRetry && <Button onClick={p.onRetry}>Try again</Button>}
        />
      </div>
    );
  }
  const { dash } = p;
  const isNew = (id: string) => p.newJobIds?.has(id) ?? false;
  const onView = (id: string) => { p.onSeenJob?.(id); p.onViewJob(id); };
  const card = (v: EmployeeJobView) => (
    <div key={v.job.id} className={isNew(v.job.id) ? 'emp-portal__new' : undefined}>
      {isNew(v.job.id) && <span className="emp-portal__new-badge">New</span>}
      <JobCard view={v} businesses={p.businesses} hubs={p.hubs} onView={onView} />
    </div>
  );
  const notes = jobNotifications(dash.notifications);
  const jobOpen = Boolean(p.job || p.jobError);
  return (
    <div className="emp-portal">
      <h1 className="emp-portal__title">{welcomeTitle(dash.employee.name)}</h1>
      <EarningsSummary earnedCents={dash.earnedCents} assigned={dash.assigned} completed={dash.completed} />
      <div className="emp-portal__cols">
        <section className="emp-portal__feed" aria-label="Jobs">
          <h2>Your jobs</h2>
          {view === 'empty' && (
            <EmptyState
              title="No jobs yet"
              description="Matched packages appear here automatically. Your commute is saved below."
            />
          )}
          {view === 'ready' && dash.assigned.length === 0 && <p>No active jobs right now.</p>}
          {feedGroups(dash).map((g) => (
            <div key={g.status} className="emp-portal__group" data-status={g.status}>
              <h3 className="emp-portal__group-title">{g.heading}</h3>
              {g.views.map(card)}
            </div>
          ))}
        </section>
        <section className="emp-portal__commute" aria-label="My commute">
          {p.saveNotice && (
            <p className={`emp-portal__msg${p.saveNotice.kind === 'error' ? ' emp-portal__msg--error' : ''}`} role="status">
              {p.saveNotice.text}
            </p>
          )}
          {p.map && (
            <CommuteEditor
              employee={dash.employee}
              trips={dash.trips}
              map={p.map}
              businesses={p.businesses}
              locked={dash.phase === 'locked'}
              saving={p.saving}
              fieldErrors={p.fieldErrors}
              saved={p.saved}
              onSave={p.onSave}
            />
          )}
        </section>
      </div>
      {notes.length > 0 && (
        <section className="emp-portal__notes-wrap" aria-label="Notifications">
        <h2>Notifications</h2>
        <ul className="emp-portal__notes">
          {notes.map((n) => <li key={n.id}>{n.message}</li>)}
        </ul>
      </section>
      )}
      <Drawer open={jobOpen} onClose={p.onCloseJob} title="Job detail">
        {p.job && p.map && <JobDetail job={p.job} map={p.map} businesses={p.businesses} hubs={p.hubs} />}
        {p.jobError && <p role="alert">{p.jobError}</p>}
      </Drawer>
    </div>
  );
}
