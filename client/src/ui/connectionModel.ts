/** Pure connection state model plus the health probe. */
export type ConnectionState = { status: 'online' | 'offline'; failures: number };

export const OFFLINE_AFTER_FAILURES = 2;
export const HEALTH_POLL_MS = 3000;

export const initialConnection: ConnectionState = { status: 'online', failures: 0 };

export function nextConnection(state: ConnectionState, ok: boolean): ConnectionState {
  if (ok) return { status: 'online', failures: 0 };
  const failures = state.failures + 1;
  return { status: failures >= OFFLINE_AFTER_FAILURES ? 'offline' : state.status, failures };
}

/** No getHealth helper exists in client/src/api yet, so probe directly here. */
export async function probeHealth(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}
