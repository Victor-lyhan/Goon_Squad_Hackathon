// Issue #513: the Employee commute route preview (#419, #463) built from the real GET /api/v2/map answer of the
// default NYC run, for every employee and each of their jobs opened with `?job=`.
// Route lines: the cached line when the map response has one. Without one the preview draws no line and says
// so (DECISIONS pass 44 and 50: "the map draws no line"; only a moving marker uses the straight line). No test
// may require a line for a given commute (pass 54), so both cases are accepted per commute and checked.
// Rules only: no story ID, name or count is pinned.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmployeeDashboard, EmployeeJobView, MapResponse } from '../../shared/v2/api';
import { ROUTE_NOT_LOADED, buildCommuteRoute, homeLabel } from '../../client/src/components/employee/v2/route/commuteRouteModel';
import { decodePath } from '../../client/src/components/map/layers';
import {
  T, at, buildRealRun, dashboardAt, expectCleanPage, readyState, renderPage, textOf, type RealRun,
} from './employee-v2-real-helper';

let real: RealRun;
/** Every employee's dashboard at the end of the run, when every job is on its carrier's page. */
let dashboards: EmployeeDashboard[];

beforeAll(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  real = buildRealRun();
  const end = at(real, real.run.scenario.settings.simEndMin);
  dashboards = end.run.scenario.employees.map((e) => dashboardAt(end, e.id));
}, T);
afterAll(() => vi.unstubAllEnvs());

const cachedLine = (map: MapResponse, from: string, to: string) =>
  map.polylines.find((p) => p.from === from && p.to === to)?.encoded ?? null;

const previewOf = (d: EmployeeDashboard, job: EmployeeJobView | null, map: MapResponse = real.map) =>
  buildCommuteRoute({ employee: d.employee, home: d.home, trips: d.trips, businesses: real.businesses, map, job });

