import { describe, expect, it } from 'vitest';
import type { Employee, Hub, Shipment, SimEvent } from '../../shared/types';
import { toTimelineRows } from '../../client/src/components/sim/timelineModel';

const emp = { id: 'emp-1', name: 'Maya Chen' } as Employee;
const hub: Hub = { id: 'hub-n', name: 'North Hub', nodeId: 'n-0-0' };
const ship = { id: 'shp-1', label: 'Contract envelope' } as Shipment;
const ev = (i: number, timeMin: number, kind: SimEvent['kind'], extra: Partial<SimEvent> = {}): SimEvent => ({
  id: `evt-${i}`, timeMin, shipmentId: 'shp-1', planId: 'plan-shp-1', jobId: 'j', kind,
  employeeId: 'emp-1', seq: i, ...extra,
});
const events = [
  ev(0, 1000, 'pickup'),
  ev(1, 1010, 'hub_drop', { hubId: 'hub-n' }),
  ev(2, 1020, 'hub_pickup', { hubId: 'hub-n' }),
  ev(3, 1020, 'delivered'),
];
const rows = (t: number, e = events) => toTimelineRows(e, t, [ship], [emp], [hub]);

describe('timeline model', () => {
  it('assigns done / next / upcoming and keeps input order', () => {
    const r = rows(1005);
    expect(r.map((x) => x.id)).toEqual(['evt-0', 'evt-1', 'evt-2', 'evt-3']);
    expect(r.map((x) => x.state)).toEqual(['done', 'next', 'upcoming', 'upcoming']);
  });
  it('treats event at exactly timeMin as done', () => {
    expect(rows(1010).map((x) => x.state)).toEqual(['done', 'done', 'next', 'next']);
  });
  it('marks all events sharing the next minute as next', () => {
    expect(rows(1010).filter((x) => x.state === 'next')).toHaveLength(2);
  });
  it('has no next when everything is done, all upcoming-or-next before start', () => {
    expect(rows(2000).every((x) => x.state === 'done')).toBe(true);
    expect(rows(0).map((x) => x.state)).toEqual(['next', 'upcoming', 'upcoming', 'upcoming']);
  });
  it('uses friendly names', () => {
    const t = rows(0).map((x) => x.text);
    expect(t[0]).toBe('Maya Chen picked up “Contract envelope”');
    expect(t[1]).toBe('Maya Chen dropped it at North Hub');
    expect(t[2]).toBe('Maya Chen collected it from North Hub');
    expect(t[3]).toBe('Maya Chen delivered it');
    expect(rows(0)[0].timeLabel).toBe('Day 1, 4:40 PM');
  });
  it('falls back neutrally when names are missing', () => {
    const r = toTimelineRows(events, 0, [], [], []);
    expect(r[0].text).toBe('A courier picked up a package');
    expect(r[1].text).toBe('A courier dropped a package at a hub');
    expect(r[2].text).toBe('A courier collected a package from a hub');
    expect(r[3].text).toBe('A courier delivered a package');
    for (const x of r) expect(x.text).not.toMatch(/emp-|hub-|shp-|n-\d/);
  });
  it('handles empty input', () => {
    expect(rows(0, [])).toEqual([]);
  });
});
