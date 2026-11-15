// MVP II Employee page (#438): puts the merged Employee pieces together. Props only, so tests render
// every screen without the data hook. Local UI state: whether the commute form is open, the last save
// outcome, and the run whose "city changed" note was dismissed. All data comes from the hook state.
// The job screens (#634) carry the employee's name as their h1, because the workspace with its h1 is
// not on screen there.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { CommuteResponse } from '../../../../../../shared/v2/api';
import type { PutCommuteRequest } from '../../../../../../shared/v2/schemas';
import { AddressSearch } from '../AddressSearch';
import type { SearchFn } from '../addressSearchModel';
import { CommuteForm, type HomeControlArgs } from '../CommuteForm';
import type { Draft } from '../commuteFormModel';
import { CommuteSummary } from '../CommuteSummary';
import { EmployeeWorkspace, NewJobAnnouncer } from '../EmployeeWorkspace';
import { commuteSummary } from '../employeeWorkspaceModel';
import { JobDetailV2, JobV2Failed, JobV2Missing, JobV2Other } from '../JobDetailV2';
import { RECONNECTING_TEXT, RUN_CHANGED_NOTE, type EmployeeWorkspaceState } from '../live/employeeWorkspaceState';
import {
  ERROR_TITLE, JOB_LOADING_TEXT, LOADING_TEXT, NOT_FOUND_TEXT, NOT_FOUND_TITLE, NO_EMPLOYEES_TEXT,
  jobHref, outcomeAfterDashboard, outcomeFromError, outcomeFromResponse, pageScreen, saveNotice, showRunNote,
  type SaveOutcome,
} from './employeePageModel';
import { PageLink } from './PageLink';
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

/** Focuses an element that is not a control (a heading), without putting it in the tab order. */
function focusStatic(el: HTMLElement | null | undefined) {
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.focus();
}

/** A control the browser has switched off: disabled itself, or inside a disabled fieldset. */
const isSwitchedOff = (el: Element) =>
  (el as HTMLButtonElement).disabled === true || el.closest('fieldset[disabled]') !== null;

