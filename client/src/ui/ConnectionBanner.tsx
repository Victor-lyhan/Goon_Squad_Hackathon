import { useEffect, useState } from 'react';
import './ui.css';
import { probeHealth } from '../api/http';
import { createHealthPoller } from './healthPoller';
import {
  HEALTH_POLL_MS, initialConnection, nextConnection, type ConnectionState,
} from './connectionModel';

/** While the server does not answer. The pages use the same name for it: "Relay server". */
export const OFFLINE_TEXT = "Can't reach the Relay server. Retrying…";
/** Once it answers again; shown for a few seconds, then the note goes. */
export const BACK_TEXT = 'Connected to the Relay server again.';

/** The note's one line per status; null when there is nothing to say. */
export function connectionText(status: ConnectionState['status']): string | null {
  return status === 'offline' ? OFFLINE_TEXT : status === 'back' ? BACK_TEXT : null;
}

/**
 * Presentational. The polite live region (role="status") is always in the page and empty while online, so
 * a screen reader hears the line when it arrives and again when it changes to "connected again". The note
 * itself is fixed at the bottom right of the window: it moves nothing and never covers the header (#886).
 */
export function ConnectionBanner({ status }: { status: ConnectionState['status'] }) {
  const text = connectionText(status);
  return (
    <div className="ui-connection" role="status">
      {/* The key makes the "connected again" line a new element, so it fades in like the first one. */}
      {text && <p key={status} className={`ui-connection-banner ui-connection-banner--${status}`}>{text}</p>}
    </div>
  );
}

/** Polls /api/health every 3 s; shows the note while offline and for a moment after the server is back. */
export function ConnectionMonitor() {
  const [state, setState] = useState(initialConnection);
  useEffect(() => {
    const poller = createHealthPoller(probeHealth, (ok) => setState((s) => nextConnection(s, ok)));
    const id = setInterval(() => { void poller.tick(); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); poller.stop(); };
  }, []);
  return <ConnectionBanner status={state.status} />;
}
