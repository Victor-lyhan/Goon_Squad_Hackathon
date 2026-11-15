// #883: design audit of the simulator's side panels (packages, inspector, journey, run summary,
// compare). Each fix of the audit is pinned here: the panels sit under the 64px header, one heading
// look, one chip look, spacing on the token scale, sentence case, plain empty states, no raw IDs or
// "hub", and a package list a keyboard and a screen reader can use.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompareSection } from '../../client/src/components/sim/v2/compare/CompareSection';
import { NO_REQUESTS_LINE, nothingToCompare } from '../../client/src/components/sim/v2/compare/compareModelV2';
import { BusinessInspector } from '../../client/src/components/sim/v2/inspector/BusinessInspector';
import { EmployeeInspector } from '../../client/src/components/sim/v2/inspector/EmployeeInspector';
import { businessInspector, employeeInspector } from '../../client/src/components/sim/v2/inspector/inspectorModel';
import { JourneyLegend } from '../../client/src/components/sim/v2/journey/JourneyLegend';
import { JourneyTimelineView } from '../../client/src/components/sim/v2/journey/JourneyTimeline';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { NO_PACKAGES_TEXT, PackageListView } from '../../client/src/components/sim/v2/PackageList';
import { PackageFilterBar, statusChipName } from '../../client/src/components/sim/v2/packages/PackageFilterBar';
import { PackagePanel } from '../../client/src/components/sim/v2/packages/PackagePanel';
import { PICK_A_PACKAGE_TEXT, RunSummary } from '../../client/src/components/sim/v2/RunSummary';
import type { CompareResponse } from '../../shared/v2/api';
import type { Metrics } from '../../shared/v2/types';
import { relayGainCompare } from './sim-v2-compare-fixture';
import * as insp from './sim-v2-inspector-fixture';
import { T, map as journeyMap, simAt } from './sim-v2-journey-sample';
import * as pk from './sim-v2-packages-fixture';
import { parseCss, read, type Rule } from './sim-v2-qa-css-rules';

const SIM = 'client/src/components/sim/v2';
const PANEL_CSS = [
  `${SIM}/SimWorkspace.css`,
  `${SIM}/inspector/inspector.css`,
  `${SIM}/journey/journey.css`,
  `${SIM}/packages/packages.css`,
  `${SIM}/compare/compare.css`,
];
const RULES: Rule[] = PANEL_CSS.flatMap((f) => parseCss(read(f), f));

/** The declarations for one selector (rules outside @media, later ones win), like the cascade. */
function decls(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of RULES) if (!r.media && r.selectors.includes(selector)) for (const [k, v] of r.decls) out[k] = v;
  return out;
}

const noop = () => {};
const textOf = (h: string) => h
  .replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/** What a reader sees or hears: the text, plus every aria-label and title. */
