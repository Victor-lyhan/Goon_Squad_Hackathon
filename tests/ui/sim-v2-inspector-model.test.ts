import { describe, expect, it } from 'vitest';
import { businessInspector, employeeInspector } from '../../client/src/components/sim/v2/inspector/inspectorModel';
import { BIZ, EMP, UNMATCHED_REASON, makeMap, makeSim, shuffled } from './sim-v2-inspector-fixture';

const sim = makeSim();
const map = makeMap();
const ids = (rows: { shipmentId: string }[]) => rows.map((r) => r.shipmentId);

describe('businessInspector', () => {
  it('describes the business from the map response', () => {
    const m = businessInspector(BIZ.sender, sim, map)!;
    expect(m.name).toBe('Dumbo Print Studio');
    expect(m.kindLabel).toBe('Office');
    expect(m.ident).toBe('Office · Brooklyn');
    expect(m.address).toBe('55 Water St, Brooklyn, NY');
    expect(m.neighborhood).toBe('DUMBO');
    expect(m.borough).toBe('Brooklyn');
    expect(m.commuters).toBe(2);
    expect(m.commutersLabel).toBe('2 commuters work here');
    expect(businessInspector(BIZ.relay, sim, map)!.commutersLabel).toBe('1 commuter works here');
  });

  it('lists the sender\'s packages under Sent, with recipient, plan kind, status and ETA/delivered time', () => {
    const m = businessInspector(BIZ.sender, sim, map)!;
    expect(ids(m.sent)).toEqual(['shp-1', 'shp-2']);
    expect(ids(m.received)).toEqual(['shp-3']);
    expect(m.held).toEqual([]);

    const [direct, relay] = m.sent;
    expect(direct.parties).toEqual([{ role: 'To', business: { id: BIZ.recipient, name: 'Harlem Bakery' } }]);
    expect(direct.planKind).toBe('Direct');
    expect(direct.statusLabel).toBe('Delivered');
    expect(direct.timeLabel).toBe('Delivered Day 1, 6:02 PM');
    expect(direct.carriers).toEqual([{ id: EMP.maya, name: 'Maya Ortiz' }]);
    expect(direct.reason).toBeNull();

    expect(relay.planKind).toBe('Relay');
    expect(relay.statusLabel).toBe('At relay point');
    expect(relay.timeLabel).toBe('ETA Day 2, 8:12 AM');
    expect(relay.carriers.map((c) => c.name)).toEqual(['Jordan Lee', 'Maya Ortiz']);
  });

  it('lists the recipient\'s packages under Received with the sender as counterpart', () => {
    const m = businessInspector(BIZ.recipient, sim, map)!;
    expect(ids(m.received)).toEqual(['shp-1', 'shp-2']);
    expect(ids(m.sent)).toEqual(['shp-3']);
    expect(m.received[0].parties).toEqual([{ role: 'From', business: { id: BIZ.sender, name: 'Dumbo Print Studio' } }]);
  });

  it('gives an unmatched row its reason and no ETA', () => {
    const row = businessInspector(BIZ.recipient, sim, map)!.sent[0];
    expect(row.shipmentId).toBe('shp-3');
    expect(row.planKind).toBe('Not matched');
    expect(row.statusLabel).toBe('Not matched');
    expect(row.reason).toBe(UNMATCHED_REASON);
    expect(row.timeLabel).toBeNull();
    expect(row.carriers).toEqual([]);
  });

  it('lists a relay package only under "Held overnight as relay point" for the relay business', () => {
    const m = businessInspector(BIZ.relay, sim, map)!;
    expect(ids(m.held)).toEqual(['shp-2']);
    expect(m.sent).toEqual([]);
    expect(m.received).toEqual([]);
    expect(m.held[0].parties.map((p) => [p.role, p.business.name])).toEqual([
      ['From', 'Dumbo Print Studio'], ['To', 'Harlem Bakery'],
    ]);
    expect(m.held[0].statusLabel).toBe('At relay point');
  });

  it('returns null for an unknown business', () => {
    expect(businessInspector('biz-nope', sim, map)).toBeNull();
    expect(businessInspector(EMP.maya, sim, map)).toBeNull();
  });
});

