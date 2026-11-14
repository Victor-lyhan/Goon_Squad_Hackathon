import { describe, expect, it } from 'vitest';
import {
  ROUTE_NOT_LOADED, buildCommuteRoute, clockText, distanceText, tripLine,
} from '../../client/src/components/employee/v2/route/commuteRouteModel';
import { BUSINESSES, DASHBOARD, HOME, JOB, MAP, RELAY, SENDER, TRIPS, WORK, withLine } from './employee-v2-route-sample';

const base = { employee: DASHBOARD.employee, home: HOME, trips: TRIPS, businesses: BUSINESSES };

describe('buildCommuteRoute', () => {
  it('finds both commute lines by pair, faint, with no note', () => {
    const m = buildCommuteRoute({ ...base, map: MAP, job: null });
    expect(m.routes.map((r) => r.id)).toEqual(['commute-evening', 'commute-morning']);
    expect(m.routes.every((r) => r.kind === 'baseline')).toBe(true);
    const evening = m.routes[0].path;
    expect(evening[0]).toEqual([-73.984, 40.754]); // [lng, lat], starts at work
    expect(evening[evening.length - 1]).toEqual([-73.9235, 40.7644]); // ends at home
    expect(m.routes[1].path[0]).toEqual([-73.9235, 40.7644]); // morning starts at home
    expect(m.notes).toEqual([]);
    expect(m.loading).toBe(false);
    expect(m.stops).toEqual([]);
  });

  it('a null or missing line draws no route and adds the note once', () => {
    const m = buildCommuteRoute({ ...base, map: withLine(HOME.id, WORK.id, null), job: null });
    expect(m.routes.map((r) => r.id)).toEqual(['commute-evening']);
    expect(m.notes).toEqual([ROUTE_NOT_LOADED]);

    const none = buildCommuteRoute({ ...base, map: { ...MAP, polylines: [] }, job: null });
    expect(none.routes).toEqual([]);
    expect(none.notes).toEqual(['Route line not loaded yet']);
  });

  it('labels the workplace by name and the home by neighborhood only', () => {
    const m = buildCommuteRoute({ ...base, map: MAP, job: null });
    expect(m.places).toHaveLength(2);
    const work = m.places.find((p) => p.kind === 'business')!;
    expect(work.label).toBe('Acme Studio');
    const home = m.places.find((p) => p.kind === 'home')!;
    expect(home.label).toBe('Home · Astoria');
    expect(home.label).not.toMatch(/\d/);
    expect(home.sublabel ?? '').not.toMatch(/\d/);
    expect(JSON.stringify(m.places)).not.toContain('Sample Ave');
  });

  it('with a relay leg-1 job: numbered pickup then relay point, accent leg over the commute', () => {
    const m = buildCommuteRoute({ ...base, map: MAP, job: JOB });
    expect(m.stopLabels).toEqual(['1 Pickup · Bakery Row', '2 Drop at relay point · Atlas Books']);
    expect(m.stops.map((s) => [s.n, s.lat, s.lng])).toEqual([[1, SENDER.lat, SENDER.lng], [2, RELAY.lat, RELAY.lng]]);
    expect(m.stops[1].label).toBe('Drop at relay point · Atlas Books');
    const legs = m.routes.filter((r) => r.kind === 'leg');
    expect(legs).toHaveLength(3);
    expect(legs.every((r) => r.tone === 'leg1')).toBe(true);
    // Faint commute is drawn first (below), the job's leg after it.
    expect(m.routes.slice(0, 2).every((r) => r.kind === 'baseline')).toBe(true);
    expect(m.notes).toEqual([]);
  });

  it('a missing job-leg line draws no line for that segment and adds the note', () => {
    const m = buildCommuteRoute({ ...base, map: withLine(SENDER.id, RELAY.id, null), job: JOB });
    expect(m.routes.filter((r) => r.kind === 'leg')).toHaveLength(2);
    expect(m.notes).toEqual([ROUTE_NOT_LOADED]);
  });

  it('an unknown stop place reads "Unknown place" and gets no marker', () => {
    const job = { ...JOB, plan: { ...JOB.plan, legs: [{ ...JOB.plan.legs[0], stops: [{ ...JOB.job.pickup, placeId: 'biz-gone' }] }] } };
    const m = buildCommuteRoute({ ...base, map: MAP, job });
    expect(m.stopLabels).toEqual(['1 Pickup · Unknown place']);
    expect(m.stops).toEqual([]);
  });

  it('bounds contain every place shown', () => {
    for (const job of [null, JOB]) {
      const m = buildCommuteRoute({ ...base, map: MAP, job });
      const b = m.fitTo!;
      expect(b).not.toBeNull();
      for (const p of m.places) {
        expect(p.lat).toBeGreaterThanOrEqual(b.south);
        expect(p.lat).toBeLessThanOrEqual(b.north);
        expect(p.lng).toBeGreaterThanOrEqual(b.west);
        expect(p.lng).toBeLessThanOrEqual(b.east);
      }
      for (const s of m.stops) expect(m.places.some((p) => p.lat === s.lat && p.lng === s.lng)).toBe(true);
    }
  });

  it('map: null returns no routes, no note, loading, and does not throw', () => {
    const m = buildCommuteRoute({ ...base, map: null, job: JOB });
    expect(m.routes).toEqual([]);
    expect(m.notes).toEqual([]);
    expect(m.loading).toBe(true);
    expect(m.summary).toHaveLength(2);
    expect(m.stopLabels).toHaveLength(2);
  });

  it('summary lines use only the trips own fields', () => {
    const m = buildCommuteRoute({ ...base, map: MAP, job: null });
    expect(m.summary).toEqual([
      'Evening: leaves 5:30 p.m., 34 min, 9.8 km',
      'Morning: leaves 8:30 a.m., 31 min, 9.7 km',
    ]);
    const changed = buildCommuteRoute({ ...base, trips: [{ ...TRIPS[0], baselineDurationMin: 41 }], map: MAP, job: null });
    expect(changed.summary).toEqual(['Evening: leaves 5:30 p.m., 41 min, 9.8 km']);
  });

  it('marks a direction the employee is not available in', () => {
    const employee = { ...DASHBOARD.employee, availableMorning: false };
    const m = buildCommuteRoute({ ...base, employee, map: MAP, job: null });
    expect(m.summary[1]).toBe('Morning: leaves 8:30 a.m., 31 min, 9.7 km (not available for deliveries)');
  });
});

describe('formatters', () => {
  it('clock, distance and trip line', () => {
    expect(clockText(720)).toBe('12:00 p.m.');
    expect(clockText(1440)).toBe('12:00 a.m.');
    expect(distanceText(850)).toBe('850 m');
    expect(distanceText(12000)).toBe('12 km');
    expect(tripLine(TRIPS[0])).toBe('Evening: leaves 5:30 p.m., 34 min, 9.8 km');
  });
});

describe('stopLabel', () => {
  it('names every stop kind in UI copy', async () => {
    const { stopLabel } = await import('../../client/src/components/employee/v2/route/commuteRouteModel');
    expect(stopLabel('pickup')).toBe('Pickup');
    expect(stopLabel('hub_drop')).toBe('Drop at relay point');
    expect(stopLabel('hub_pickup')).toBe('Pickup at relay point');
    expect(stopLabel('delivery')).toBe('Deliver');
  });
});
