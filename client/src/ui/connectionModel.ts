/** Pure connection state model (the probe lives in client/src/api). */
export type ConnectionState = {
  /** 'back' = the server answers again after an 'offline' spell; shown for a few checks, then 'online'. */
  status: 'online' | 'offline' | 'back';
  failures: number;
  /** Only while 'back': how many checks in a row have been answered since the server came back. */
  backChecks?: number;
};

export const OFFLINE_AFTER_FAILURES = 2;
export const HEALTH_POLL_MS = 3000;
/** "Connected again" stays for this many answered checks: about 6 s at the 3 s poll (#886). */
export const BACK_FOR_CHECKS = 2;

export const initialConnection: ConnectionState = { status: 'online', failures: 0 };

export function nextConnection(state: ConnectionState, ok: boolean): ConnectionState {
  if (!ok) {
    const failures = state.failures + 1;
    if (failures >= OFFLINE_AFTER_FAILURES) return { status: 'offline', failures };
    // One missed check changes nothing on screen: 'online' stays hidden, 'back' keeps its note.
    return { ...state, failures };
  }
  if (state.status === 'offline') return { status: 'back', failures: 0, backChecks: 1 };
  if (state.status === 'back') {
    const backChecks = (state.backChecks ?? 1) + 1;
    return backChecks > BACK_FOR_CHECKS ? initialConnection : { status: 'back', failures: 0, backChecks };
  }
  return initialConnection;
}
