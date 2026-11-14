// The one shared server clock timer (spec §7). Owner: agent:victor-1.
// Only calls advanceClock (pure) inside store.mutate; Date.now is allowed here.
import { advanceClock } from '../clock';
import type { Store } from '../store';

export function startClockTicker(
  store: Store,
  opts: { intervalMs?: number; now?: () => number } = {},
): { stop(): void } {
  const intervalMs = opts.intervalMs ?? 250;
  const now = opts.now ?? Date.now;

  let last = now();
  // Unconsumed time in "speed-ms" (speed * ms); 1000 units = 1 simulated minute.
  // Integer math so flooring never loses or invents time.
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
    if (pending) {
      // Never overlap mutations; keep the time for the next tick.
      carry += clock.speed * elapsed;
      return;
    }

    carry += clock.speed * elapsed;
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
      .catch((e) => console.warn('[ticker] mutate failed:', e))
      .finally(() => {
        pending = false;
      });
  }, intervalMs);

  return { stop: () => clearInterval(timer) };
}
