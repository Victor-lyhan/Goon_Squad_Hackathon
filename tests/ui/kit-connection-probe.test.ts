import { describe, expect, it } from 'vitest';
import { createHealthPoller } from '../../client/src/ui/healthPoller';
import { ApiRequestError } from '../../client/src/api';
import { initialConnection, nextConnection, type ConnectionState } from '../../client/src/ui/connectionModel';

function harness(probe: Parameters<typeof createHealthPoller>[0]) {
  let state: ConnectionState = initialConnection;
  const poller = createHealthPoller(probe, (ok) => { state = nextConnection(state, ok); });
  return { poller, get: () => state };
}
const abortErr = () => new ApiRequestError(0, 'Request aborted', undefined, 'abort');

describe('createHealthPoller', () => {
  it('ok stays online', async () => {
    const h = harness(async () => true);
    await h.poller.tick();
    expect(h.get()).toEqual(initialConnection);
  });
  it('two failures go offline', async () => {
    const h = harness(async () => false);
    await h.poller.tick();
    expect(h.get().status).toBe('online');
    await h.poller.tick();
    expect(h.get().status).toBe('offline');
  });
  it('abort after stop leaves state unchanged and records no failure', async () => {
    let signal!: AbortSignal;
    const h = harness((o) => new Promise((_, rej) => {
      signal = o.signal;
      o.signal.addEventListener('abort', () => rej(abortErr()));
    }));
    const p = h.poller.tick();
    h.poller.stop();
    await p;
    expect(signal.aborted).toBe(true);
    expect(h.get()).toEqual(initialConnection);
  });
  it('a late false result after stop is ignored', async () => {
    let resolve!: (v: boolean) => void;
    const h = harness(() => new Promise<boolean>((r) => { resolve = r; }));
    const p = h.poller.tick();
    h.poller.stop();
    resolve(false);
    await p;
    expect(h.get().failures).toBe(0);
  });
  it('skips overlapping ticks', async () => {
    let calls = 0;
    let resolve!: (v: boolean) => void;
    const h = harness(() => { calls++; return new Promise<boolean>((r) => { resolve = r; }); });
    const first = h.poller.tick();
    await h.poller.tick();
    await h.poller.tick();
    expect(calls).toBe(1);
    resolve(true);
    await first;
    const second = h.poller.tick();
    expect(calls).toBe(2);
    resolve(true);
    await second;
  });
});