const readable = (h: string) =>
  [textOf(h), ...[...h.matchAll(/\b(?:aria-label|title)="([^"]*)"/g)].map((m) => m[1])].join(' | ');

const METRICS: Metrics = {
  requested: 24, matched: 24, unmatched: 0, direct: 5, relay: 19, delivered: 12, avgExtraMinPerTrip: 6.4,
  projectedPlatformContributionCents: 1200,
} as Metrics;

describe('#883 the panels start right under the header (72px since #955)', () => {
  const SHELL_H = read('client/src/ui/shell.css').match(/:root\s*\{\s*--app-header-h:\s*(\d+px);\s*\}/)?.[1];

  it('the shell defines the variable as the 72px header height (#955; 64px in PR #875)', () => {
    expect(SHELL_H).toBe('72px');
  });

  it('SimWorkspace.css reads var(--app-header-h); its fallback is the header\'s own height, not the stale 48px', () => {
    expect(decls('.sim-v2').top).toBe(`var(--app-header-h, ${SHELL_H})`);
    const values = RULES.filter((r) => r.file.endsWith('SimWorkspace.css')).flatMap((r) => r.decls.map(([, v]) => v));
    expect(values.filter((v) => v.includes('app-header-h'))).toEqual([`var(--app-header-h, ${SHELL_H})`]);
    expect(values.filter((v) => /48px/.test(v))).toEqual([]);
  });
});

describe('#883 one heading look in every panel', () => {
  const HEADINGS = ['.sw-section-title', '.insp-section-title', '.insp-title', '.jt__title', '.sw-journey-title'];

  it.each(HEADINGS)('%s: 14px (--text-md), weight 600, sentence case', (sel) => {
    const d = decls(sel);
    expect(d['font-size'], sel).toMatch(/^var\(--text-md(, 14px)?\)$/);
    expect(d['font-weight'], sel).toBe('600');
    expect(d['text-transform'], sel).toBeUndefined();
    expect(d['letter-spacing'], sel).toBeUndefined();
  });

  it('no panel stylesheet sets all caps (Chrome read the headings out as "RUN SUMMARY")', () => {
    const caps = RULES.filter((r) => r.decls.some(([k, v]) => k === 'text-transform' && v === 'uppercase'));
    expect(caps.map((r) => `${r.file} ${r.selectors.join(', ')}`)).toEqual([]);
  });

  it('the panel toggles ("Controls", "Inspector") are sentence case too', () => {
    expect(decls('.sw-toggle')['text-transform']).toBeUndefined();
  });
});

describe('#883 one chip look', () => {
  it.each(['.pk-chip', '.sw-details-toggle'])('%s: 24px tall, 0 8px, 12px text, hairline, radius 4px', (sel) => {
    const d = decls(sel);
    expect(d['min-height']).toBe('24px');
    expect(d.padding).toBe('0 var(--space-2, 8px)');
    expect(d['font-size']).toBe('var(--text-xs, 12px)');
    expect(d.border).toBe('1px solid var(--border, #E3E3DE)');
    expect(d['border-radius']).toBe('var(--radius, 4px)');
  });

  it('the inspector tags (role, "Relay point") are the same box: 22px line + 1px border = 24px', () => {
    for (const sel of ['.insp-row-role', '.insp-tag']) {
      const d = decls(sel);
      expect(d['line-height'], sel).toBe('22px');
      expect(d.padding, sel).toBe('0 var(--space-2, 8px)');
      expect(d['font-size'], sel).toBe('var(--text-xs, 12px)');
      expect(d.border, sel).toBe('1px solid var(--border, #E3E3DE)');
      expect(d['border-radius'], sel).toBe('var(--radius, 4px)');
    }
    // The relay tag's own rule only recolours the border and the words; the words say "Relay point".
    const own = RULES.filter((r) => r.selectors.length === 1 && r.selectors[0] === '.insp-tag');
    expect(own.flatMap((r) => r.decls.map(([k]) => k)).sort()).toEqual(['border-color', 'color']);
  });
});

describe('#883 spacing is on the token scale', () => {
  const SPACING = /^(padding|margin|gap|row-gap|column-gap)(-|$)/;
  const OK = /^(0|auto|-1px|var\(--space-\d+(, \d+px)?\))$/;

  it('every padding, margin and gap of the panels is 0 or a --space-* token', () => {
    const off: string[] = [];
    for (const r of RULES) {
      for (const [k, v] of r.decls) {
        if (!SPACING.test(k)) continue;
        const parts = v.match(/var\([^)]*\)|\S+/g) ?? [];
        if (!parts.every((p) => OK.test(p))) off.push(`${r.file} ${r.selectors.join(', ')} { ${k}: ${v} }`);
      }
    }
    expect(off).toEqual([]);
  });

  it('the search box is as tall as the Focus selects', () => {
    expect(decls('.pk-search input')['min-height']).toBe('30px');
    expect(decls('.sw-field select')['min-height']).toBe('30px');
  });
});

