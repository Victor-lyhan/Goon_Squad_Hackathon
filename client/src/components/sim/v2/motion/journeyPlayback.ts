// The step plan of a package journey (DECISIONS pass 45 + 46, one Play/Pause button in pass 63).
// The server clock's slowest speed is 30 simulated minutes per real second, too fast to watch a
// leg, so the page pauses the clock and sends small `seek` steps instead. The gap before the pickup
// is one jump; the gap between two windows (the night of a relay) is a card shown for about 1 s,
// then one jump to the morning. The server still decides every position and status; this file only
// picks the next time to seek to.

/** A span of simulated minutes in which a carrier moves the package (from the journey plan). */
export type JourneyWindow = { startMin: number; endMin: number };

/**
 * `overnight` marks the jump over the gap between two windows: the package waits at the relay
 * point for the night, and the driver shows the card before it sends this seek.
 */
export type JourneyAction = { kind: 'seek'; toMin: number; overnight?: true } | { kind: 'done' };

/** Simulated minutes per step. */
export const JOURNEY_STEP_MIN = 2;
/** Real milliseconds between steps: 4 simulated minutes per second. */
export const JOURNEY_STEP_MS = 500;
/** Real milliseconds the "Overnight at <relay point>" card stays up, in place of the night. */
export const OVERNIGHT_CARD_MS = 1000;

const ordered = (windows: JourneyWindow[]): JourneyWindow[] =>
  windows.filter((w) => Number.isFinite(w.startMin) && Number.isFinite(w.endMin) && w.endMin >= w.startMin)
    .slice().sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

/**
 * The next seek from `timeMin`: a step of JOURNEY_STEP_MIN inside the current window (never past
 * its end), or the jump to the start of the next window when in a gap (`overnight` when a window
 * came before it). `done` after the last window.
 */
export function nextJourneyAction(windows: JourneyWindow[], timeMin: number): JourneyAction {
  const list = ordered(windows);
  for (let i = 0; i < list.length; i += 1) {
    const w = list[i];
    if (timeMin < w.startMin) return i > 0 ? { kind: 'seek', toMin: w.startMin, overnight: true } : { kind: 'seek', toMin: w.startMin };
    if (timeMin < w.endMin) return { kind: 'seek', toMin: Math.min(timeMin + JOURNEY_STEP_MIN, w.endMin) };
  }
  return { kind: 'done' };
}

/** The end of the last window: at or past it there is nothing left to play. */
export function journeyEndMin(windows: JourneyWindow[]): number {
  return Math.max(-Infinity, ...ordered(windows).map((w) => w.endMin));
}

/** Timer and API calls the driver needs; injected so tests run without real time or a server. */
export type JourneyDriverDeps = {
  windows: JourneyWindow[];
  /** Simulated time to play from: -Infinity for the start, the clock's time to resume after a pause. */
  fromMin: number;
  /** Sends `{ action: 'seek', timeMin }` through client/src/api. */
  seek: (toMin: number) => Promise<unknown>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /**
   * The overnight card: `true` when it goes up, `false` when it comes down, just before the seek
   * to the morning. Without this the gap is one plain jump. Not called with `false` after `stop`:
   * the caller that stops takes the card down itself.
   */
  onOvernight?: (shown: boolean) => void;
  onDone?: () => void;
  onError?: (e: unknown) => void;
};

/**
 * Plays a journey: one seek every JOURNEY_STEP_MS until `done`, with the overnight card for
 * OVERNIGHT_CARD_MS in place of the gap between two windows. The next step is scheduled only
 * after the previous seek answered, so a slow server never gets a queue of seeks. Returns `stop`
 * (the Pause button): no seek is sent after it. The caller pauses the server clock first.
 */
export function startJourneyPlayback(deps: JourneyDriverDeps): () => void {
  let stopped = false;
  let timer: unknown = null;
  let t = deps.fromMin;

  const later = (fn: () => void, ms: number) => {
    timer = deps.setTimer(() => {
      timer = null;
      if (!stopped) fn();
    }, ms);
  };
  const seekTo = async (toMin: number) => {
    try {
      await deps.seek(toMin);
    } catch (e) {
      stopped = true;
      deps.onError?.(e);
      return;
    }
    t = toMin;
    if (!stopped) later(tick, JOURNEY_STEP_MS);
  };
  const tick = () => {
    const action = nextJourneyAction(deps.windows, t);
    if (action.kind === 'done') { stopped = true; deps.onDone?.(); return; }
    const { toMin } = action;
    if (action.overnight && deps.onOvernight) {
      deps.onOvernight(true);
      later(() => {
        deps.onOvernight?.(false);
        void seekTo(toMin);
      }, OVERNIGHT_CARD_MS);
      return;
    }
    void seekTo(toMin);
  };

  tick();
  return () => {
    stopped = true;
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
}
