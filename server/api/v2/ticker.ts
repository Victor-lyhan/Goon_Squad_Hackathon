// The one shared server clock timer for the v2 run (SPEC must-have 4, DECISIONS pass 48).
// Same behaviour as the MVP 1 ticker (server/api/ticker.ts): it only calls the pure advanceClock
// inside store.mutate. Date.now is allowed here.
import type { Run } from '../../../shared/v2/types';
import { advanceClock } from '../../clock';
import type { Store } from '../../store';

export function startV2ClockTicker(
  store: Store<Run>,
  opts: { intervalMs?: number; now?: () => number } = {},
): { stop(): void } {
  const intervalMs = opts.intervalMs ?? 250;
  const now = opts.now ?? Date.now;

  let last = now();
  // Unconsumed time in "speed-ms" (speed * ms); 1000 units = 1 simulated minute.
  // Integer math, so flooring to whole minutes never loses or invents time.
  let carry = 0;
  let pending = false;

  const timer = setInterval(() => {
    const t = now();
    const elapsed = Math.max(0, t - last);
    last = t;

    const clock = store.get().clock;
    if (!clock.playing) {
      carry = 0;
      return;
    }
    carry += clock.speed * elapsed;
    // Never two mutations at once: while one is in flight the time stays in `carry` for a later tick.
    if (pending) return;

    const minutes = Math.floor(carry / 1000);
    if (minutes < 1) return;
    carry -= minutes * 1000;

    pending = true;
    store
      .mutate((run) => {
        // +0.5 speed-ms keeps floor() inside advanceClock exact despite float error.
        const ms = (minutes * 1000 + 0.5) / run.clock.speed;
        run.clock = advanceClock(run.clock, ms, run.scenario.settings);
      })
      .catch((e) => {
        // The run did not move (a throwing mutation leaves the state untouched), so the minutes are still owed.
        if (store.get().clock.playing) carry += minutes * 1000;
        console.warn('[v2 ticker] mutate failed:', e);
      })
      .finally(() => {
        pending = false;
      });
  }, intervalMs);

  return { stop: () => clearInterval(timer) };
}
