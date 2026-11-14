import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError, createShipment, getBusinesses, putCommute, getJob,
} from '../../client/src/api/client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('createShipment POSTs JSON to /api/shipments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(201, { matched: false }));
    vi.stubGlobal('fetch', fetchMock);
    const req = {
      clientRequestId: 'r1', originBusinessId: 'a', destinationBusinessId: 'b', label: 'L',
      category: 'envelope' as const, description: 'd', weightKg: 0.5, readyMin: 10, deadlineMin: 100,
    };
    await createShipment(req);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/shipments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(req);
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('putCommute PUTs to /api/employees/:id/commute', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { rematchedShipmentIds: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const req = {
      businessId: 'b', homeNodeId: 'n1', eveningDepartureMin: 1000, morningDepartureMin: 1900,
      availableEvening: true, availableMorning: false, maxExtraMin: 5,
    };
    const out = await putCommute('emp-1', req);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/employees/emp-1/commute');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual(req);
    expect(out.rematchedShipmentIds).toEqual([]);
  });

  it('returns parsed JSON on success and sends no body for GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { businesses: [], hubs: [] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getBusinesses()).toEqual({ businesses: [], hubs: [] });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('throws ApiRequestError with fieldErrors on 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json(400, { error: 'Invalid request', fieldErrors: { weightKg: 'Max 2 kg' } })));
    const err = await getJob('j1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Invalid request');
    expect(err.fieldErrors).toEqual({ weightKg: 'Max 2 kg' });
  });

  it('throws status 0 on network failure and tolerates non-JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const e1 = await getBusinesses().catch((e) => e);
    expect(e1).toBeInstanceOf(ApiRequestError);
    expect(e1.status).toBe(0);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 502 })));
    const e2 = await getBusinesses().catch((e) => e);
    expect(e2.status).toBe(502);
    expect(e2.fieldErrors).toBeUndefined();
  });
});
