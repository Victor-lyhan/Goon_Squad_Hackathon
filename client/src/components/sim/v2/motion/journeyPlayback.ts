// "Play journey" step plan (DECISIONS pass 45 + 46). The server clock's slowest speed is 30
// simulated minutes per real second, too fast to watch a leg, so the page pauses the clock and
// sends small `seek` steps instead, jumping over the gaps (before pickup, overnight). The server
// still decides every position and status; this file only picks the next time to seek to.

/** A span of simulated minutes in which a carrier moves the package (from the journey plan). */
export type JourneyWindow = { startMin: number; endMin: number };

export type JourneyAction = { kind: 'seek'; toMin: number } | { kind: 'done' };

/** Simulated minutes per step. */
export const JOURNEY_STEP_MIN = 2;
/** Real milliseconds between steps: 4 simulated minutes per second. */
export const JOURNEY_STEP_MS = 500;

const ordered = (windows: JourneyWindow[]): JourneyWindow[] =>
  windows.filter((w) => Number.isFinite(w.startMin) && Number.isFinite(w.endMin) && w.endMin >= w.startMin)
    .slice().sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

/**
 * The next seek from `timeMin`: a step of JOURNEY_STEP_MIN inside the current window (never past
 * its end), or the jump to the start of the next window when in a gap. `done` after the last window.
 */
export function nextJourneyAction(windows: JourneyWindow[], timeMin: number): JourneyAction {
  for (const w of ordered(windows)) {
    if (timeMin < w.startMin) return { kind: 'seek', toMin: w.startMin };
    if (timeMin < w.endMin) return { kind: 'seek', toMin: Math.min(timeMin + JOURNEY_STEP_MIN, w.endMin) };
  }
  return { kind: 'done' };
}

/** Number of seeks a full Play journey sends, from before the first window to `done`. */
export function journeyStepCount(windows: JourneyWindow[]): number {
  let t = -Infinity;
  let n = 0;
  for (;;) {
    const a = nextJourneyAction(windows, t);
    if (a.kind === 'done' || a.toMin <= t) return n;
    t = a.toMin;
    n += 1;
  }
}

/** How long a full Play journey takes in real time (for the "about N s" hint). */
export const journeyDurationMs = (windows: JourneyWindow[]): number => journeyStepCount(windows) * JOURNEY_STEP_MS;

/** Timer and API calls the driver needs; injected so tests run without real time or a server. */
export type JourneyDriverDeps = {
  windows: JourneyWindow[];
  /** Simulated time shown when Play journey is pressed. */
  fromMin: number;
  /** Sends `{ action: 'seek', timeMin }` through client/src/api. */
  seek: (toMin: number) => Promise<unknown>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onDone?: () => void;
  onError?: (e: unknown) => void;
};

/**
 * Runs Play journey: one seek every JOURNEY_STEP_MS until `done`. The next step is scheduled only
 * after the previous seek answered, so a slow server never gets a queue of seeks. Returns `stop`.
 * The caller pauses the server clock first.
 */
export function startJourneyPlayback(deps: JourneyDriverDeps): () => void {
  let stopped = false;
  let timer: unknown = null;
  let t = deps.fromMin;

  const tick = async () => {
    timer = null;
    if (stopped) return;
    const action = nextJourneyAction(deps.windows, t);
    if (action.kind === 'done') { stopped = true; deps.onDone?.(); return; }
    try {
      await deps.seek(action.toMin);
    } catch (e) {
      stopped = true;
      deps.onError?.(e);
      return;
    }
    t = action.toMin;
    if (!stopped) timer = deps.setTimer(() => { void tick(); }, JOURNEY_STEP_MS);
  };

  void tick();
  return () => {
    stopped = true;
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
}
