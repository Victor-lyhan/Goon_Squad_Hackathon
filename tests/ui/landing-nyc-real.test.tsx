// @vitest-environment jsdom
// The NYC homepage (`Landing dataset="nyc"`) on the REAL /api/v2 summary (#514): createV2Runtime on a copy of
// fixtures/nyc in a temp folder, no key, no network. The model is built by the real `startNycSummary`
// through client/src/api/v2.ts, and the page is mounted in a real DOM and loads the same numbers itself.
// No count is pinned (DECISIONS pass 54): the expectations are the API's own answers.
// #652: "Watch a package" opens the default run's story package, found by the label the app code names.
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BusinessesResponse, EmployeesResponse, SimulatorResponse } from '../../shared/v2/api';
import { getBusinesses, getEmployees, getSimulator } from '../../client/src/api/v2';
import Landing from '../../client/src/pages/Landing';
import { WATCH_PACKAGE_LABEL, startNycSummary, watchPackageHref, type NycSummary } from '../../client/src/pages/landingModel';
import { parseSimUrl } from '../../client/src/components/sim/v2/page/urlState';
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

const values = (html: string) => [...html.matchAll(/<span class="op-summary-value">([^<]*)<\/span>/g)].map((x) => x[1]);
const expectedValues = () => [
  String(b.businesses.length), String(e.employees.length),
  String(sim.snapshot.metrics.matched), String(sim.snapshot.metrics.requested),
];
/** The default run's story package, by the label the homepage looks for. */
const storyPackage = () => sim.shipments.filter((s) => s.label === WATCH_PACKAGE_LABEL);

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
      matched: sim.snapshot.metrics.matched,
      requested: sim.snapshot.metrics.requested,
      businessIds: b.businesses.map((x) => x.id),
      employeeIds: e.employees.map((x) => x.id),
      watchPackageId: storyPackage()[0].id,
    });

    const html = renderToStaticMarkup(<MemoryRouter><Landing dataset="nyc" initialSummary={summary} /></MemoryRouter>);
    expect(values(html)).toEqual(expectedValues());
    expect(html).toContain(`href="/employee/${encodeURIComponent(e.employees[0].id)}"`);
    expect(html).toContain(`href="/business/${encodeURIComponent(b.businesses[0].id)}"`);
    expect(forbiddenIn(html)).toEqual([]);
  });

  it('the default run has the story package once, and the API plans it as a relay (#652)', () => {
    expect(storyPackage()).toHaveLength(1);
    const plans = sim.plans.filter((p) => p.shipmentId === storyPackage()[0].id);
    expect(plans.map((p) => p.kind)).toEqual(['relay']);
  });

  it('"Watch a package" links to that package with play=1, and the simulator reads the link as its journey', async () => {
    const href = watchPackageHref(await loadSummary());
    const id = storyPackage()[0].id;
    expect(href).toBe(`/simulator?package=${encodeURIComponent(id)}&play=1`);
    expect(parseSimUrl(href.slice(href.indexOf('?')))).toEqual({ selection: { kind: 'package', id }, mode: 'journey' });
  });

  it('mounted in a real DOM, the page loads the same numbers itself, with no NaN, and the button gets the story link', async () => {
    const m = mount(<MemoryRouter><Landing dataset="nyc" /></MemoryRouter>);
    const button = () => m.container.querySelector('a.watch-button')!;
    expect(button().getAttribute('href')).toBe('/simulator'); // before the answer
    for (let i = 0; i < 200 && values(m.container.innerHTML).length < 4; i++) await flush();
    expect(values(m.container.innerHTML)).toEqual(expectedValues());
    expect(button().getAttribute('href')).toBe(`/simulator?package=${encodeURIComponent(storyPackage()[0].id)}&play=1`);
    expect(m.container.querySelectorAll('a[href]')).toHaveLength(4); // the button, Business, Employee, The numbers (#796)
    expect(m.container.innerHTML).not.toContain('aria-busy="true"');
    expect(forbiddenIn(m.container.innerHTML)).toEqual([]);
    expect(api.googleCalls).toEqual([]);
  });
});
