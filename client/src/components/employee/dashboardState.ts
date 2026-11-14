import type { EmployeeDashboard } from '../../../../shared/api';

export const RECONNECTING_TEXT = 'Reconnecting…';
export const RUN_CHANGED_NOTE = 'The city changed, so your portal was reloaded.';

/** Dashboard polling state. `dash` is the last good dashboard; it is kept through failed polls. */
export type DashState = {
  dash: EmployeeDashboard | null;
  runId: string | null;
  error: string | null;
  /** HTTP status of the last failure (0 = network), null when the last poll succeeded. */
  status: number | null;
};

export type DashAction =
  | { type: 'reset' }
  | { type: 'success'; dash: EmployeeDashboard; runId: string | null }
  | { type: 'failure'; message: string; status: number }
  | { type: 'runChanged'; runId: string };

export const initialDashState: DashState = { dash: null, runId: null, error: null, status: null };

export function dashReducer(state: DashState, a: DashAction): DashState {
  switch (a.type) {
    case 'reset': return initialDashState;
    case 'success': return { dash: a.dash, runId: a.runId ?? state.runId, error: null, status: null };
    // A new run: the old dashboard belongs to another city, so drop it and show the spinner again.
    case 'runChanged': return { dash: null, runId: a.runId, error: null, status: null };
    // 404 = employee isn't in this city: drop the data so the not-found state can show.
    // Anything else (network, 5xx): keep the last data and let the page say it is reconnecting.
    case 'failure': return { ...state, dash: a.status === 404 ? null : state.dash, error: a.message, status: a.status };
  }
}

/** Quiet "Reconnecting…" only while there is a last dashboard to keep on screen. */
export function isReconnecting(s: DashState): boolean {
  return s.error !== null && s.dash !== null && s.status !== 404;
}
