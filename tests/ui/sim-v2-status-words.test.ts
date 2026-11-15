// #635 (DECISIONS pass 62): the simulator names a package in the same words in the left list and in the
// two inspectors, and those words are the Business workspace's. One map: sim/v2/packages/statusText.ts.
// A status the snapshot does not have reads "Status unavailable"; the client never derives one from the plan.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detailSteps } from '../../client/src/components/business/v2/deliveryDetailsModel';
import { shipmentStatusLabel } from '../../client/src/components/business/v2/shipmentsTableModel';
import {
  SHIPMENT_STATUS_LABEL, businessInspector, employeeInspector,
} from '../../client/src/components/sim/v2/inspector/inspectorModel';
import {
  STATUS_ORDER, buildPackageRows, packageStatusLabel, statusFilters, toListItems,
} from '../../client/src/components/sim/v2/packages/packageListModel';
import {
  NO_MATCH, SHIPMENT_STATUS_TEXT, STATUS_UNAVAILABLE, UNTITLED_PACKAGE, knownStatus, packageName, shipmentStatusText,
} from '../../client/src/components/sim/v2/packages/statusText';
import type { ShipmentView, SimulatorResponse } from '../../shared/v2/api';
import type { ShipmentProgress } from '../../shared/v2/types';
import { BIZ, EMP, makeMap, makeSim } from './sim-v2-inspector-fixture';

// Every value of ShipmentProgress. The Record type makes a new enum value a type error here.
const ALL: Record<ShipmentProgress, true> = {
  unmatched: true, scheduled: true, picked_up: true, at_hub: true, out_for_delivery: true, delivered: true,
};
const STATUSES = Object.keys(ALL) as ShipmentProgress[];

const map = makeMap();

/** The fixture with the snapshot's shipment statuses replaced (a missing key = the snapshot has none). */
function simWith(status: Record<string, ShipmentProgress>, edit: (s: SimulatorResponse) => void = () => {}): SimulatorResponse {
  const sim = makeSim();
  sim.snapshot = { ...sim.snapshot, shipmentStatus: status };
  edit(sim);
  return sim;
}

const listRow = (sim: SimulatorResponse, id: string) => buildPackageRows(sim, map).find((r) => r.id === id)!;
/** shp-1 (direct) and shp-2 (relay) are sent by BIZ.sender, shp-3 (no plan) by BIZ.recipient. */
const inspectorRow = (sim: SimulatorResponse, id: string) => {
  const sender = id === 'shp-3' ? BIZ.recipient : BIZ.sender;
  return businessInspector(sender, sim, map)!.sent.find((r) => r.shipmentId === id)!;
};

describe('the one map of status words', () => {
  it('has the words of the Business workspace', () => {
    expect(SHIPMENT_STATUS_TEXT).toEqual({
      unmatched: 'Unmatched',
      scheduled: 'Scheduled',
      picked_up: 'Picked up',
      at_hub: 'At relay point',
      out_for_delivery: 'Out for delivery',
      delivered: 'Delivered',
    });
    expect(Object.keys(SHIPMENT_STATUS_TEXT).sort()).toEqual([...STATUSES].sort());
    for (const s of STATUSES) expect(SHIPMENT_STATUS_TEXT[s]).toBe(shipmentStatusLabel(s));
    // The Business delivery details name their steps with the same words.
    const steps = detailSteps({ plan: { kind: 'relay' }, status: 'scheduled' } as unknown as ShipmentView);
    expect(steps.length).toBe(5);
    for (const step of steps) expect(SHIPMENT_STATUS_TEXT[step.key]).toBe(step.label);
  });

  it('is the map the list and the inspector read', () => {
    expect(SHIPMENT_STATUS_LABEL).toBe(SHIPMENT_STATUS_TEXT);
    for (const s of STATUSES) expect(packageStatusLabel(s)).toBe(SHIPMENT_STATUS_TEXT[s]);
    expect([...STATUS_ORDER].sort()).toEqual([...STATUSES].sort());
  });

  it('says "No match", "Status unavailable" and "Untitled package"', () => {
    expect(NO_MATCH).toBe('No match');
    expect(STATUS_UNAVAILABLE).toBe('Status unavailable');
    expect(UNTITLED_PACKAGE).toBe('Untitled package');
  });

  it('a value that is not a status is never looked up or guessed', () => {
    for (const v of [undefined, null, '', 'lost', 'toString', 'constructor', 3, {}]) {
      expect(knownStatus(v)).toBeNull();
      expect(shipmentStatusText(v)).toBe('Status unavailable');
    }
    for (const s of STATUSES) expect(knownStatus(s)).toBe(s);
  });

  it('names a package with its label, or "Untitled package"', () => {
    expect(packageName('Menu proofs')).toBe('Menu proofs');
    for (const v of ['', '   ', undefined, null]) expect(packageName(v)).toBe('Untitled package');
  });
});

