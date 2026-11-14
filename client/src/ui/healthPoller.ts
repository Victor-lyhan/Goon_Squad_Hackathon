import { isAbortError } from '../api';

export type HealthProbe = (opts: { signal: AbortSignal }) => Promise<boolean>;

/**
 * One health tick at a time: a tick while a probe is pending is skipped, stop() aborts the
 * pending probe, and aborts are silent (never reported as a failure).
 */
export function createHealthPoller(probe: HealthProbe, onResult: (ok: boolean) => void) {
  const controller = new AbortController();
  let inFlight = false;
  return {
    async tick(): Promise<void> {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const ok = await probe({ signal: controller.signal });
        if (!controller.signal.aborted) onResult(ok);
      } catch (e) {
        if (!isAbortError(e) && !controller.signal.aborted) onResult(false);
      } finally {
        inFlight = false;
      }
    },
    stop(): void { controller.abort(); },
  };
}
