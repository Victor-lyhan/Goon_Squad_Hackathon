// The fetch core of client/src/api (http.ts) against a fake fetch: method, path, JSON body and error mapping
// of `request`. The route helpers that use it are covered in v2-client-routes and v2-client-errors.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, request } from '../../client/src/api/http';
import * as index from '../../client/src/api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);

afterEach(() => vi.unstubAllGlobals());

describe('api client: the fetch core', () => {
  it('a POST sends the body as JSON to the given path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(201, { matched: false }));
    vi.stubGlobal('fetch', fetchMock);
    const req = {
      clientRequestId: 'r1', originBusinessId: 'a', destinationBusinessId: 'b', label: 'L',
      category: 'envelope' as const, description: 'd', weightKg: 0.5, readyMin: 10, deadlineMin: 100,
    };
    await request('POST', '/api/v2/shipments', req);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v2/shipments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(req);
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('a PUT keeps its method and returns the parsed answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { rematchedShipmentIds: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await request<{ rematchedShipmentIds: string[] }>('PUT', '/api/v2/employees/emp-1/commute', { maxExtraMin: 5 });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v2/employees/emp-1/commute');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ maxExtraMin: 5 });
    expect(out.rematchedShipmentIds).toEqual([]);
  });

  it('returns parsed JSON on success and sends no body for GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { businesses: [] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await request('GET', '/api/v2/businesses')).toEqual({ businesses: [] });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('throws ApiRequestError with fieldErrors on 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json(400, { error: 'Invalid request', fieldErrors: { weightKg: 'Max 2 kg' } })));
    const err = await caught(request('GET', '/api/v2/jobs/j1'));
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Invalid request');
    expect(err.fieldErrors).toEqual({ weightKg: 'Max 2 kg' });
  });

  it('throws status 0 on network failure and tolerates non-JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const e1 = await caught(request('GET', '/api/v2/businesses'));
    expect(e1).toBeInstanceOf(ApiRequestError);
    expect(e1.status).toBe(0);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 502 })));
    const e2 = await caught(request('GET', '/api/v2/businesses'));
    expect(e2.status).toBe(502);
    expect(e2.fieldErrors).toBeUndefined();
  });
});

describe('api client: what the index exports after the MVP 1 helpers were deleted', () => {
  const CORE = ['ApiRequestError', 'DEFAULT_TIMEOUT_MS', 'apiConfig', 'isAbortError', 'isNetworkError', 'probeHealth', 'request'];

  it('the index holds the fetch core and nothing else', () => {
    expect(Object.keys(index).sort()).toEqual(CORE);
    expect(index.request).toBe(request);
    expect(index.ApiRequestError).toBe(ApiRequestError);
  });

  it('the only path the index itself calls is /api/health', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await index.probeHealth()).toBe(true);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/health']);
  });
});
