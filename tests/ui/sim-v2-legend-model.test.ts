import { describe, expect, it } from 'vitest';
import { journeySymbolRows, legendRows, type LegendRow } from '../../client/src/components/sim/v2/legend/legendModel';
import { SYMBOL_GLYPH } from '../../client/src/components/map/layers';
import * as legendModel from '../../client/src/components/sim/v2/legend/legendModel';

const keys = (rows: LegendRow[]) => rows.map((r) => r.key);

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
    const rows = legendRows({ mode: 'network' });
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
    assertCleanLabels(rows);
  });

  it('every row has a key, label, shape and a CSS color string; keys are unique', () => {
    const rows = legendRows({ mode: 'network', hasSelection: true });
    expect(new Set(keys(rows)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.key).toMatch(/^[a-z0-9]+$/);
      expect(['dot', 'ring', 'line']).toContain(r.shape);
      expect(r.color).toMatch(/^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\)$/);
      if (r.shape === 'line') expect(r.width).toBeGreaterThan(0);
    }
  });

  it('has no layer input and no "all layers hidden" state any more (#648): the six rows are always there', () => {
    for (const name of ['ALL_HIDDEN_MESSAGE', 'showsHiddenMessage', 'allLayersHidden']) {
      expect(legendModel, name).not.toHaveProperty(name);
    }
    expect(legendRows({ mode: 'network' })).toHaveLength(6);
    expect(legendRows({ mode: 'network', focus: { kind: 'none' } })).toHaveLength(6);
  });

  it('a selection adds the dimmed row last', () => {
    const rows = legendRows({ mode: 'network', hasSelection: true });
    expect(keys(rows)).toEqual(['business', 'home', 'vehicle', 'package', 'baseline', 'route', 'dimmed']);
    expect(rows.at(-1)!.label).toBe('Dimmed: not part of the selection');
  });

  it('a focus adds the dimmed row "of this focus"; no focus adds nothing', () => {
    for (const focus of [{ kind: 'employee', id: 'emp-0007' }, { kind: 'business', id: 'biz-0003' }] as const) {
      const rows = legendRows({ mode: 'network', focus });
      expect(rows.at(-1)).toMatchObject({ key: 'dimmed', label: 'Dimmed: not part of this focus' });
      assertCleanLabels(rows);
    }
    expect(keys(legendRows({ mode: 'network', focus: { kind: 'none' } }))).not.toContain('dimmed');
    expect(keys(legendRows({ mode: 'network', hasSelection: false }))).not.toContain('dimmed');
  });

  it('a selection inside a focus says "the selection"', () => {
    const rows = legendRows({ mode: 'network', hasSelection: true, focus: { kind: 'employee', id: 'emp-0001' } });
    expect(rows.filter((r) => r.key === 'dimmed').map((r) => r.label)).toEqual(['Dimmed: not part of the selection']);
  });
});

describe('legendRows: journey mode (#699)', () => {
  it('has no rows: the old numbered stop, vehicle, faint commute and leg rows are gone', () => {
    expect(legendRows({ mode: 'journey' })).toEqual([]);
    expect(legendRows({ mode: 'journey', hasSelection: true, focus: { kind: 'employee', id: 'emp-1' } })).toEqual([]);
  });
});

describe('journeySymbolRows: the key of the journey map\'s marks (#699)', () => {
  it('relay: package, then sender, overnight, handoff and delivered with the map\'s glyphs', () => {
    const rows = journeySymbolRows(true);
    expect(rows.map((r) => r.key)).toEqual(['package', 'sender', 'relay', 'swap', 'recipient']);
    expect(rows.map((r) => r.label)).toEqual(['Package', 'Sender', 'Overnight at the relay point', 'Handoff', 'Delivered']);
    for (const r of rows) if (r.key !== 'package') expect(r.glyph).toBe(SYMBOL_GLYPH[r.key]);
    expect(rows.slice(1).map((r) => ('glyph' in r ? r.glyph : ''))).toEqual(['\u25A0', '\u25C6', '\u21C4', '\u2691']);
  });

  it('direct: no overnight and no handoff', () => {
    expect(journeySymbolRows(false).map((r) => r.key)).toEqual(['package', 'sender', 'recipient']);
  });

  it('no old MVP II wording', () => {
    const labels = [...journeySymbolRows(true), ...journeySymbolRows(false)].map((r) => r.label).join(' ');
    expect(labels).not.toMatch(/Numbered stop|Leg \d|hub|Commuter vehicle|Normal commute/i);
  });
});
