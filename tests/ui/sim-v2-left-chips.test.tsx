// #846: in the simulator's 320 px left panel the status chips ran past the panel's right edge. The chip
// row already wrapped, but the `.pk-panel` grid had an `auto` column, which grows to its widest item's
// min-content width. A package row is a nowrap name plus a nowrap status, so mid-run ("Williamsburg
// cookie-box proofs" + "Out for delivery") the whole panel content was 342 px wide in a 296 px body and
// the last chip ("Delivered 12") ended at 337 px. Measured in headless Chrome on the built app at 900x900
// and 1440x900: after the fix no element of `.sw-left` ends past its right edge. These tests pin the
// rules that keep it so, and the markup they rely on.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PackageListView } from '../../client/src/components/sim/v2/PackageList';
import { PackageFilterBar } from '../../client/src/components/sim/v2/packages/PackageFilterBar';
import type { StatusFilterOption } from '../../client/src/components/sim/v2/packages/packageListModel';
import { parseCss, read, type Rule } from './sim-v2-qa-css-rules';

const FILES = [
  'client/src/components/sim/v2/packages/packages.css',
  'client/src/components/sim/v2/SimWorkspace.css',
];
const RULES: Rule[] = FILES.flatMap((f) => parseCss(read(f), f));
/** The declarations of every rule (any @media) for exactly this selector, later ones winning. */
const decls = (selector: string, media: string | null = null) =>
  new Map(RULES.filter((r) => r.media === media && r.selectors.includes(selector)).flatMap((r) => r.decls));
const norm = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

describe('#846 left panel content never wider than the panel', () => {
  it('the package panel grid has one column that can shrink to the panel body (not an auto column)', () => {
    const d = decls('.pk-panel');
    expect(d.get('display')).toBe('grid');
    expect(norm(d.get('grid-template-columns'))).toBe('minmax(0, 1fr)');
  });

  it('a package row button has one column that can shrink to its width, so the name gets the ellipsis', () => {
    const row = decls('.sw-pkg');
    expect(row.get('display')).toBe('grid');
    expect(norm(row.get('grid-template-columns'))).toBe('minmax(0, 1fr)');
    const label = decls('.sw-pkg-label');
    expect(label.get('min-width')).toBe('0');
    expect(label.get('overflow')).toBe('hidden');
    expect(label.get('text-overflow')).toBe('ellipsis');
    expect(label.get('white-space')).toBe('nowrap');
  });

  it('the chip row still wraps', () => {
    const d = decls('.pk-status');
    expect(d.get('display')).toBe('flex');
    expect(d.get('flex-wrap')).toBe('wrap');
  });

  it('no media rule puts an auto or fixed column back on the panel or the rows', () => {
    for (const r of RULES.filter((x) => x.media)) {
      if (!r.selectors.some((s) => s === '.pk-panel' || s === '.sw-pkg' || s === '.pk-filters')) continue;
      expect(r.decls.map(([k]) => k), `${r.file} ${r.media}`).not.toContain('grid-template-columns');
    }
  });

  it('the chips are buttons in the .pk-status row of .pk-filters, in the given order with unchanged text', () => {
    const options: StatusFilterOption[] = [
      { value: 'all', label: 'All', count: 24 },
      { value: 'scheduled', label: 'Scheduled', count: 1 },
      { value: 'picked_up', label: 'Picked up', count: 1 },
      { value: 'at_hub', label: 'At relay point', count: 8 },
      { value: 'out_for_delivery', label: 'Out for delivery', count: 2 },
      { value: 'delivered', label: 'Delivered', count: 12 },
    ];
    const html = renderToStaticMarkup(
      <PackageFilterBar query="" onQueryChange={() => {}} status="all" onStatusChange={() => {}} options={options} />,
    );
    expect(html).toMatch(/^<div class="pk-filters">/);
    const row = html.match(/<div class="pk-status" role="group"[^>]*>([\s\S]*)<\/div><\/div>$/);
    expect(row).not.toBeNull();
    const chips = [...row![1].matchAll(/<button type="button" class="pk-chip[^"]*" aria-pressed="(true|false)">([\s\S]*?)<\/button>/g)]
      .map((m) => `${m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}${m[1] === 'true' ? ' *' : ''}`);
    expect(chips).toEqual(['All 24 *', 'Scheduled 1', 'Picked up 1', 'At relay point 8', 'Out for delivery 2', 'Delivered 12']);
  });

  it('a package row keeps the full name as its title, so a cut name can still be read', () => {
    const name = 'Williamsburg cookie-box proofs';
    const html = renderToStaticMarkup(
      <PackageListView
        items={[{ id: 'shp-1', label: name, statusLabel: 'Out for delivery', routeLabel: 'A → B' }]}
        onSelect={() => {}}
        detailsOpen={false}
        onToggleDetails={() => {}}
      />,
    );
    expect(html).toContain(`<button type="button" class="sw-pkg"><span class="sw-pkg-top"><span class="sw-pkg-label" title="${name}">${name}</span>`);
  });
});