export function EmployeePageView({
  state, jobId, saveCommute, refetchNow, markSeen, onCloseJob, search, employeeHref, routePreview,
  initialEditing = false, initialOutcome = null, initialDraft,
}: EmployeePageViewProps) {
  const [editing, setEditing] = useState(initialEditing);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(initialOutcome);
  const [dismissedRun, setDismissedRun] = useState<string | null | undefined>(undefined);
  const screen = pageScreen(state, jobId);

  // A job opened from the list (#584): the list stays on screen until the job's detail arrives, so there
  // is no loading text in between and the clicked link keeps focus until the job heading takes it.
  // A page that starts on `?job=`, or moves from one job to another, shows the loading text as before.
  const [listShown, setListShown] = useState(false);
  const jobOpening = screen.kind === 'job_loading' && listShown;
  const showsList = screen.kind === 'workspace' || jobOpening;
  if (showsList !== listShown) setListShown(showsList);

  // "Commute saved" is for the moment after a save (#634): it goes when a job view opens and when the
  // run is locked (playback), and it does not come back. Opening the editor clears it as before.
  if (outcome?.kind === 'saved' && (jobId || state.dashboard?.phase === 'locked')) setOutcome(null);

  // A 409 leaves its sentence above the editor and locks the form. Both go when a later dashboard says
  // planning (Back to start). The form drops its own lock by the same rule (phase and version, CommuteForm),
  // so the two never disagree.
  const polled = state.dashboard ? { phase: state.dashboard.phase, version: state.dashboard.version } : null;
  const [seenDashboard, setSeenDashboard] = useState(polled);
  if (polled && (seenDashboard?.phase !== polled.phase || seenDashboard.version !== polled.version)) {
    setSeenDashboard(polled);
    const next = outcomeAfterDashboard(outcome, polled.phase);
    if (next !== outcome) setOutcome(next);
  }

  useEffect(() => { if (jobId) markSeen(jobId); }, [jobId, markSeen]);

  // Focus after the editor opens (#735), and after the editor or a job closes (#550). The element to
  // focus only exists after the re-render, so the handlers set a flag and a layout effect moves focus
  // once the DOM is in place. The shell has the only main landmark (#584), so this root is a div.
  const rootRef = useRef<HTMLDivElement>(null);
  const focusEditor = useRef(false);
  const focusEdit = useRef(false);
  const lastJob = useRef(jobId);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (editing && root) {
      const heading = root.querySelector<HTMLElement>('#ep-editor-heading');
      // "Edit commute" was replaced by the editor: its heading takes the focus, so the next Tab is the
      // editor's first control and Esc closes it at once.
      if (focusEditor.current) heading?.focus();
      // A control that is switched off while it has focus (the server refuses the save because the run
      // is locked, or a poll brings the lock) would drop focus to <body>: the heading takes it.
      const active = root.ownerDocument.activeElement;
      if (active && active !== heading && root.querySelector('.ep-editor')?.contains(active) && isSwitchedOff(active)) {
        heading?.focus();
      }
    }
    focusEditor.current = false;
    if (focusEdit.current && !editing) {
      focusEdit.current = false;
      root?.querySelector<HTMLButtonElement>('.ew-commute .ew-btn')?.focus(); // CommuteSummary's Edit commute
    }
    const closedJob = lastJob.current;
    lastJob.current = jobId;
    if (closedJob && !jobId && root) {
      const row = [...root.querySelectorAll<HTMLElement>('[data-job-id]')].find((r) => r.dataset.jobId === closedJob);
      const link = row?.querySelector<HTMLElement>('[data-row-focus]');
      // A job that was re-matched away or belongs to another carrier has no row (#634): focus goes to
      // the heading of the list that "Back to deliveries" leads to, never to <body>.
      if (link) link.focus();
      else focusStatic(root.querySelector<HTMLElement>('#ew-assigned-heading') ?? root);
    }
  });

  if (screen.kind === 'loading') {
    return <div className="ep"><p className="ep-state" role="status">{LOADING_TEXT}</p></div>;
  }
  if (screen.kind === 'not_found') {
    return (
      <div className="ep">
        <section className="ep-state" role="status">
          <h1>{NOT_FOUND_TITLE}</h1>
          <p>{screen.fallbackEmployeeId ? NOT_FOUND_TEXT : NO_EMPLOYEES_TEXT}</p>
          <p className="ep-links">
            {screen.fallbackEmployeeId && (
              <PageLink to={employeeHref(screen.fallbackEmployeeId)}>Open an employee in the current city</PageLink>
            )}
            <PageLink to="/">Back to the start page</PageLink>
          </p>
        </section>
      </div>
    );
  }
  if (screen.kind === 'unavailable') {
    return (
      <div className="ep">
        <section className="ep-state ep-problem" role="alert">
          <h1>Travel data unavailable</h1>
          <p>{screen.text}</p>
          <button type="button" className="ep-btn" onClick={() => { void refetchNow(); }}>Retry</button>
        </section>
      </div>
    );
  }
  if (screen.kind === 'error') {
    return (
      <div className="ep">
        <section className="ep-state ep-problem" role="alert">
          <h1>{ERROR_TITLE}</h1>
          <p>{screen.text}</p>
          <button type="button" className="ep-btn" onClick={() => { void refetchNow(); }}>Retry</button>
        </section>
      </div>
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
      focusEdit.current = true;
      setEditing(false);
      return res;
    } catch (e) {
      setOutcome(outcomeFromError(e)); // the form keeps its input and stays open
      throw e;
    }
  };

  const closeEditor = () => {
    focusEdit.current = true;
    setEditing(false);
    setOutcome(null);
  };
  // Esc anywhere in the editor closes it without saving, unless a control already used the key
  // (the open address list closes itself and calls preventDefault).
  const onEditorKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || saving) return;
    e.preventDefault();
    closeEditor();
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
    <section className="ep-editor" aria-labelledby="ep-editor-heading" onKeyDown={onEditorKeyDown}>
      <div className="ep-editor-head">
        <h2 id="ep-editor-heading" tabIndex={-1}>Edit commute</h2>
        <button
          type="button"
          className="ep-btn"
          disabled={saving}
          onClick={closeEditor}
        >
          Close
        </button>
      </div>
      {/* No role here or on the form's message after a save (#735): the page's live region says them. */}
      {pageNotice && (
        <p className={`ep-notice${pageNotice.role === 'alert' ? ' ep-problem' : ''}`}>
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
          dashboardVersion={dashboard.version}
          homeControl={homeControl}
          onSave={onSave}
          // A save is said by the page's live region; with no save in play the form's own region still
          // says its one other message (the run was locked while the editor was open).
          announce={!outcome}
          initialDraft={initialDraft}
        />
      </div>
    </section>
  ) : (
    <CommuteSummary
      model={commuteSummary(dashboard, businesses)}
      onEdit={() => { focusEditor.current = true; setEditing(true); setOutcome(null); }}
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
      {savedNotice && <p className="ep-notice ep-success">{savedNotice.text}</p>}
    </div>
  );

  const workspace = (
    <EmployeeWorkspace
      dashboard={dashboard}
      businesses={businesses}
      newJobIds={state.newJobIds}
      editor={<>{commuteBlock}{routePreview}</>}
      announce={false}
    />
  );

  let body: ReactNode;
  const homeNeighborhood = dashboard.home.neighborhood;
  switch (screen.kind) {
    case 'job_loading':
      if (jobOpening) { body = workspace; break; }
      body = <p className="ep-state" role="status">{JOB_LOADING_TEXT}</p>;
      break;
    case 'job_missing':
      body = <div className="ep-job"><JobV2Missing onBack={onCloseJob} /></div>;
      break;
    case 'job_failed':
      body = <div className="ep-job"><JobV2Failed onBack={onCloseJob} /></div>;
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
      body = workspace;
  }

  // Every screen but the workspace (which has its own h1, also while a job opens over the list).
  const jobScreen = screen.kind !== 'workspace' && !jobOpening;

  return (
    <div className="ep" ref={rootRef} aria-busy={jobOpening || undefined}>
      {notices}
      {jobScreen && <h1 className="ep-name">{dashboard.employee.name}</h1>}
      {body}
      {/* The page's two hidden polite live regions (#735). They are here on every screen of a loaded
          workspace, so each is in place before its text arrives and neither is put into the page a second
          time when a job view opens or closes. The first says the state of a commute save ("Saving",
          "Commute saved.", or why it failed) once: the visible notices carry no role of their own, and a
          poll that changes nothing leaves the text node alone. The second says each new delivery (#633). */}
      <div className="ew-sr ep-announce" role="status" aria-live="polite" aria-atomic="true">{notice?.text ?? ''}</div>
      <NewJobAnnouncer dashboard={dashboard} newJobIds={state.newJobIds} />
    </div>
  );
}