describe('#883 type: words in Inter, numbers in IBM Plex Mono', () => {
  it('the package row status ("At relay point") is not mono', () => {
    const html = renderToStaticMarkup(<PackageListView items={[{ id: 'a', label: 'Gift box', statusLabel: 'At relay point', routeLabel: 'x' }]}
      onSelect={noop} detailsOpen={false} onToggleDetails={noop} />);
    expect(html).toContain('<span class="sw-pkg-status">At relay point</span>');
    expect(decls('.sw-pkg-status')['font-family']).toBeUndefined();
  });

  it('the inspector ident line ("Café · Brooklyn") is not mono', () => {
    expect(decls('.insp-ident')['font-family']).toBeUndefined();
    expect(RULES.filter((r) => r.selectors.includes('.insp-ident')).flatMap((r) => r.decls.map(([k]) => k)))
      .not.toContain('font-family');
  });
});

describe('#883 plain empty states', () => {
  it('no packages: what is missing and where a package comes from', () => {
    const html = renderToStaticMarkup(<PackageListView items={[]} onSelect={noop} detailsOpen={false} onToggleDetails={noop} />);
    expect(textOf(html)).toBe('No packages in this run yet. Send one from the Business page.');
    expect(NO_PACKAGES_TEXT).toBe(textOf(html));
  });

  it('no package picked: the Inspector says how to see a journey', () => {
    const html = renderToStaticMarkup(<RunSummary metrics={METRICS} />);
    expect(textOf(html)).toContain(PICK_A_PACKAGE_TEXT);
    expect(PICK_A_PACKAGE_TEXT).toBe('Pick a package on the left to see its journey.');
  });

  it('nothing to compare: one plain sentence and no table of zeros', () => {
    const base = relayGainCompare();
    const empty: CompareResponse = structuredClone(base);
    empty.directOnly.metrics.requested = 0;
    empty.withRelay.metrics.requested = 0;
    expect(nothingToCompare(empty)).toBe(true);
    expect(nothingToCompare(base)).toBe(false);
    const html = renderToStaticMarkup(<CompareSection response={empty} loading={false} error={null} onRun={noop} />);
    expect(textOf(html)).toContain('Nothing to compare yet: this run has no packages.');
    expect(html).toContain(`<p class="cmp-text" role="status">${NO_REQUESTS_LINE}</p>`);
    expect(html).not.toContain('<table');
    // A run with packages still gets the table.
    expect(renderToStaticMarkup(<CompareSection response={base} loading={false} error={null} onRun={noop} />)).toContain('<table');
  });
});

describe('#883 no raw IDs, "hub" or "trip id" anywhere in the panels', () => {
  const BAD = /\b(shp|emp|biz|home|plan|job|trip|run)-[a-z0-9]|\bhubs?\b|trip ?id/i;
  const relay = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight, { 'shp-2': 'at_hub' }), map: journeyMap }) as Journey;
  const direct = buildJourney({ shipmentId: 'shp-1', sim: simAt(T.onLeg1), map: journeyMap }) as Journey;
  const isim = insp.makeSim();
  const imap = insp.makeMap();
  const h = { onSelectPackage: noop, onSelectEmployee: noop, onSelectBusiness: noop, onFocus: noop, onClear: noop };
  const renders: [string, string][] = [
    ['package panel', renderToStaticMarkup(<PackagePanel sim={pk.makeSim()} map={pk.makeMap()} onSelect={noop} />)],
    ['run summary', renderToStaticMarkup(<RunSummary metrics={METRICS} />)],
    ['compare', renderToStaticMarkup(<CompareSection response={relayGainCompare()} loading={false} error={null} onRun={noop} />)],
    ...Object.values(insp.BIZ).map((id) => [`business ${id}`,
      renderToStaticMarkup(<BusinessInspector model={businessInspector(id, isim, imap)} {...h} />)] as [string, string]),
    ...Object.values(insp.EMP).map((id) => [`employee ${id}`,
      renderToStaticMarkup(<EmployeeInspector model={employeeInspector(id, isim, imap)} {...h} />)] as [string, string]),
    ...([['relay', relay], ['direct', direct]] as const).flatMap(([k, j]) => [
      [`${k} journey, Details open`, renderToStaticMarkup(<JourneyTimelineView journey={j} onSeek={noop} detailsOpen onToggleDetails={noop} />)],
      [`${k} journey legend`, renderToStaticMarkup(<JourneyLegend carriers={j.carriers} />)],
    ] as [string, string][]),
  ];

  it.each(renders)('%s', (_, html) => {
    // Hidden Details bodies are in the markup, so this covers what Details opens too.
    expect(readable(html)).not.toMatch(BAD);
  });

  it('the employee inspector has no "ID" row under Details any more', () => {
    const html = renderToStaticMarkup(<EmployeeInspector model={employeeInspector(insp.EMP.maya, isim, imap)} {...h} />);
    expect(html).not.toContain('insp-def-ident');
    expect(textOf(html)).not.toMatch(/\bID\b/);
  });
});

