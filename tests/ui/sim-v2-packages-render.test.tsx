import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PackageFilterBar } from '../../client/src/components/sim/v2/packages/PackageFilterBar';
import { PackagePanel } from '../../client/src/components/sim/v2/packages/PackagePanel';
import { buildPackageRows, statusFilters } from '../../client/src/components/sim/v2/packages/packageListModel';
import { makeMap, makeSim, UNMATCHED_REASON } from './sim-v2-packages-fixture';

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const buttons = (h: string) => [...h.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
  .map((m) => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));

function expectClean(html: string) {
  expect(html).not.toMatch(/NaN|undefined|null/);
  expect(html).not.toMatch(/\bbiz-[a-z0-9]/i);
  expect(html).not.toMatch(/hub|synthetic/i);
}

function panel(selectedId?: string, sim = makeSim(), map = makeMap()) {
  const onSelect = vi.fn();
  const html = renderToStaticMarkup(<PackagePanel sim={sim} map={map} selectedId={selectedId} onSelect={onSelect} />);
  expect(onSelect).not.toHaveBeenCalled();
  return unescape(html);
}

describe('PackagePanel', () => {
  it('renders one row per package with kind, status, route and the unmatched reason', () => {
    const html = panel();
    expect(html.match(/class="sw-pkg[ "]/g)).toHaveLength(4);
    for (const label of ['Brand proofs', 'Gift box', 'Signed lease', 'Spare keys']) expect(html).toContain(label);
    expect(html).toContain('<span class="sw-pkg-status sw-mono">At relay point</span>');
    // #832: the kind, the route and the reason are on the line under the Details toggle (closed).
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/<span class="sw-pkg-route" data-details-body="" hidden="">/g)).toHaveLength(4);
    expect(html).toContain('Relay via Front Street Café · Vernon Bakery → Chelsea Office');
    expect(html).toContain(UNMATCHED_REASON);
    expect(html).toContain('Midtown Ad Agency → Unknown place');
    expect(html).toContain('4 of 4 packages');
    expectClean(html);
  });

  it('marks the selected row', () => {
    const html = panel('shp-2');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*class="sw-pkg is-selected"[^>]*aria-current="true"[^>]*>.*?Gift box/);
  });

  it('shows the status filters with counts as a labelled, pressed-state button group', () => {
    const html = panel();
    expect(html).toMatch(/<div class="pk-status" role="group" aria-labelledby="[^"]+">/);
    const labelId = html.match(/aria-labelledby="([^"]+)"/)![1];
    expect(html).toContain(`id="${labelId}" class="pk-group-label">Status<`);
    const chips = buttons(html).filter((b) => b.attrs.includes('pk-chip'));
    expect(chips.map((c) => c.text)).toEqual(['All 4', 'Unmatched 1', 'Picked up 2', 'At relay point 1']);
    expect(chips.map((c) => c.attrs.match(/aria-pressed="(\w+)"/)![1])).toEqual(['true', 'false', 'false', 'false']);
  });

  it('labels the search input', () => {
    const html = panel();
    const id = html.match(/<input[^>]*id="([^"]+)"/)![1];
    expect(html).toContain(`<label for="${id}">Search packages</label>`);
    expect(html).toMatch(/<input[^>]*type="search"[^>]*value=""/);
  });

  it('with no packages, shows the list empty state and no filters', () => {
    const sim = { ...makeSim(), shipments: [], plans: [], unmatched: [] };
    const html = panel(undefined, sim);
    expect(html).toContain('No packages in this run yet.');
    expect(html).not.toContain('pk-chip');
  });
});

describe('PackageFilterBar', () => {
  const rows = buildPackageRows(makeSim(), makeMap());
  it('shows the typed query and the chosen filter as pressed', () => {
    const html = unescape(renderToStaticMarkup(
      <PackageFilterBar query="front" onQueryChange={vi.fn()} status="at_hub" onStatusChange={vi.fn()}
        options={statusFilters(rows, 'at_hub')} />,
    ));
    expect(html).toMatch(/value="front"/);
    const pressed = buttons(html).filter((b) => b.attrs.includes('aria-pressed="true"'));
    expect(pressed.map((b) => b.text)).toEqual(['At relay point 1']);
    expect(html).not.toContain('at_hub');
  });
});
