import type { BusinessDashboard } from '../../../../shared/api';

export const RECONNECTING_TEXT = 'Reconnecting…';

/** Dashboard polling state. `dashboard` is the last good one; it is kept through failed polls. */
export type BizState = {
  dashboard: BusinessDashboard | null;
  runId: string | null;
  error: string | null;
  /** HTTP status of the last failure (0 = network), null when the last poll succeeded. */
  status: number | null;
};

export type BizAction =
  | { type: 'reset' }
  | { type: 'success'; dashboard: BusinessDashboard; runId: string | null }
  | { type: 'failure'; message: string; status: number }
  | { type: 'runChanged'; runId: string };

export const initialBizState: BizState = { dashboard: null, runId: null, error: null, status: null };

export function bizReducer(state: BizState, a: BizAction): BizState {
  switch (a.type) {
    case 'reset': return initialBizState;
    case 'success': return { dashboard: a.dashboard, runId: a.runId ?? state.runId, error: null, status: null };
    // A new run: the old dashboard belongs to another city, so drop it and show the spinner again.
    case 'runChanged': return { dashboard: null, runId: a.runId, error: null, status: null };
    // 404 = business isn't in this city: drop the data so the not-found state can show.
    // Anything else (network, 5xx): keep the last data and let the page say it is reconnecting.
    case 'failure': return { ...state, dashboard: a.status === 404 ? null : state.dashboard, error: a.message, status: a.status };
  }
}

export type BizView = 'loading' | 'ready' | 'error' | 'not_found';

/** What the page shows. Reconnecting is `ready` plus the note (see isReconnecting). */
export function bizView(s: BizState): BizView {
  if (s.status === 404 && s.dashboard === null) return 'not_found';
  if (s.dashboard) return 'ready';
  return s.error !== null ? 'error' : 'loading';
}

/** Quiet "Reconnecting…" only while there is a last dashboard to keep on screen. */
export function isReconnecting(s: BizState): boolean {
  return s.error !== null && s.dashboard !== null && s.status !== 404;
}

/** Friendly text for a first-load failure (no data to keep). */
export function friendlyError(s: BizState): string {
  return s.status === 0 ? 'We could not reach the server. Check your connection and try again.' : (s.error ?? 'Something went wrong. Please try again.');
}

/** Treat a missing status as a network error (until the shared helper lands). */
export function statusOf(e: unknown): number {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : 0;
}

/** True when the run changed from a known run (the first sighting is not a change). */
export function runDidChange(prev: string | null, next: string | null): boolean {
  return prev !== null && next !== null && prev !== next;
}

/** Only one poll at a time: `run` is skipped (returns false) while another is in flight. */
export function createPollGuard() {
  let busy = false;
  return {
    get busy() { return busy; },
    release() { busy = false; },
    async run(fn: () => Promise<void>): Promise<boolean> {
      if (busy) return false;
      busy = true;
      try { await fn(); } finally { busy = false; }
      return true;
    },
  };
}
