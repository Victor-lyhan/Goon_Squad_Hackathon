// Error, timeout and abort behaviour of client/src/api/v2.ts against a fake fetch:
// 503 TravelUnavailable bodies expose `code`; everything else behaves like the MVP 1 client.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as v2 from '../../client/src/api/v2';
import * as v1 from '../../client/src/api';
import type { TravelUnavailable } from '../../shared/v2/api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const reply = (make: () => Response) => vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => make()));

/** A fetch that never answers, and rejects like the real one when its signal aborts. */
const hangingFetch = (_input: string, init: RequestInit = {}) => new Promise<Response>((_resolve, reject) => {
  const abort = () => reject(new DOMException('This operation was aborted', 'AbortError'));
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
});

const commute = {
  businessId: 'biz-a', home: { lat: 40.6722, lng: -73.9772, neighborhood: 'Park Slope' },
  eveningDepartureMin: 1050, morningDepartureMin: 1920, availableEvening: true, availableMorning: true, maxExtraMin: 8,
};
const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);

afterEach(() => {
  vi.unstubAllGlobals();
  v2.apiConfig.timeoutMs = v2.DEFAULT_TIMEOUT_MS;
});

describe('v2 client: 503 TravelUnavailable', () => {
  const bodies: TravelUnavailable[] = [
    { error: 'Address search needs a Google Maps key on the server', code: 'google_key_missing' },
    { error: 'No cached travel time for home-c-40.67220_-73.97720 -> biz-a', code: 'travel_data_missing' },
    { error: 'Google Routes did not answer', code: 'google_unavailable' },
  ];
  for (const body of bodies) {
    it(`${body.code}: status 503, code and the server's error text`, async () => {
      reply(() => json(503, body));
      const e = await caught(v2.putCommute('emp-1', commute));
      expect(e).toBeInstanceOf(v2.ApiRequestError);
      expect(e.status).toBe(503);
      expect(e.kind).toBe('http');
      expect(e.code).toBe(body.code);
      expect(e.message).toBe(body.error);
      expect(e.fieldErrors).toBeUndefined();
      expect(v2.isTravelUnavailable(e)).toBe(true);
      expect(v2.isNetworkError(e)).toBe(false);
      expect(v2.isAbortError(e)).toBe(false);
    });
  }

  it('geocode without a server key rejects as google_key_missing, and the guard narrows the code', async () => {
    reply(() => json(503, bodies[0]));
    const e: unknown = await caught(v2.geocode('350 5th Ave'));
    expect(v2.isTravelUnavailable(e)).toBe(true);
    if (v2.isTravelUnavailable(e)) {
      const code: TravelUnavailable['code'] = e.code; // typed by the guard
      expect(code).toBe('google_key_missing');
      expect(e.status).toBe(503);
    }
  });

  it('a 503 without a JSON body is an http error with status 503 and no code', async () => {
    reply(() => new Response('Service Unavailable', { status: 503 }));
    const e = await caught(v2.getSimulator());
    expect(e).toBeInstanceOf(v2.ApiRequestError);
    expect(e.status).toBe(503);
    expect(e.kind).toBe('http');
    expect(e.code).toBeUndefined();
    expect(e.message).toBe('Request failed (503)');
    expect(v2.isTravelUnavailable(e)).toBe(false);
    expect(v2.isNetworkError(e)).toBe(false);
  });

  it('isTravelUnavailable is false for a 503 JSON body without a contract code, other statuses and non-errors', async () => {
    reply(() => json(503, { error: 'Restarting' }));
    const noCode = await caught(v2.getMap());
    expect(noCode.status).toBe(503);
    expect(noCode.message).toBe('Restarting');
    expect(noCode.code).toBeUndefined();
    expect(v2.isTravelUnavailable(noCode)).toBe(false);

    reply(() => json(503, { error: 'Odd', code: 'something_else' }));
    expect(v2.isTravelUnavailable(await caught(v2.getMap()))).toBe(false);

    reply(() => json(400, { error: 'Bad', code: 'google_key_missing' }));
    expect(v2.isTravelUnavailable(await caught(v2.getMap()))).toBe(false);

    expect(v2.isTravelUnavailable(new Error('x'))).toBe(false);
    expect(v2.isTravelUnavailable({ status: 503, code: 'google_key_missing' })).toBe(false);
    expect(v2.isTravelUnavailable(undefined)).toBe(false);
  });
});