describe('employeeInspector', () => {
  it('shows name, workplace and home neighborhood, never coordinates', () => {
    const m = employeeInspector(EMP.maya, sim, map)!;
    expect(m.name).toBe('Maya Ortiz');
    expect(m.ident).toBe('EMP-1');
    expect(m.workplace).toEqual({ id: BIZ.sender, name: 'Dumbo Print Studio' });
    expect(m.homeNeighborhood).toBe('Astoria');
    expect(JSON.stringify(m)).not.toMatch(/40\.\d|73\.\d|home-/);
  });

  it('gives one block per leg, in time order, with the API\'s numbers', () => {
    const m = employeeInspector(EMP.maya, sim, map)!;
    expect(m.legs.map((l) => [l.jobId, l.legLabel])).toEqual([
      ['plan-shp-1-L0', 'Direct'],
      ['plan-shp-2-L1', 'Relay leg 2 of 2'],
    ]);
    const [direct] = m.legs;
    expect(direct.packageLabel).toBe('Menu proofs');
    expect(direct.stops.map((s) => [s.timeLabel, s.place.name, s.isRelay])).toEqual([
      ['Day 1, 5:30 PM', 'Dumbo Print Studio', false],
      ['Day 1, 6:00 PM', 'Harlem Bakery', false],
    ]);
    expect(direct.finishLabel).toBe('Day 1, 6:30 PM');
    expect(direct.extraLabel).toBe('+6 min');
    expect(direct.rewardLabel).toBe('$4.50');
    expect(direct.statusLabel).toBe('Completed');
    expect(m.earnedLabel).toBe('$4.50');
    expect(m.totalRewardLabel).toBe('$9.70');
    expect(m.emptyMessage).toBeNull();
  });

  it('shows the relay stop first for relay leg 2, marked as relay point', () => {
    const leg = employeeInspector(EMP.maya, sim, map)!.legs[1];
    expect(leg.stops[0]).toMatchObject({ isRelay: true, kindLabel: 'Pickup at relay point',
      place: { id: BIZ.relay, name: 'LIC Bookshop' }, timeLabel: 'Day 2, 7:40 AM' });
    expect(leg.stops[1]).toMatchObject({ isRelay: false, kindLabel: 'Delivery', place: { name: 'Harlem Bakery' } });
    expect(leg.statusLabel).toBe('Assigned');
    expect(leg.finishLabel).toBe('Day 2, 8:15 AM');
  });

  it('marks the relay drop as the last stop of relay leg 1', () => {
    const m = employeeInspector(EMP.jordan, sim, map)!;
    expect(m.legs).toHaveLength(1);
    expect(m.legs[0].legLabel).toBe('Relay leg 1 of 2');
    expect(m.legs[0].stops.map((s) => s.isRelay)).toEqual([false, true]);
    expect(m.legs[0].stops[1].kindLabel).toBe('Drop at relay point');
  });

  it('says "No package on this commute." for an employee with no legs', () => {
    const m = employeeInspector(EMP.avery, sim, map)!;
    expect(m.legs).toEqual([]);
    expect(m.emptyMessage).toBe('No package on this commute.');
    expect(m.earnedLabel).toBe('$0.00');
    expect(m.totalRewardLabel).toBe('$0.00');
    expect(m.homeNeighborhood).toBe('Harlem');
  });

  it('returns null for an unknown employee', () => {
    expect(employeeInspector('emp-99', sim, map)).toBeNull();
    expect(employeeInspector(BIZ.sender, sim, map)).toBeNull();
  });
});

describe('stable order', () => {
  it('gives the same models when every input array is shuffled', () => {
    const [s2, m2] = shuffled(sim, map);
    for (const id of Object.values(BIZ)) expect(businessInspector(id, s2, m2)).toEqual(businessInspector(id, sim, map));
    for (const id of Object.values(EMP)) expect(employeeInspector(id, s2, m2)).toEqual(employeeInspector(id, sim, map));
  });
});
