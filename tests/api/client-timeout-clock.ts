// A fake clock for the client's request timeout, shared by client-abort and client-health.
//
// The client arms one setTimeout per request (client/src/api/client.ts). A test that asks "did the call
// end by its timeout?" must not compare wall-clock time with a limit (DECISIONS pass 52): it fakes
// setTimeout, moves the clock by hand and counts timers, so a slow runner cannot turn it red.
//
// Two rules keep the fake clock away from real sockets, which the same files also use:
// - It is only used with `hangingFetch`. Node's own fetch arms an internal timer through the global
//   setTimeout while it connects (seen as `setTimeout(499)` from undici under a faked setTimeout); that
//   timer would be lost when the real timers come back.
// - The window with faked timers never returns to the event loop: it waits on promise jobs only and
//   puts the real timers back before it returns. So no socket callback of an earlier real request can
//   run while the timers are fake.
import { expect, vi } from 'vitest';

/** A fetch that never answers, and rejects like the real one when its signal aborts. */
export const hangingFetch = (init: RequestInit = {}) => new Promise<Response>((_resolve, reject) => {
  const abort = () => reject(new DOMException('This operation was aborted', 'AbortError'));
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
});

/**
 * Runs the promise jobs that are already queued, and the ones they queue, without returning to the event
 * loop. A hung request that was (wrongly) ended needs about ten of them to settle; 100 is a wide margin.
 */
const flushPromiseJobs = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};

/**
 * Starts `call` under a faked setTimeout/clearTimeout and proves that the client's own timeout of exactly
 * `timeoutMs` ends it: one timer is armed, the call is still pending at `timeoutMs - 1`, it settles when
 * the clock reaches `timeoutMs`, and no timer is left. Returns how the call settled.
 *
 * `call` must reach `hangingFetch`. The real timers are back when this returns or throws.
 */
export async function settledAtTimeout<T>(call: () => Promise<T>, timeoutMs: number): Promise<PromiseSettledResult<T>> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    let settled = false;
    const pending = call().finally(() => { settled = true; });
    pending.catch(() => {}); // the rejection is read through allSettled below
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(timeoutMs - 1);
    await flushPromiseJobs();
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1);
    await flushPromiseJobs();
    expect(settled).toBe(true); // fails here, not at the test timeout, when the call outlives its timeout
    const [outcome] = await Promise.allSettled([pending]);
    expect(vi.getTimerCount()).toBe(0);
    return outcome;
  } finally {
    vi.useRealTimers();
  }
}
