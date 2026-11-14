// @vitest-environment jsdom
// The NYC homepage (`Landing dataset="nyc"`) on the REAL /api/v2 summary (#514): createV2Runtime on a copy of
// fixtures/nyc in a temp folder, no key, no network. The model is built by the real `startNycSummary`
// through client/src/api/v2.ts, and the page is mounted in a real DOM and loads the same numbers itself.
// No count is pinned (DECISIONS pass 54): the expectations are the API's own answers.
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BusinessesResponse, EmployeesResponse, SimulatorResponse } from '../../shared/v2/api';
import { getBusinesses, getEmployees, getSimulator } from '../../client/src/api/v2';
import Landing from '../../client/src/pages/Landing';
import { startNycSummary, type NycSummary } from '../../client/src/pages/landingModel';
import { T, forbiddenIn, startRealApi, type RealApi } from './business-v2-real-helper';
import { flush, mount } from './kitDom';

vi.setConfig({ testTimeout: T, hookTimeout: T });

let api: RealApi;
let b: BusinessesResponse;
let e: EmployeesResponse;
let sim: SimulatorResponse;

beforeAll(async () => {
  api = await startRealApi();
  [b, e, sim] = await Promise.all([getBusinesses(), getEmployees(), getSimulator()]);
});
afterAll(async () => { await api?.close(); });

const values = (html: string) => [...html.matchAll(/<dd class="op-summary-value">([^<]*)<\/dd>/g)].map((x) => x[1]);
const expectedValues = () => [
  String(b.businesses.length), String(e.employees.length), String(b.businesses.length),
  `${sim.snapshot.metrics.matched} / ${sim.snapshot.metrics.requested}`,
];

async function loadSummary(): Promise<NycSummary> {
  const seen: NycSummary[] = [];
  startNycSummary((s) => seen.push(s));
  for (let i = 0; i < 200 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  expect(seen.length).toBe(1);
  return seen[0];
}

describe('NYC homepage on the real /api/v2', () => {
  it('the real run has businesses, commuters and requests, and the metrics are finite', () => {
    expect(b.businesses.length).toBeGreaterThan(0);
    expect(e.employees.length).toBeGreaterThan(0);
    const { matched, requested } = sim.snapshot.metrics;
    expect(Number.isInteger(matched) && Number.isInteger(requested)).toBe(true);
    expect(requested).toBe(sim.shipments.length);
    expect(matched).toBe(sim.plans.length);
    expect(matched).toBeLessThanOrEqual(requested);
  });

  it('startNycSummary builds the model from the API: businesses, commuters, relay points, matched / requested', async () => {
    const before = api.requests.length;
    const summary = await loadSummary();
    expect(api.requests.slice(before).sort()).toEqual(['GET /api/v2/businesses', 'GET /api/v2/employees', 'GET /api/v2/simulator']);
    expect(summary).toEqual({
      status: 'ready',
      businesses: b.businesses.length,
      commuters: e.employees.length,
      relayPoints: b.businesses.length, // every network business is a relay point
      matched: sim.snapshot.metrics.matched,
      requested: sim.snapshot.metrics.requested,
      businessIds: b.businesses.map((x) => x.id),
      employeeIds: e.employees.map((x) => x.id),
    });

    const html = renderToStaticMarkup(<MemoryRouter><Landing dataset="nyc" initialSummary={summary} /></MemoryRouter>);
    expect(values(html)).toEqual(expectedValues());
    expect(html).toContain('Relay points');
    expect(html).toContain(`href="/employee/${encodeURIComponent(e.employees[0].id)}"`);
    expect(html).toContain(`href="/business/${encodeURIComponent(b.businesses[0].id)}"`);
    expect(forbiddenIn(html)).toEqual([]);
  });

  it('mounted in a real DOM, the page loads the same numbers itself, with no NaN', async () => {
    const m = mount(<MemoryRouter><Landing dataset="nyc" /></MemoryRouter>);
    for (let i = 0; i < 200 && values(m.container.innerHTML).length < 4; i++) await flush();
    expect(values(m.container.innerHTML)).toEqual(expectedValues());
    expect(m.container.innerHTML).not.toContain('aria-busy="true"');
    expect(forbiddenIn(m.container.innerHTML)).toEqual([]);
    expect(api.googleCalls).toEqual([]);
  });
});