describe('#883 keyboard and screen reader: the package list', () => {
  const items = [
    { id: 'a', label: 'Design proofs', statusLabel: 'Scheduled', routeLabel: 'A → B' },
    { id: 'b', label: 'Gift box', statusLabel: 'At relay point', routeLabel: 'C → D' },
  ];
  const html = renderToStaticMarkup(<PackageListView items={items} selectedId="b" onSelect={noop} detailsOpen={false} onToggleDetails={noop} />);
  const rows = [...html.matchAll(/<button\b([^>]*class="sw-pkg[^"]*"[^>]*)>([\s\S]*?)<\/button>/g)];

  it('each row is a native button in the tab order (Enter and Space choose it)', () => {
    expect(rows).toHaveLength(2);
    for (const [, attrs] of rows) {
      expect(attrs).toContain('type="button"');
      expect(attrs).not.toMatch(/tabindex="-1"|disabled/);
    }
    expect(rows.map(([, attrs]) => /aria-current="true"/.test(attrs))).toEqual([false, true]);
  });

  it('each row says its status in words, not by colour alone', () => {
    // The shown line (the route line under Details is `hidden`, so not part of the name until opened).
    const shown = rows.map(([, , body]) => textOf(body.replace(/<span class="sw-pkg-route"[^>]*hidden="">[\s\S]*?<\/span>/, '')));
    expect(shown).toEqual(['Design proofs Scheduled', 'Gift box At relay point']);
  });

  it('a focused row shows a 2px accent ring', () => {
    const ring = RULES.find((r) => r.selectors.includes('.sw-pkg:focus-visible'));
    expect(ring).toBeDefined();
    expect(Object.fromEntries(ring!.decls).outline).toBe('2px solid var(--accent, #1D5075)');
  });

  it('the status filter chips have full names: "Delivered, 12 packages", "Scheduled, 1 package"', () => {
    expect(statusChipName('Delivered', 12)).toBe('Delivered, 12 packages');
    expect(statusChipName('Scheduled', 1)).toBe('Scheduled, 1 package');
    const bar = renderToStaticMarkup(<PackageFilterBar query="" onQueryChange={noop} status="all" onStatusChange={noop}
      options={[{ value: 'all', label: 'All', count: 24 }, { value: 'delivered', label: 'Delivered', count: 12 }]} />);
    const chips = [...bar.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]);
    expect(chips.map((a) => a.match(/aria-label="([^"]*)"/)?.[1])).toEqual(['All, 24 packages', 'Delivered, 12 packages']);
    expect(chips.map((a) => a.match(/aria-pressed="(\w+)"/)?.[1])).toEqual(['true', 'false']);
    for (const sel of ['.pk-chip:focus-visible']) expect(RULES.some((r) => r.selectors.includes(sel))).toBe(true);
  });
});
