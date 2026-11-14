// MVP II Employee page (#438): puts the merged Employee pieces together. Props only, so tests render
// every screen without the data hook. Local UI state: whether the commute form is open, the last save
// outcome, and the run whose "city changed" note was dismissed. All data comes from the hook state.
import { useEffect, useState, type ReactNode } from 'react';
import type { CommuteResponse } from '../../../../../../shared/v2/api';
import type { PutCommuteRequest } from '../../../../../../shared/v2/schemas';
import { AddressSearch } from '../AddressSearch';
import type { SearchFn } from '../addressSearchModel';
import { CommuteForm, type HomeControlArgs } from '../CommuteForm';
import type { Draft } from '../commuteFormModel';
import { CommuteSummary } from '../CommuteSummary';
import { EmployeeWorkspace } from '../EmployeeWorkspace';
import { commuteSummary } from '../employeeWorkspaceModel';
import { JobDetailV2, JobV2Missing, JobV2Other } from '../JobDetailV2';
import { RECONNECTING_TEXT, RUN_CHANGED_NOTE, type EmployeeWorkspaceState } from '../live/employeeWorkspaceState';
import {
  ERROR_TITLE, JOB_LOADING_TEXT, LOADING_TEXT, NOT_FOUND_TEXT, NOT_FOUND_TITLE, NO_EMPLOYEES_TEXT,
  jobHref, outcomeFromError, outcomeFromResponse, pageScreen, saveNotice, showRunNote, type SaveOutcome,
} from './employeePageModel';
import './employeePage.css';

export type EmployeePageViewProps = {
  state: EmployeeWorkspaceState;
  /** The `?job=` value, null when absent. */
  jobId: string | null;
  saveCommute: (req: PutCommuteRequest) => Promise<CommuteResponse>;
  refetchNow: () => Promise<void>;
  markSeen: (jobId: string) => void;
  /** Removes `?job=` from the URL. */
  onCloseJob: () => void;
  /** Address search for a new home (the page passes `geocode` from client/src/api/v2). */
  search: SearchFn;
  /** Link to another employee's workspace on this same route (for the not-found state). */
  employeeHref: (employeeId: string) => string;
  /** The commute route preview (#463): below the commute, and below the open job with its stops numbered. */
  routePreview?: ReactNode;
  /** Starting UI state, for static renders of each screen. */
  initialEditing?: boolean;
  initialOutcome?: SaveOutcome | null;
  initialDraft?: Draft;
};