describe('the list and the inspector give the same words', () => {
  it.each(STATUSES)('status %s: the same label on a direct, a relay and an unplanned package', (status) => {
    const sim = simWith({ 'shp-1': status, 'shp-2': status, 'shp-3': status });
    for (const id of ['shp-1', 'shp-2', 'shp-3']) {
      const inList = listRow(sim, id);
      const inInspector = inspectorRow(sim, id);
      expect(inList.status).toBe(status);
      expect(inList.statusLabel).toBe(SHIPMENT_STATUS_TEXT[status]);
      expect(inInspector.statusLabel).toBe(inList.statusLabel);
    }
    // The status filter chip of the list says the same word.
    const chips = statusFilters(buildPackageRows(sim, map));
    expect(chips).toEqual([
      { value: 'all', label: 'All', count: 3 },
      { value: status, label: SHIPMENT_STATUS_TEXT[status], count: 3 },
    ]);
  });

  it('a package without a plan is "No match" with status "Unmatched" in both', () => {
    const sim = makeSim();
    expect(listRow(sim, 'shp-3')).toMatchObject({ kind: 'none', kindLabel: 'No match', statusLabel: 'Unmatched' });
    expect(inspectorRow(sim, 'shp-3')).toMatchObject({ planKind: 'No match', statusLabel: 'Unmatched' });
    expect(JSON.stringify([buildPackageRows(sim, map), businessInspector(BIZ.recipient, sim, map)]))
      .not.toContain('Not matched');
  });

  it('a status missing from the snapshot reads "Status unavailable" in both, whatever the plan says', () => {
    const sim = simWith({});
    for (const id of ['shp-1', 'shp-2', 'shp-3']) {
      expect(listRow(sim, id).status).toBeNull();
      expect(listRow(sim, id).statusLabel).toBe('Status unavailable');
      expect(inspectorRow(sim, id).statusLabel).toBe('Status unavailable');
    }
    expect(toListItems(buildPackageRows(sim, map)).map((i) => i.statusLabel)).toEqual([
      'Status unavailable', 'Status unavailable', 'Status unavailable',
    ]);
    expect(toListItems(buildPackageRows(sim, map)).map((i) => i.routeLabel.split(' · ')[0])).toEqual([
      'Direct', 'Relay via LIC Bookshop', 'No match',
    ]);
    // No status is made up, so no status filter appears.
    expect(statusFilters(buildPackageRows(sim, map))).toEqual([{ value: 'all', label: 'All', count: 3 }]);
  });

  it('a status the client does not know reads "Status unavailable" in both', () => {
    const sim = simWith({ 'shp-1': 'lost' as ShipmentProgress });
    expect(listRow(sim, 'shp-1')).toMatchObject({ status: null, statusLabel: 'Status unavailable' });
    expect(inspectorRow(sim, 'shp-1').statusLabel).toBe('Status unavailable');
  });

  it('a package with an empty label reads "Untitled package" in the list and in both inspectors', () => {
    const sim = simWith(makeSim().snapshot.shipmentStatus, (s) => {
      s.shipments = s.shipments.map((x) => ({ ...x, label: x.id === 'shp-2' ? '   ' : '' }));
    });
    expect(buildPackageRows(sim, map).map((r) => r.label)).toEqual(Array(3).fill('Untitled package'));
    expect(toListItems(buildPackageRows(sim, map)).map((i) => i.label)).toEqual(Array(3).fill('Untitled package'));
    const business = businessInspector(BIZ.sender, sim, map)!;
    expect([...business.sent, ...business.received].map((r) => r.label)).toEqual(Array(3).fill('Untitled package'));
    expect(employeeInspector(EMP.maya, sim, map)!.legs.map((l) => l.packageLabel)).toEqual(Array(2).fill('Untitled package'));
  });
});

describe('copy', () => {
  const root = resolve(__dirname, '../../client/src/components/sim/v2');
  const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });

  it('"Not matched" is gone from the simulator', () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toContain('Not matched');
  });

  it('the list and the inspector models keep no status words of their own', () => {
    const models: [string, string][] = [
      ['packages/packageListModel.ts', "from './statusText'"],
      ['inspector/inspectorModel.ts', "from '../packages/statusText'"],
    ];
    for (const [f, importText] of models) {
      const src = readFileSync(join(root, f), 'utf8');
      expect(src, f).toContain(importText);
      for (const word of ["'Unmatched'", "'Scheduled'", "'Picked up'", "'At relay point'", "'Out for delivery'", "'Delivered'", "'No match'"]) {
        expect(src, `${f} ${word}`).not.toContain(word);
      }
      expect(src, f).not.toMatch(/\?\s*'scheduled'\s*:\s*'unmatched'/);
    }
  });
});
