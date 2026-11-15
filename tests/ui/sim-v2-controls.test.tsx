import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FocusSelector } from '../../client/src/components/sim/v2/FocusSelector';
import { PackageList } from '../../client/src/components/sim/v2/PackageList';
import { RunSummary } from '../../client/src/components/sim/v2/RunSummary';
import type { Metrics } from '../../shared/v2/types';

const tags = (h: string, t: string) => h.match(new RegExp(`<${t}\\b[^>]*>`, 'g')) ?? [];
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const noop = () => {};

// Sample objects for rendering tests only.
const metrics = (over: Partial<Metrics> = {}): Metrics => ({
  requested: 24, matched: 20, delivered: 7, direct: 12, relay: 8, unmatched: 4,
  avgExtraMinPerTrip: 6.4, maxExtraMin: 14, earnedRewardsCents: 0,
  projectedCustomerSavingsCents: 0, projectedCustomerSpendCents: 0,
  projectedPlatformContributionCents: 0, earnedPlatformContributionCents: 0, extraDistanceM: 0,
  ...over,
});

describe('FocusSelector', () => {
  const employees = [{ id: 'emp-1', label: 'Maya Chen' }, { id: 'emp-2', label: 'Sam Ortiz' }];
  const businesses = [{ id: 'biz-a', label: 'Brooklyn Studio' }];

  it('has two selects with <label for> and a disabled Show everything button when nothing is focused', () => {
    const html = renderToStaticMarkup(<FocusSelector employees={employees} businesses={businesses} focus={{ kind: 'none' }} onChange={noop} />);
    for (const [id, text] of [['sw-focus-employee', 'Focus on employee'], ['sw-focus-business', 'Focus on business']]) {
      expect(html).toContain(`<label for="${id}">${text}</label>`);
      expect(tags(html, 'select').some((t) => attr(t, 'id') === id)).toBe(true);
    }
    expect(html).toContain('Maya Chen');
    expect(html).toContain('Brooklyn Studio');
    const btn = tags(html, 'button')[0];
    expect(btn).toContain('disabled');
    expect(html).toContain('Show everything');
  });

  it('selects only the focused entity and enables Show everything', () => {
    const html = renderToStaticMarkup(<FocusSelector employees={employees} businesses={businesses} focus={{ kind: 'employee', id: 'emp-2' }} onChange={noop} />);
    const selected = tags(html, 'option').filter((t) => t.includes('selected'));
    // employee select picks emp-2; business select stays on its "All businesses" option.
    expect(selected.map((t) => attr(t, 'value'))).toEqual(['emp-2', '']);
    expect(tags(html, 'button')[0]).not.toContain('disabled');
  });
});

describe('RunSummary', () => {
  it('shows delivered, matched and extra minutes per trip, one line each, in mono', () => {
    const html = renderToStaticMarkup(<RunSummary metrics={metrics()} />);
    expect(html).toMatch(/Delivered<\/dt><dd class="sw-mono">7 \/ 24<\/dd>/);
    expect(html).toMatch(/Matched<\/dt><dd class="sw-mono">20 \/ 24<\/dd>/);
    expect(html).toMatch(/Extra per trip<\/dt><dd class="sw-mono">6.4 min<\/dd>/);
  });

  it('shows a dash when the average is null and never prints NaN, undefined or null', () => {
    const cases = [
      metrics({ avgExtraMinPerTrip: null, matched: 0, delivered: 0 }),
      metrics({ requested: 0, matched: 0, delivered: 0, avgExtraMinPerTrip: null }),
      metrics({ avgExtraMinPerTrip: Number.NaN }),
      metrics({ requested: undefined as unknown as number }),
    ];
    for (const m of cases) {
      const html = renderToStaticMarkup(<RunSummary metrics={m} />);
      expect(html).not.toMatch(/NaN|undefined|null/);
    }
    const html = renderToStaticMarkup(<RunSummary metrics={metrics({ avgExtraMinPerTrip: null })} />);
    expect(html).toMatch(/Extra per trip<\/dt><dd class="sw-mono">—<\/dd>/);
  });
});

describe('PackageList', () => {
  const items = [
    { id: 'shp-001', label: 'Design proofs', statusLabel: 'Scheduled', routeLabel: 'Brooklyn Studio → Midtown Agency' },
    { id: 'shp-002', label: 'Gift box', statusLabel: 'At relay point', routeLabel: 'LIC Bakery → Chelsea Office' },
  ];

  it('renders one button per package and marks only the selected one', () => {
    const html = renderToStaticMarkup(<PackageList items={items} selectedId="shp-002" onSelect={noop} />);
    // #832: the list's Details toggle (closed), then one button per package.
    const [details, ...buttons] = tags(html, 'button');
    expect(attr(details!, 'aria-expanded')).toBe('false');
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => attr(b, 'aria-current') ?? null)).toEqual([null, 'true']);
    // One line per package: the route line is in the page, hidden until Details is opened.
    expect(html.match(/<span class="sw-pkg-route" data-details-body="" hidden="">/g)).toHaveLength(2);
    expect(html).toContain('Design proofs');
    expect(html).toContain('<span class="sw-pkg-status sw-mono">At relay point</span>');
    expect(html).toContain('LIC Bakery → Chelsea Office');
  });

  it('marks nothing when nothing is selected', () => {
    const html = renderToStaticMarkup(<PackageList items={items} onSelect={noop} />);
    expect(html).not.toContain('aria-current');
  });

  it('shows an empty state with no packages', () => {
    const html = renderToStaticMarkup(<PackageList items={[]} onSelect={noop} />);
    expect(html).toContain('No packages in this run yet.');
    expect(html).not.toContain('<button');
  });
});
