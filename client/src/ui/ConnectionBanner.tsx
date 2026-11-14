import { useEffect, useState } from 'react';
import './ui.css';
import { probeHealth } from '../api';
import { createHealthPoller } from './healthPoller';
import {
  HEALTH_POLL_MS, initialConnection, nextConnection, type ConnectionState,
} from './connectionModel';

export const OFFLINE_TEXT = "Can't reach the Relay server. Retrying…";

/** Presentational: renders nothing when online. */
export function ConnectionBanner({ status }: { status: ConnectionState['status'] }) {
  if (status === 'online') return null;
  return <div className="ui-connection-banner" role="status">{OFFLINE_TEXT}</div>;
}

/** Polls /api/health every 3 s and shows the banner while offline. */
export function ConnectionMonitor() {
  const [state, setState] = useState(initialConnection);
  useEffect(() => {
    const poller = createHealthPoller(probeHealth, (ok) => setState((s) => nextConnection(s, ok)));
    const id = setInterval(() => { void poller.tick(); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); poller.stop(); };
  }, []);
  return <ConnectionBanner status={state.status} />;
}