describe('v2 client: HTTP errors as in the MVP 1 client', () => {
  it('400 keeps the message and fieldErrors', async () => {
    reply(() => json(400, { error: 'Invalid request', fieldErrors: { q: 'Type at least 3 characters' } }));
    const e = await caught(v2.geocode('ab'));
    expect(e).toBeInstanceOf(v2.ApiRequestError);
    expect(e.status).toBe(400);
    expect(e.message).toBe('Invalid request');
    expect(e.fieldErrors).toEqual({ q: 'Type at least 3 characters' });
    expect(e.code).toBeUndefined();
  });

  it('404 and 409 expose status and the server message', async () => {
    reply(() => json(404, { error: 'Employee not found' }));
    const notFound = await caught(v2.getEmployeeDashboard('nope'));
    expect([notFound.status, notFound.message, notFound.kind]).toEqual([404, 'Employee not found', 'http']);

    reply(() => json(409, { error: 'The run is locked' }));
    const locked = await caught(v2.patchShipment('shp-1', { label: 'x' }));
    expect([locked.status, locked.message, locked.kind]).toEqual([409, 'The run is locked', 'http']);
    expect(v2.isNetworkError(locked)).toBe(false);
  });

  it('a non-JSON error body keeps the default message', async () => {
    reply(() => new Response('boom', { status: 502 }));
    const e = await caught(v2.getBusinesses());
    expect(e.status).toBe(502);
    expect(e.message).toBe('Request failed (502)');
    expect(e.fieldErrors).toBeUndefined();
  });

  it('errors are the same class as the MVP 1 client throws', () => {
    expect(v2.ApiRequestError).toBe(v1.ApiRequestError);
    expect(v2.isAbortError).toBe(v1.isAbortError);
    expect(v2.apiConfig).toBe(v1.apiConfig);
  });
});

describe('v2 client: network, timeout and abort', () => {
  it('a failed fetch is a network error with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const e = await caught(v2.getSimulator());
    expect(e).toBeInstanceOf(v2.ApiRequestError);
    expect([e.status, e.kind, e.message]).toEqual([0, 'network', 'fetch failed']);
    expect(v2.isNetworkError(e)).toBe(true);
    expect(v2.isAbortError(e)).toBe(false);
    expect(v2.isTravelUnavailable(e)).toBe(false);
  });

  it('times out with the shared apiConfig.timeoutMs (status 0, kind timeout, counts as a network error)', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    v2.apiConfig.timeoutMs = 40;
    const e = await caught(v2.getSimulator());
    expect(e).toBeInstanceOf(v2.ApiRequestError);
    expect([e.status, e.kind]).toEqual([0, 'timeout']);
    expect(e.message).toBe('Request timed out after 40 ms');
    expect(v2.isNetworkError(e)).toBe(true);
    expect(v2.isAbortError(e)).toBe(false);
  });

  it('per-call timeoutMs overrides the default, also on a write', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const get = await caught(v2.geocode('350 5th Ave', { timeoutMs: 30 }));
    expect(get.kind).toBe('timeout');
    const put = await caught(v2.putCommute('emp-1', commute, { timeoutMs: 30 }));
    expect(put.kind).toBe('timeout');
    expect(put.message).toBe('Request timed out after 30 ms');
  });

  it('a timeout wins over a caller signal that was never aborted', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const ctl = new AbortController();
    const e = await caught(v2.getMap({ signal: ctl.signal, timeoutMs: 30 }));
    expect(e.kind).toBe('timeout');
    expect(ctl.signal.aborted).toBe(false);
  });

  it('an already-aborted signal rejects as abort, not as a network error', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const ctl = new AbortController();
    ctl.abort();
    const e = await caught(v2.getSimulator({ signal: ctl.signal }));
    expect(e).toBeInstanceOf(v2.ApiRequestError);
    expect([e.status, e.kind]).toEqual([0, 'abort']);
    expect(v2.isAbortError(e)).toBe(true);
    expect(v2.isNetworkError(e)).toBe(false);
  });

  it('geocode: aborting an in-flight search stays silent (isAbortError), e.g. on the next keystroke', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const ctl = new AbortController();
    const p = caught(v2.geocode('350 5th', { signal: ctl.signal }));
    setTimeout(() => ctl.abort(), 20);
    const e = await p;
    expect(v2.isAbortError(e)).toBe(true);
    expect(v2.isNetworkError(e)).toBe(false);
    expect(v2.isTravelUnavailable(e)).toBe(false);
    expect(e.status).toBe(0);
  });

  it('an abort during a 503 reply is still reported as abort', async () => {
    const ctl = new AbortController();
    vi.stubGlobal('fetch', async () => {
      ctl.abort();
      return json(503, { error: 'No key', code: 'google_key_missing' });
    });
    const e = await caught(v2.geocode('350 5th Ave', { signal: ctl.signal }));
    expect(v2.isAbortError(e)).toBe(true);
    expect(v2.isTravelUnavailable(e)).toBe(false);
  });
});

describe('the index after the MVP 1 helpers were deleted (#628)', () => {
  it('calls the given path unchanged and gives no code on an error without one', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(404, { error: 'Not found' }));
    vi.stubGlobal('fetch', fetchMock);
    const e = await caught(v1.request('GET', '/api/jobs/j1'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/jobs/j1');
    expect([e.status, e.message, e.code]).toEqual([404, 'Not found', undefined]);
  });

  it('the index does not export the v2-only names', () => {
    expect(Object.keys(v1)).not.toContain('geocode');
    expect(Object.keys(v1)).not.toContain('isTravelUnavailable');
  });
});
