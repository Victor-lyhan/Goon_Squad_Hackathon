import { afterEach, describe, expect, it, vi } from 'vitest';
import { nycWorkspacePaths, startNycSummary, type NycSummary } from '../../client/src/pages/landingModel';
import { businesses, employees, simulator, travelMissingBody } from './landing-nyc-sample';

const BODIES: Record<string, unknown> = {
  '/api/v2/businesses': businesses, '/api/v2/employees': employees, '/api/v2/simulator': simulator,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(answer: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => { calls.push({ url, init }); return answer(url, init); }));
  return calls;
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const until = async (f: () => boolean) => { for (let i = 0; i < 50 && !f(); i++) await settle(); };

afterEach(() => { vi.unstubAllGlobals(); });

describe('startNycSummary', () => {
  it('requests only the three /api/v2 reads (never an MVP 1 path) and reports metrics from the response', async () => {
    const calls = stubFetch(async (url) => json(BODIES[url]));
    const seen: NycSummary[] = [];
    startNycSummary((s) => seen.push(s));
    await until(() => seen.length > 0);
    expect(calls.map((c) => c.url).sort()).toEqual(['/api/v2/businesses', '/api/v2/employees', '/api/v2/simulator']);
    for (const c of calls) { expect(c.url.startsWith('/api/v2/')).toBe(true); expect(c.init.method).toBe('GET'); }
    expect(seen).toEqual([{
      status: 'ready', businesses: 5, commuters: 3, relayPoints: 5, matched: 19, requested: 24, firstEmployeeId: 'emp-7',
    }]);
    expect(nycWorkspacePaths(seen[0])).toEqual({ business: null, employee: '/nyc/employee/emp-7', simulator: '/nyc/simulator' });
  });

  it('503 travel_data_missing gives the unavailable state', async () => {
    stubFetch(async (url) => (url === '/api/v2/simulator' ? json(travelMissingBody, 503) : json(BODIES[url])));
    const seen: NycSummary[] = [];
    startNycSummary((s) => seen.push(s));
    await until(() => seen.length > 0);
    expect(seen).toEqual([{ status: 'unavailable' }]);
    expect(nycWorkspacePaths(seen[0])).toEqual({ business: null, employee: null, simulator: '/nyc/simulator' });
  });

  it('a 503 without a travel code is a plain error', async () => {
    stubFetch(async () => json({ error: 'busy' }, 503));
    const seen: NycSummary[] = [];
    startNycSummary((s) => seen.push(s));
    await until(() => seen.length > 0);
    expect(seen).toEqual([{ status: 'error' }]);
  });

  it('the cleanup aborts all three requests and nothing is reported afterwards', async () => {
    const calls = stubFetch((_url, init) => new Promise<Response>((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')));
    }));
    const seen: NycSummary[] = [];
    const stop = startNycSummary((s) => seen.push(s));
    await settle();
    expect(calls).toHaveLength(3);
    stop();
    await settle(); await settle();
    for (const c of calls) expect(c.init.signal!.aborted).toBe(true);
    expect(seen).toEqual([]);
  });

  it('a late answer after the cleanup is ignored', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    stubFetch(async (url) => { await gate; return json(BODIES[url]); });
    const seen: NycSummary[] = [];
    const stop = startNycSummary((s) => seen.push(s));
    stop();
    release();
    await settle(); await settle();
    expect(seen).toEqual([]);
  });
});
