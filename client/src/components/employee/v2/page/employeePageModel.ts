// Pure model for the MVP II Employee page (#438): which screen a hook state shows, and the text for
// each commute-save outcome. It only reads API responses and errors; it computes no status, ETA,
// reward or count of its own (the matched count is the length of the server's rematchedShipmentIds).
import type { CommuteResponse, GeocodeResponse } from '../../../../../../shared/v2/api';
import { ApiRequestError, isTravelUnavailable, type RequestOptions, type TravelUnavailableCode } from '../../../../api/v2';
import type { AddressResult, SearchFn } from '../addressSearchModel';
import { unavailableMessage } from '../commuteFormModel';
import { COMMUTE_SAVE_TIMEOUT_MS } from '../live/useEmployeeWorkspace';
import { TRAVEL_DATA_MISSING_TEXT, type EmployeeWorkspaceState } from '../live/employeeWorkspaceState';

// ---------- Screens ----------

export type PageScreen =
  | { kind: 'loading' }
  | { kind: 'not_found'; fallbackEmployeeId: string | null }
  | { kind: 'unavailable'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'workspace' }
  /** `?job=` is set and its detail has not arrived yet (or still belongs to the previous job). */
  | { kind: 'job_loading' }
  | { kind: 'job' }
  | { kind: 'job_missing' }
  /** The job belongs to another employee; `employeeId` is its owner. */
  | { kind: 'job_other'; employeeId: string };

export const NOT_FOUND_TITLE = 'This employee is not in the current city';
export const NOT_FOUND_TEXT = 'The city was changed, so this link is out of date.';
export const NO_EMPLOYEES_TEXT = 'There are no employees in the current city yet.';
export const LOADING_TEXT = 'Loading your workspace…';
export const JOB_LOADING_TEXT = 'Loading delivery…';
export const ERROR_TITLE = 'The workspace could not be loaded';

type ScreenInput = Pick<EmployeeWorkspaceState, 'view' | 'dashboard' | 'job' | 'jobMissing' | 'unavailable' | 'error' | 'fallbackEmployeeId'>;

export function pageScreen(s: ScreenInput, jobId: string | null): PageScreen {
  switch (s.view) {
    case 'loading': return { kind: 'loading' };
    case 'not_found': return { kind: 'not_found', fallbackEmployeeId: s.fallbackEmployeeId };
    case 'unavailable': return { kind: 'unavailable', text: s.unavailable?.message ?? TRAVEL_DATA_MISSING_TEXT };
    case 'error': return { kind: 'error', text: s.error ?? 'Request failed' };
    case 'ready': break;
  }
  if (!s.dashboard) return { kind: 'loading' };
  if (!jobId) return { kind: 'workspace' };
  if (s.jobMissing) return { kind: 'job_missing' };
  if (!s.job || s.job.job.id !== jobId) return { kind: 'job_loading' };
  if (s.job.job.employeeId !== s.dashboard.employee.id) return { kind: 'job_other', employeeId: s.job.job.employeeId };
  return { kind: 'job' };
}

/** A run-change note is shown once per run: hidden after it was dismissed for the current run. */
export function showRunNote(s: Pick<EmployeeWorkspaceState, 'runChanged' | 'baseline'>, dismissedRunId: string | null | undefined): boolean {
  if (!s.runChanged) return false;
  return dismissedRunId === undefined || dismissedRunId !== (s.baseline?.runId ?? null);
}

/** Final-path link to a job on its owner's page (DECISIONS pass 46: v2 links use the final paths). */
export const jobHref = (employeeId: string, jobId: string) =>
  `/employee/${encodeURIComponent(employeeId)}?job=${encodeURIComponent(jobId)}`;

/** The current path with its last segment replaced by `employeeId`: works under /nyc/employee/:id and /employee/:id. */
export function siblingEmployeePath(pathname: string, employeeId: string): string {
  const base = pathname.replace(/\/+$/, '').replace(/\/[^/]*$/, '');
  return `${base || '/employee'}/${encodeURIComponent(employeeId)}`;
}

