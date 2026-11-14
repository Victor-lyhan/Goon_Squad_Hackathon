import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { progressAt } from '../../server/domain/v2/timeline.js';
import { createSnapshotAt, nextEventMin } from '../../server/domain/v2/simulation.js';
import { TestMovement, snapshotRun } from './sim-v2-snapshot-helper.js';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('v2 snapshot assembly', () => {
  it('composes matcher-derived progress, metrics, and injected movement at each phase', () => {
    const { run, travel } = snapshotRun();
    expect(run.assignments.plans.map((plan) => plan.kind)).toEqual(['direct', 'relay']);
    expect(run.assignments.unmatched.map(({ shipmentId }) => shipmentId)).toEqual(['shp-unmatched']);

    const movement = new TestMovement();
    const snapshotAt = createSnapshotAt(movement);
    const before = snapshotAt(run, 900, travel);
    const overnight = snapshotAt(run, 1500, travel);
    const overnightMarkers = movement.receivedMarkers;
    const end = snapshotAt(run, 2160, travel);

    for (const [timeMin, snapshot] of [[900, before], [1500, overnight], [2160, end]] as const) {
      const expected = progressAt({
        shipments: run.scenario.shipments, plans: run.assignments.plans, jobs: run.jobs, events: run.events,
      }, timeMin);
      expect(snapshot).toMatchObject(expected);
      expect(snapshot.metrics.delivered).toBeLessThanOrEqual(snapshot.metrics.matched);
      for (const value of Object.values(snapshot.metrics)) expect(value === null || Number.isFinite(value)).toBe(true);
    }

    expect(before.shipmentStatus).toMatchObject({
      'shp-direct': 'scheduled', 'shp-relay': 'scheduled', 'shp-unmatched': 'unmatched',
    });
    expect(overnight.shipmentStatus['shp-relay']).toBe('at_hub');
    expect(end.shipmentStatus).toMatchObject({ 'shp-direct': 'delivered', 'shp-relay': 'delivered' });
    expect(end.deliveredAtMin).toEqual({
      'shp-direct': run.assignments.plans[0]!.deliveryMin,
      'shp-relay': run.assignments.plans[1]!.deliveryMin,
    });
    expect(end.packagePositions).not.toHaveProperty('shp-unmatched');
    expect(overnight.markers).toEqual([{ employeeId: 'marker-employee', lat: 1500, lng: -1500, servicing: false }]);
    expect(overnight.packagePositions).toEqual({
      'shp-direct': { lat: 1500, lng: -1500 }, 'shp-relay': { lat: 40.7, lng: -73.9 },
    });
    expect(overnightMarkers).toBe(overnight.markers);
  });

  it('is deterministic, works with frozen inputs, and does not retain later progress when seeking backward', () => {
    const { run, travel } = snapshotRun();
    const snapshotAt = createSnapshotAt(new TestMovement());
    expect(snapshotAt(run, 1000, travel)).toEqual(snapshotAt(run, 1000, travel));
    expect(() => snapshotAt(deepFreeze(structuredClone(run)), 1000, travel)).not.toThrow();
    expect(snapshotAt(run, 2000, travel)).toBeDefined();
    expect(snapshotAt(run, 1000, travel)).toEqual(createSnapshotAt(new TestMovement())(run, 1000, travel));
  });

  it('finds the next strictly later timeline event', () => {
    const { run } = snapshotRun();
    const [first, second] = run.events;
    const last = run.events.at(-1)!;
    expect(nextEventMin(run, first!.timeMin - 1)).toBe(first!.timeMin);
    expect(nextEventMin(run, first!.timeMin)).toBe(second!.timeMin);
    expect(nextEventMin(run, second!.timeMin - 1)).toBe(second!.timeMin);
    expect(nextEventMin(run, last.timeMin)).toBeNull();
  });

  it('does not couple snapshot assembly to movement, IO, HTTP, or test travel data', () => {
    const source = readFileSync(new URL('../../server/domain/v2/simulation.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/import[^\n]*['"][^'"]*movement/);
    expect(source).not.toMatch(/import[^\n]*['"][^'"]*(?:fs|express|fakeProvider)/);
    expect(source).not.toContain('.durationMin(');
    expect(source).not.toContain('.distanceM(');
  });
});