describe('commute route preview on the real map response, every employee', () => {
  it('the map response is the run the dashboards belong to, and names only network businesses and homes in use', () => {
    expect(real.map.runId).toBe(real.run.runId);
    expect(real.map.businesses.map((b) => b.id).sort()).toStrictEqual(real.businesses.map((b) => b.id).sort());
    const homesInUse = new Set(real.run.scenario.employees.map((e) => e.homeId));
    for (const h of real.map.homes) expect(homesInUse.has(h.id)).toBe(true);
  }, T);

  it('has an evening and a morning line: the cached route line, or no line with the "not loaded" note', () => {
    let cached = 0;
    for (const d of dashboards) {
      const where = d.employee.id;
      const model = previewOf(d, null);
      expect(model.loading, where).toBe(false);
      let missing = false;
      for (const direction of ['evening', 'morning'] as const) {
        const trip = d.trips.find((t) => t.direction === direction);
        expect(trip, `${where}: no ${direction} trip`).toBeDefined();
        // The commute goes between the workplace and the home, in the trip's direction.
        const ends = direction === 'evening' ? [d.employee.businessId, d.home.id] : [d.home.id, d.employee.businessId];
        expect([trip!.originPlaceId, trip!.destinationPlaceId], where).toStrictEqual(ends);
        const encoded = cachedLine(real.map, trip!.originPlaceId, trip!.destinationPlaceId);
        const line = model.routes.find((r) => r.id === `commute-${direction}`);
        if (encoded) {
          cached += 1;
          expect(line, `${where} ${direction}`).toBeDefined();
          expect(line!.kind).toBe('baseline');
          expect(line!.path, `${where} ${direction}`).toStrictEqual(decodePath(encoded));
          for (const [lng, lat] of line!.path) expect(Number.isFinite(lng) && Number.isFinite(lat), where).toBe(true);
        } else {
          missing = true;
          expect(line, `${where} ${direction}: drawn without a cached line`).toBeUndefined();
        }
      }
      expect(model.notes.includes(ROUTE_NOT_LOADED), where).toBe(missing);
      // Both trips' own numbers are under the map, whether or not a line is drawn.
      expect(model.summary.map((s) => s.split(':')[0]), where).toStrictEqual(['Evening', 'Morning']);
    }
    expect(cached).toBeGreaterThan(0); // the committed cache has route lines at all
  }, T);

  it('puts the workplace and the home on the map, the home by neighborhood only', () => {
    for (const d of dashboards) {
      const where = d.employee.id;
      const model = previewOf(d, null);
      const work = real.map.businesses.find((b) => b.id === d.employee.businessId);
      expect(work, where).toBeDefined();
      expect(model.places.find((p) => p.id === work!.id), where).toMatchObject({ kind: 'business', lat: work!.lat, lng: work!.lng, label: work!.name });
      const home = model.places.find((p) => p.kind === 'home');
      expect(home, where).toBeDefined();
      expect(home!.label, where).toBe(homeLabel(d.home));
      expect(home!.label, where).toBe(`Home · ${d.home.neighborhood}`);
      expect(home!.sublabel, where).toBeUndefined();
      expect(model.fitTo, where).not.toBeNull();
    }
  }, T);

  it("numbers the open job's stops at businesses of the map response, with that leg's lines", () => {
    let jobs = 0;
    for (const d of dashboards) {
      for (const view of [...d.assigned, ...d.completed]) {
        jobs += 1;
        const where = `${d.employee.id} ${view.job.id}`;
        const leg = view.plan.legs[view.job.legIndex];
        const model = previewOf(d, view);
        expect(model.stops.length, where).toBe(leg.stops.length);
        leg.stops.forEach((s, i) => {
          const b = real.map.businesses.find((x) => x.id === s.placeId);
          expect(b, `${where}: stop ${i + 1} at ${s.placeId} is not a business of the map`).toBeDefined();
          expect(model.stops[i], where).toMatchObject({ n: i + 1, lat: b!.lat, lng: b!.lng });
          expect(model.stops[i].label, where).toContain(b!.name);
          expect(model.stopLabels[i].startsWith(`${i + 1} `), where).toBe(true);
          // A stop is on the map as a business place too, never as a home.
          expect(model.places.find((p) => p.id === b!.id)?.kind, where).toBe('business');
        });
        // The leg's lines: one per neighbouring pair that the map response has a line for.
        leg.placeIds.slice(1).forEach((to, i) => {
          const from = leg.placeIds[i];
          const encoded = cachedLine(real.map, from, to);
          const line = model.routes.find((r) => r.id === `job-${view.job.id}-${i}`);
          if (encoded) expect(line?.path, `${where} segment ${i}`).toStrictEqual(decodePath(encoded));
          else expect(line, `${where} segment ${i}`).toBeUndefined();
        });
      }
    }
    expect(jobs).toBe(real.run.jobs.length);
  }, T);

  it('without a cached line for a commute it draws no line and says so (DECISIONS pass 44, 50)', () => {
    const d = dashboards[0];
    const evening = d.trips.find((t) => t.direction === 'evening')!;
    const map: MapResponse = {
      ...real.map,
      polylines: real.map.polylines.map((p) => (p.from === evening.originPlaceId && p.to === evening.destinationPlaceId ? { ...p, encoded: null } : p)),
    };
    const model = previewOf(d, null, map);
    expect(model.routes.find((r) => r.id === 'commute-evening')).toBeUndefined();
    expect(model.notes).toContain(ROUTE_NOT_LOADED);
    // The trip's text is still there.
    expect(model.summary[0].startsWith('Evening: leaves')).toBe(true);
  }, T);

  it('renders the preview on the page with clean text for every employee and every open job', () => {
    const end = at(real, real.run.scenario.settings.simEndMin);
    for (const d of dashboards) {
      const html = renderPage(readyState(d, real.businesses, end.run.runId), null, real.map);
      expect(html, d.employee.id).toContain('aria-label="Your commute on the map"');
      const t = textOf(html);
      expect(t, d.employee.id).toMatch(/Evening: leaves \d{1,2}:\d{2} [ap]\.m\./);
      expect(t, d.employee.id).toMatch(/Morning: leaves \d{1,2}:\d{2} [ap]\.m\./);
      expectCleanPage(html, d.employee.id, real.run.scenario.homes, real.businesses);
    }
  }, T);
});