/** Adapts the v2 `geocode` helper to the address search's SearchFn. */
export function searchFromGeocode(
  geocode: (q: string, opts?: RequestOptions) => Promise<GeocodeResponse>,
): SearchFn {
  return async (query, signal): Promise<AddressResult[]> => (await geocode(query, { signal })).results;
}

// ---------- Save outcomes ----------

export type SaveOutcome =
  | { kind: 'saving' }
  | { kind: 'saved'; matched: number }
  | { kind: 'locked'; message: string }
  | { kind: 'unavailable'; code: TravelUnavailableCode }
  | { kind: 'invalid'; message: string }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'failed'; message: string };

export const SAVING_TEXT = 'Saving. A new home address can take a few seconds.';
export const SAVED_TEXT = 'Commute saved';
export const LOCKED_FALLBACK_TEXT = 'The run is playing, so the commute cannot be changed now.';
export const TIMEOUT_TEXT =
  `The server did not answer within ${COMMUTE_SAVE_TIMEOUT_MS / 1000} seconds. Your changes are still in the form. Try again.`;
export const NETWORK_TEXT = 'Could not reach the server. Your changes are still in the form. Try again.';
export const FAILED_TEXT = 'The commute could not be saved. Try again.';

export function outcomeFromResponse(res: CommuteResponse): SaveOutcome {
  return { kind: 'saved', matched: res.rematchedShipmentIds.length };
}

export function outcomeFromError(e: unknown): SaveOutcome {
  const message = e instanceof Error && e.message.trim() ? e.message : '';
  if (e instanceof ApiRequestError) {
    if (e.kind === 'timeout') return { kind: 'timeout' };
    if (e.status === 0) return { kind: 'network' };
    if (e.status === 409) return { kind: 'locked', message: message || LOCKED_FALLBACK_TEXT };
    if (isTravelUnavailable(e)) return { kind: 'unavailable', code: e.code };
    if (e.status === 400) return { kind: 'invalid', message: message || FAILED_TEXT };
  }
  return { kind: 'failed', message: message || FAILED_TEXT };
}

/** Text of a 503 for its code: the workspace's fixed copy for missing data, the form's copy otherwise. */
export function unavailableSaveText(code: TravelUnavailableCode): string {
  return code === 'travel_data_missing' ? TRAVEL_DATA_MISSING_TEXT : unavailableMessage(code);
}

export function matchedText(matched: number): string | null {
  if (matched <= 0) return null;
  return matched === 1 ? '1 waiting delivery was matched' : `${matched} waiting deliveries were matched`;
}

export type SaveNotice = {
  /** Where the text goes: the page banner above the editor, or the form itself (400 field errors). */
  at: 'page' | 'form';
  role: 'status' | 'alert';
  text: string;
  /** Whether the commute form stays open after this outcome. */
  formOpen: boolean;
};

export function saveNotice(o: SaveOutcome): SaveNotice {
  switch (o.kind) {
    case 'saving': return { at: 'page', role: 'status', text: SAVING_TEXT, formOpen: true };
    case 'saved': {
      const m = matchedText(o.matched);
      return { at: 'page', role: 'status', text: m ? `${SAVED_TEXT}. ${m}.` : `${SAVED_TEXT}.`, formOpen: false };
    }
    case 'locked': return { at: 'page', role: 'alert', text: o.message, formOpen: true };
    case 'unavailable': return { at: 'page', role: 'alert', text: unavailableSaveText(o.code), formOpen: true };
    case 'invalid': return { at: 'form', role: 'alert', text: o.message, formOpen: true };
    case 'timeout': return { at: 'page', role: 'alert', text: TIMEOUT_TEXT, formOpen: true };
    case 'network': return { at: 'page', role: 'alert', text: NETWORK_TEXT, formOpen: true };
    case 'failed': return { at: 'page', role: 'alert', text: o.message, formOpen: true };
  }
}
