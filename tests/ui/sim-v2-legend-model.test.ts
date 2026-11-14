import { describe, expect, it } from 'vitest';
import {
  ALL_HIDDEN_MESSAGE,
  legendRows,
  showsHiddenMessage,
  type LegendRow,
} from '../../client/src/components/sim/v2/legend/legendModel';
import { DEFAULT_LAYERS, LAYERS, type LayerKey, type LayerVisibility } from '../../client/src/components/sim/v2/workspaceModel';

const ALL_ON: LayerVisibility = { ...DEFAULT_LAYERS };
const ALL_OFF: LayerVisibility = { routes: false, businesses: false, homes: false, packages: false };
const keys = (rows: LegendRow[]) => rows.map((r) => r.key);

/** Which rows each layer toggle owns in network mode. */
const OWNED: Record<LayerKey, string[]> = {
  businesses: ['business'],
  homes: ['home'],
  packages: ['package'],
  routes: ['baseline', 'route'],
};

function assertCleanLabels(rows: LegendRow[]) {
  for (const r of rows) {
    expect(r.label).not.toMatch(/\bhubs?\b/i);
    expect(r.label).not.toMatch(/undefined|null|NaN/);
    expect(r.label).not.toMatch(/\b(biz|home|emp|shp|plan|leg)-[\w-]+/); // no raw IDs
    expect(r.label).not.toMatch(/home address/i);
    expect(r.label.trim()).toBe(r.label);
    expect(r.label.length).toBeGreaterThan(0);
  }
}

describe('legendRows: network mode', () => {
  it('lists every marker and line in a fixed order with all layers on', () => {
    const rows = legendRows({ mode: 'network', layers: ALL_ON });
    expect(keys(rows)).toEqual(['business', 'home', 'vehicle', 'package', 'baseline', 'route']);
    expect(rows.map((r) => r.label)).toEqual([
      'Network business · every one is a relay point',
      'Home neighborhood',
      'Commuter vehicle',
      'Package',
      'Normal commute',
      'Delivery route',
    ]);
    expect(rows.map((r) => r.shape)).toEqual(['dot', 'dot', 'dot', 'dot', 'line', 'line']);
    expect(showsHiddenMessage({ mode: 'network', layers: ALL_ON })).toBe(false);
    assertCleanLabels(rows);
  });

  it('every row has a key, label, shape and a CSS color string; keys are unique', () => {
    const rows = legendRows({ mode: 'network', layers: ALL_ON, hasSelection: true });
    expect(new Set(keys(rows)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.key).toMatch(/^[a-z0-9]+$/);
      expect(['dot', 'ring', 'line', 'numbered']).toContain(r.shape);
      expect(r.color).toMatch(/^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\)$/);
      if (r.shape === 'line') expect(r.width).toBeGreaterThan(0);
    }
  });

  it.each(LAYERS.map((l) => l.key))('turning off %s removes exactly its rows', (key) => {
    const all = keys(legendRows({ mode: 'network', layers: ALL_ON }));
    const rows = keys(legendRows({ mode: 'network', layers: { ...ALL_ON, [key]: false } }));
    expect(rows).toEqual(all.filter((k) => !OWNED[key].includes(k)));
    expect(showsHiddenMessage({ mode: 'network', layers: { ...ALL_ON, [key]: false } })).toBe(false);
  });

  it('keeps the vehicle row while any one layer is on (vehicles have no toggle)', () => {
    for (const { key } of LAYERS) {
      const rows = keys(legendRows({ mode: 'network', layers: { ...ALL_OFF, [key]: true } }));
      expect(rows).toEqual(['business', 'home', 'vehicle', 'package', 'baseline', 'route'].filter(
        (k) => k === 'vehicle' || OWNED[key].includes(k),
      ));
    }
  });

  it('all layers off gives no rows and the hidden message state', () => {
    expect(legendRows({ mode: 'network', layers: ALL_OFF })).toEqual([]);
    expect(legendRows({ mode: 'network', layers: ALL_OFF, hasSelection: true })).toEqual([]);
    expect(showsHiddenMessage({ mode: 'network', layers: ALL_OFF })).toBe(true);
    expect(ALL_HIDDEN_MESSAGE).toBe('All map layers are hidden. Turn a layer on in the left panel.');
  });

  it('a selection adds the dimmed row last', () => {
    const rows = legendRows({ mode: 'network', layers: ALL_ON, hasSelection: true });
    expect(keys(rows)).toEqual(['business', 'home', 'vehicle', 'package', 'baseline', 'route', 'dimmed']);
    expect(rows.at(-1)!.label).toBe('Dimmed: not part of the selection');
  });

  it('a focus adds the dimmed row "of this focus"; no focus adds nothing', () => {
    for (const focus of [{ kind: 'employee', id: 'emp-0007' }, { kind: 'business', id: 'biz-0003' }] as const) {
      const rows = legendRows({ mode: 'network', layers: ALL_ON, focus });
      expect(rows.at(-1)).toMatchObject({ key: 'dimmed', label: 'Dimmed: not part of this focus' });
      assertCleanLabels(rows);
    }
    expect(keys(legendRows({ mode: 'network', layers: ALL_ON, focus: { kind: 'none' } }))).not.toContain('dimmed');
    expect(keys(legendRows({ mode: 'network', layers: ALL_ON, hasSelection: false }))).not.toContain('dimmed');
  });

  it('a selection inside a focus says "the selection"', () => {
    const rows = legendRows({ mode: 'network', layers: ALL_ON, hasSelection: true, focus: { kind: 'employee', id: 'emp-0001' } });
    expect(rows.filter((r) => r.key === 'dimmed').map((r) => r.label)).toEqual(['Dimmed: not part of the selection']);
  });
});

describe('legendRows: journey mode', () => {
  it('shows the numbered stop, package, vehicle, faint commute and both legs', () => {
    const rows = legendRows({ mode: 'journey', layers: ALL_ON });
    expect(keys(rows)).toEqual(['stop', 'package', 'vehicle', 'baseline', 'leg1', 'leg2']);
    expect(rows.map((r) => r.shape)).toEqual(['numbered', 'dot', 'dot', 'line', 'line', 'line']);
    expect(rows.map((r) => r.label)).toEqual([
      'Numbered stop, in journey order',
      'Package',
      'Commuter vehicle',
      'Normal commute (faint)',
      'Leg 1 route',
      'Leg 2 route',
    ]);
    assertCleanLabels(rows);
  });

  it('ignores the layer toggles, selection and focus, and never shows the hidden message', () => {
    const base = legendRows({ mode: 'journey', layers: ALL_ON });
    expect(legendRows({ mode: 'journey', layers: ALL_OFF, hasSelection: true, focus: { kind: 'employee', id: 'emp-1' } })).toEqual(base);
    expect(showsHiddenMessage({ mode: 'journey', layers: ALL_OFF })).toBe(false);
  });

  it('does not repeat carrier names (those live in JourneyLegend)', () => {
    const labels = legendRows({ mode: 'journey', layers: ALL_ON }).map((r) => r.label).join(' ');
    expect(labels).not.toMatch(/carried by|from /i);
  });
});
