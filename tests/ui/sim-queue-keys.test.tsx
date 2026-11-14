import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PackageDetail } from '../../client/src/components/sim/PackageDetail';
import { PackageQueue } from '../../client/src/components/sim/PackageQueue';
import { filterRows, moveSelection, toQueueRows } from '../../client/src/components/sim/packageQueueModel';
import { keyToControl } from '../../client/src/components/sim/playbackModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import type { Run } from '../../shared/types';

const base = createInitialRun(loadDefaultScenario());
const { scenario } = base;
const at = (t: number): Run => ({ ...base, clock: { ...base.clock, timeMin: t } });

describe('moveSelection', () => {
  const ids = ['a', 'b', 'c'];
  it('moves and clamps', () => {
    expect(moveSelection(ids, 'a', 'ArrowDown')).toBe('b');
    expect(moveSelection(ids, 'c', 'ArrowDown')).toBe('c');
    expect(moveSelection(ids, 'b', 'ArrowUp')).toBe('a');
    expect(moveSelection(ids, 'a', 'ArrowUp')).toBe('a');
    expect(moveSelection(ids, 'b', 'Home')).toBe('a');
    expect(moveSelection(ids, 'b', 'End')).toBe('c');
  });
  it('handles no selection, empty list and other keys', () => {
    expect(moveSelection(ids, undefined, 'ArrowDown')).toBe('a');
    expect(moveSelection(ids, 'zzz', 'ArrowUp')).toBe('c');
    expect(moveSelection([], 'a', 'Home')).toBeNull();
    expect(moveSelection(ids, 'a', 'n')).toBeNull();
  });
  it('does not clash with playback shortcuts', () => {
    const state = { clock: base.clock, nextEventMin: 1000, settings: scenario.settings, busy: false };
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End']) expect(keyToControl({ key }, state)).toBeNull();
  });
});

describe('queue search', () => {
  const sim = buildSimulatorResponse(base);
  const rows = toQueueRows(sim.shipments, sim.plans, sim.snapshot.shipmentStatus, scenario.businesses);
  it('finds by shipment ID, name or business, case-insensitively', () => {
    expect(filterRows(rows, 'all', rows[0].id.toUpperCase()).map((r) => r.id)).toContain(rows[0].id);
    expect(filterRows(rows, 'all', rows[0].sender.toLowerCase()).length).toBeGreaterThan(0);
    expect(filterRows(rows, 'all', rows[0].label).map((r) => r.id)).toContain(rows[0].id);
    expect(filterRows(rows, 'all', 'no-such-thing-xyz')).toEqual([]);
  });
});

describe('queue and detail with real Demo-city data', () => {
  for (const t of [930, 2160]) {
    it(`render cleanly at ${t}`, () => {
      const sim = buildSimulatorResponse(at(t));
      const selected = sim.shipments[0].id;
      const html = renderToStaticMarkup(
        <MemoryRouter>
          <PackageQueue shipments={sim.shipments} plans={sim.plans} snapshot={sim.snapshot}
            businesses={scenario.businesses} selectedId={selected} onSelect={() => {}} />
          {sim.shipments.map((s) => (
            <PackageDetail key={s.id} sim={sim} businesses={scenario.businesses} hubs={scenario.hubs}
              employees={scenario.employees} selectedId={s.id} />
          ))}
        </MemoryRouter>,
      );
      const text = html.replace(/<[^>]*>/g, ' ');
      expect(text).not.toMatch(/NaN|undefined/);
      expect(text).not.toMatch(/\bn-\d+-\d+\b/);
      expect(html).toContain('aria-current="true"');
      expect(html).toContain('>Timeline<');
      expect(html).toContain('>Businesses<');
      expect(html).toContain('>Carriers<');
      expect(html).toContain('>Price<');
      expect(html).toMatch(/All \(\d+\)/);
    });
  }
});
