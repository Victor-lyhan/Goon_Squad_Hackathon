import { useEffect, useState } from 'react';
import './ui.css';
import {
  HEALTH_POLL_MS, initialConnection, nextConnection, probeHealth, type ConnectionState,
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
    let alive = true;
    const tick = async () => {
      const ok = await probeHealth();
      if (alive) setState((s) => nextConnection(s, ok));
    };
    const id = setInterval(tick, HEALTH_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return <ConnectionBanner status={state.status} />;
}