export function EmployeePageView({
  state, jobId, saveCommute, refetchNow, markSeen, onCloseJob, search, employeeHref, routePreview,
  initialEditing = false, initialOutcome = null, initialDraft,
}: EmployeePageViewProps) {
  const [editing, setEditing] = useState(initialEditing);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(initialOutcome);
  const [dismissedRun, setDismissedRun] = useState<string | null | undefined>(undefined);
  const screen = pageScreen(state, jobId);

  useEffect(() => { if (jobId) markSeen(jobId); }, [jobId, markSeen]);

  if (screen.kind === 'loading') {
    return <main className="ep"><p className="ep-state" role="status">{LOADING_TEXT}</p></main>;
  }
  if (screen.kind === 'not_found') {
    return (
      <main className="ep">
        <section className="ep-state" role="status">
          <h1>{NOT_FOUND_TITLE}</h1>
          <p>{screen.fallbackEmployeeId ? NOT_FOUND_TEXT : NO_EMPLOYEES_TEXT}</p>
          <p className="ep-links">
            {screen.fallbackEmployeeId && (
              <a href={employeeHref(screen.fallbackEmployeeId)}>Open an employee in the current city</a>
            )}
            <a href="/">Back to the start page</a>
          </p>
        </section>
      </main>
    );
  }
  if (screen.kind === 'unavailable') {
    return (
      <main className="ep">
        <section className="ep-state ep-problem" role="alert">
          <h1>Travel data unavailable</h1>
          <p>{screen.text}</p>
          <button type="button" className="ep-btn" onClick={() => { void refetchNow(); }}>Retry</button>
        </section>
      </main>
    );
  }
  if (screen.kind === 'error') {
    return (
      <main className="ep">
        <section className="ep-state ep-problem" role="alert">
          <h1>{ERROR_TITLE}</h1>
          <p>{screen.text}</p>
          <button type="button" className="ep-btn" onClick={() => { void refetchNow(); }}>Retry</button>
        </section>
      </main>
    );
  }

  const dashboard = state.dashboard!;
  const { businesses } = state;
  const locked = dashboard.phase === 'locked';
  const notice = outcome ? saveNotice(outcome) : null;
  const saving = outcome?.kind === 'saving';
  const runNote = showRunNote(state, dismissedRun);

  const onSave = async (req: PutCommuteRequest): Promise<CommuteResponse> => {
    setOutcome({ kind: 'saving' });
    try {
      const res = await saveCommute(req);
      setOutcome(outcomeFromResponse(res));
      setEditing(false);
      return res;
    } catch (e) {
      setOutcome(outcomeFromError(e)); // the form keeps its input and stays open
      throw e;
    }
  };

  const homeControl = ({ value, onChoose, disabled }: HomeControlArgs) => (
    <AddressSearch
      search={search}
      value={value.kind === 'new'
        ? { neighborhood: value.neighborhood, lat: value.lat, lng: value.lng }
        : { neighborhood: value.neighborhood, lat: dashboard.home.lat, lng: dashboard.home.lng }}
      onChoose={onChoose}
      // The form passes disabled while saving too; the search only shows its locked text when locked.
      disabled={disabled && !saving}
    />
  );

  const pageNotice = notice && notice.at === 'page' ? notice : null;
  const commuteBlock = editing ? (
    <section className="ep-editor" aria-labelledby="ep-editor-heading">
      <div className="ep-editor-head">
        <h2 id="ep-editor-heading">Edit commute</h2>
        <button
          type="button"
          className="ep-btn"
          disabled={saving}
          onClick={() => { setEditing(false); setOutcome(null); }}
        >
          Close
        </button>
      </div>
      {pageNotice && (
        <p className={`ep-notice${pageNotice.role === 'alert' ? ' ep-problem' : ''}`} role={pageNotice.role}>
          {pageNotice.text}
        </p>
      )}
      {/* The page banner replaces the form's own message, except for 400 field errors shown at the form. */}
      <div className={pageNotice ? 'ep-form ep-form--quiet' : 'ep-form'}>
        <CommuteForm
          employee={dashboard.employee}
          home={dashboard.home}
          businesses={businesses}
          phase={dashboard.phase}
          homeControl={homeControl}
          onSave={onSave}
          initialDraft={initialDraft}
        />
      </div>
    </section>
  ) : (
    <CommuteSummary
      model={commuteSummary(dashboard, businesses)}
      onEdit={() => { setEditing(true); setOutcome(null); }}
      editDisabled={locked}
    />
  );

  const savedNotice = !editing && notice && outcome?.kind === 'saved' ? notice : null;
  const notices = (
    <div className="ep-notices">
      {state.reconnecting && (
        <p className="ep-notice ep-problem" role="status">
          {RECONNECTING_TEXT}{state.unavailable ? ` ${state.unavailable.message}` : ''}
        </p>
      )}
      {runNote && (
        <p className="ep-notice" role="status">
          {RUN_CHANGED_NOTE}{' '}
          <button type="button" className="ep-btn ep-btn-link" onClick={() => setDismissedRun(state.baseline?.runId ?? null)}>
            Dismiss
          </button>
        </p>
      )}
      {savedNotice && <p className="ep-notice ep-success" role="status">{savedNotice.text}</p>}
    </div>
  );

  let body: ReactNode;
  const homeNeighborhood = dashboard.home.neighborhood;
  switch (screen.kind) {
    case 'job_loading':
      body = <p className="ep-state" role="status">{JOB_LOADING_TEXT}</p>;
      break;
    case 'job_missing':
      body = <div className="ep-job"><JobV2Missing onBack={onCloseJob} /></div>;
      break;
    case 'job_other':
      body = <div className="ep-job"><JobV2Other href={jobHref(screen.employeeId, jobId!)} onBack={onCloseJob} /></div>;
      break;
    case 'job':
      body = (
        <div className="ep-job">
          <JobDetailV2 job={state.job!} businesses={businesses} homeNeighborhood={homeNeighborhood} onBack={onCloseJob} />
          {routePreview}
        </div>
      );
      break;
    default:
      body = (
        <EmployeeWorkspace
          dashboard={dashboard}
          businesses={businesses}
          newJobIds={state.newJobIds}
          editor={<>{commuteBlock}{routePreview}</>}
        />
      );
  }

  return (
    <main className="ep">
      {notices}
      {body}
    </main>
  );
}
