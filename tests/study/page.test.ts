// The study page (scripts/study/page.ts): rendered from a small real study (two runs on the committed NYC
// cache), and the committed client/public/study.html checked against scripts/study/assumptions.ts.
// No key, no network, nothing written.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSUMPTIONS, ASSUMPTION_KEYS } from '../../scripts/study/assumptions';
import { DEFAULT_STUDY_PAGE } from '../../scripts/study/cli';
import {
  CARD_MIN_WIDTH, CHART_TEXT_PX, CHART_WIDTH, RUNS_CSV_HREF, SKIPPED_RUNS_LISTED,
  assumptionValueParts, escapeHtml, headlineTiles, renderStudyPage,
} from '../../scripts/study/page';
import { runStudy } from '../../scripts/study/runner';
import { summarize } from '../../scripts/study/summary';
import type { StudyResults } from '../../scripts/study/types';
import { STUDY_TIMEOUT_MS, TWO_RUN_GRID, allSkipped, noneMatched, studyInput } from './study-helper';

const sample: StudyResults = runStudy(studyInput({ grid: TWO_RUN_GRID }));
const page = renderStudyPage(sample);

/** The sample with headline numbers that are easy to recognise in the text. */
const pinned: StudyResults = {
  ...sample,
  headline: {
    ...sample.headline,
    packages: 2268, matched: 1211, matchRate: 0.534,
    relayCostPerPackageCents: 1000, courierCostPerPackageCents: 1599, costSavedPerPackageCents: 599, costSavedRate: 0.3744,
    relayAddedMilesPerPackage: 1.305, courierMilesPerPackage: 5.171, milesSavedPerPackage: 3.866, milesSavedRate: 0.7476,
    relayCo2KgPerPackage: 0.522, courierCo2KgPerPackage: 2.068, co2SavedKgPerPackage: 1.546, co2SavedRate: 0.7512,
    onTimeOrEarlyRate: 0.9875, earlyRate: 0.322, lateRate: 0.0125, avgMinutesAheadOfPromise: 400.9,
  },
};

/** A study where every run was skipped: no run, no package, every average null. */
const empty: StudyResults = allSkipped(sample);

/** Runs that were simulated but matched nothing: the per-package values have nothing to divide by. */
const unmatched: StudyResults = noneMatched(sample);

/**
 * The sample's two runs repeated until there are `runs` of them, each with its own seed: a study as large as
 * the real one without simulating it.
 */
function manyRuns(runs: number): StudyResults {
  const repeated = Array.from({ length: runs }, (_, index) => {
    const run = sample.runs[index % sample.runs.length]!;
    return { ...run, id: `s${index + 1}-e60-p24-d12`, params: { ...run.params, seed: index + 1 } };
  });
  return {
    ...sample,
    grid: { ...sample.grid, seeds: repeated.map(run => run.params.seed), plannedRuns: runs, completedRuns: runs },
    runs: repeated,
    totals: { ...sample.totals, runs },
    headline: { ...sample.headline, runs },
  };
}

const text = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const charts = (html: string): string[] => [...html.matchAll(/<svg data-chart="([^"]+)"/g)].map(match => match[1]!);
/** Every `src`, `href`, `action`, `srcset`, `poster` or `data` attribute value, and every CSS `url(...)`. */
function references(html: string): string[] {
  return [
    ...[...html.matchAll(/\s(?:src|href|xlink:href|action|srcset|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
      .map(match => match[1] ?? match[2] ?? match[3] ?? ''),
    ...[...html.matchAll(/url\(\s*['"]?([^'")]*)/gi)].map(match => match[1] ?? ''),
  ];
}
const isExternal = (reference: string): boolean => /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(reference);
/** The one `<link>` the page may have: an empty tab icon, so the browser does not ask for /favicon.ico. */
const EMPTY_ICON = '<link rel="icon" href="data:,">';

function expectSelfContained(html: string): void {
  expect(references(html).filter(isExternal)).toEqual([]);
  expect(html.replace(EMPTY_ICON, '')).not.toMatch(/<script|<link|<img|<iframe|<object|<embed|<video|<audio|@import|@font-face|\sxmlns/i);
  expect(html).not.toMatch(/https?:\/\//i);
}

const styleOf = (html: string): string => html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
const chartOf = (html: string, id: string): string => html.match(new RegExp(`<svg data-chart="${id}"[\\s\\S]*?</svg>`))![0];
/** The declarations of the first CSS rule with exactly this selector, outside any media query. */
function rule(css: string, selector: string): string {
  const match = new RegExp(`(?:^|[}\\n])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(css);
  expect(match, `CSS rule "${selector}"`).not.toBeNull();
  return match![1]!;
}
type ChartText = { cls: string; x: number; y: number; anchor: string; text: string };
/** Every `<text>` of a chart with its position. */
function chartTexts(svg: string): ChartText[] {
  return [...svg.matchAll(/<text class="([^"]+)" x="([\d.-]+)" y="([\d.-]+)"(?: text-anchor="(\w+)")?>([^<]*)<\/text>/g)]
    .map(match => ({ cls: match[1]!, x: Number(match[2]), y: Number(match[3]), anchor: match[4] ?? 'start', text: match[5]! }));
}
/**
 * The width of a chart text in SVG units, a little above what Chrome measured (#808): a figure (class `num`,
 * monospace) is 0.6 em per character, a sans label averaged 0.54 em ("120 employees" was 84.7 units).
 */
const textWidth = (t: ChartText): number => t.text.length * CHART_TEXT_PX * (t.cls.includes('num') ? 0.6 : 0.58);
/** The left and right edge of a chart text, from its anchor. */
function extent(t: ChartText): { left: number; right: number } {
  const width = textWidth(t);
  if (t.anchor === 'end') return { left: t.x - width, right: t.x };
  if (t.anchor === 'middle') return { left: t.x - width / 2, right: t.x + width / 2 };
  return { left: t.x, right: t.x + width };
}

describe('the study page', () => {
  it('is one HTML document with a title, one h1, the how-we-compared paragraph and a link back to /', () => {
    expect(page.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(page.endsWith('</html>\n')).toBe(true);
    const head = page.slice(0, page.indexOf('</head>'));
    expect(head.match(/<title>[^<]+<\/title>/g)).toHaveLength(1);
    expect(page).toContain('<title>Relay vs. a next-day courier: the numbers</title>');
    expect(page.match(/<h1[\s>]/g)).toHaveLength(1);
    // The headline is the number of simulations; what they compare is the line above it.
    expect(page).toContain('<p class="eyebrow">Relay vs. a next-day courier: the numbers</p>\n<h1>2 simulations</h1>');
    expect(renderStudyPage(manyRuns(3024))).toContain('<h1>3,024 simulations</h1>');
    expect(renderStudyPage({ ...sample, totals: { ...sample.totals, runs: 1 } })).toContain('<h1>1 simulation</h1>');
    expect(page).toMatch(/<h2>How we compared<\/h2>\s*<p class="how">/);
    expect(page).toContain('<a class="back" href="/">');
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(page).toContain('<meta charset="utf-8">');
  }, STUDY_TIMEOUT_MS);

  it('shows the headline numbers: money in dollars, miles with one decimal, CO2 in kg, rates in percent', () => {
    const words = text(renderStudyPage(pinned));
    for (const expected of [
      '37.4% less', 'Relay $10.00 vs courier $15.99 per package', 'Relay saves $5.99 per package',
      '74.8% less', 'Relay 1.3 mi vs courier 5.2 mi per package', 'Relay adds 3.9 mi less driving per package',
      '75.1% less', 'Relay 0.52 kg vs courier 2.07 kg per package', 'Relay emits 1.55 kg less per package',
      '98.8%', '32.2% a day early, 1.3% late',
      'Match rate 53.4%', '1,211 of 2,268 packages found a commute',
      'arrives 6 h 41 min before the courier’s promised time',
    ]) expect(words).toContain(expected);
  });

  it('reads the totals of the results it was given', () => {
    const words = text(page);
    const { totals } = sample;
    expect(words).toContain(`Runs simulated ${totals.runs}`);
    expect(words).toContain(`Packages requested ${totals.packages}`);
    expect(words).toContain(`Matched and compared ${totals.matched}`);
    expect(words).toContain(`Carried on one commute ${totals.direct}`);
    expect(words).toContain(`Carried on two commutes, one relay point ${totals.relay}`);
    expect(words).toContain(`Relay matched ${totals.matched} of ${totals.packages} requested packages to a commute; the other ${totals.unmatched} would go by courier.`);
    expect(words).toContain(`${totals.early} (`);
    expect(words).toContain(`${totals.onTime} (`);
  });

  it('says a saving that is negative is "more", never a negative "less"', () => {
    const worse = text(renderStudyPage({ ...pinned, headline: { ...pinned.headline, milesSavedRate: -0.2 } }));
    expect(worse).toContain('20.0% more');
    expect(worse).not.toMatch(/-\d+(\.\d+)?% less/);
  });

  it('names the baseline: a standard next-day B2B courier, not a same-hour courier', () => {
    const words = text(page);
    expect(words).toContain('standard next-day B2B courier');
    expect(words).toContain('not a same-hour courier');
    expect(words).toContain('one dedicated trip from sender to recipient, promised by 10:30 a.m. on the next business day');
    expect(words).toContain('“Per package” always means per package Relay matched.');
  });

  it('shows skipped runs as a count, and lists them when there are any', () => {
    expect(text(page)).toContain('Runs skipped 0');
    expect(text(page)).toContain('2 runs planned, 2 simulated, 0 skipped');
    expect(page).not.toContain('class="skipped"');

    const words = text(renderStudyPage(empty));
    expect(words).toContain('Runs skipped 2');
    expect(words).toContain('2 runs planned, 0 simulated, 2 skipped');
    expect(words).toContain('The 2 skipped runs');
    for (const run of empty.grid.skippedRuns) expect(words).toContain(`${run.id} No travel matrix data for biz-a|home-001`);
  });

  it('lists at most 50 skipped runs and says the CSV has the rest, so the page stays small', () => {
    expect(SKIPPED_RUNS_LISTED).toBe(50);
    const skippedRuns = Array.from({ length: 3024 }, (_, index) => ({
      id: `s${index + 1}-e120-p12-d12`, params: { seed: index + 1, employees: 120, packages: 12, maxExtraMin: 12 }, reason: 'No travel matrix data for biz-a|home-001',
    }));
    const html = renderStudyPage({ ...empty, grid: { ...empty.grid, plannedRuns: 3024, skippedRuns } });
    const listed = html.match(/<ul class="skipped">[\s\S]*?<\/ul>/)![0];
    expect(listed.match(/<li>/g)).toHaveLength(51);
    expect(listed).toContain('<li><code>s50-e120-p12-d12</code>');
    expect(listed).not.toContain('s51-e120-p12-d12');
    expect(listed).toContain('<li>and 2,974 more: the CSV of every run has them all.</li>');
    expect(text(html)).toContain('The 3,024 skipped runs');
    expect(Buffer.byteLength(html)).toBeLessThan(150_000);
  });

  it('writes a list of seeds that count up by one as its two ends, and any other list in full', () => {
    expect(text(page)).toContain('every combination of seeds 1, 2; 60 commuting employees; 24 packages; and detour limits of 12 minutes per commute');
    const seeds = (list: number[]): string => text(renderStudyPage({ ...sample, grid: { ...sample.grid, seeds: list } }));
    expect(seeds(Array.from({ length: 112 }, (_, index) => index + 1))).toContain('every combination of seeds 1 to 112; 60 commuting employees');
    expect(seeds([1, 2, 3])).toContain('seeds 1 to 3;');
    expect(seeds([1, 2, 4])).toContain('seeds 1, 2, 4;');
    expect(seeds([7])).toContain('seeds 7;');
  });

  it('lists every assumption with its key, label, value and reason', () => {
    expect(sample.assumptions.map(assumption => assumption.key)).toEqual([...ASSUMPTION_KEYS]);
    const rows = [...page.matchAll(/<tr data-key="([^"]+)">([\s\S]*?)<\/tr>/g)];
    expect(rows.map(row => row[1])).toEqual([...ASSUMPTION_KEYS]);
    sample.assumptions.forEach((assumption, index) => {
      const row = rows[index]![2]!;
      const { figure, rest } = assumptionValueParts(assumption);
      expect(row).toContain(`<code>${assumption.key}</code>`);
      expect(row).toContain(escapeHtml(assumption.label));
      expect(row).toContain(`<b class="num">${escapeHtml(figure)}</b> ${escapeHtml(rest)}</td>`);
      expect(row).toContain(`<td>${escapeHtml(assumption.reason)}</td>`);
    });
  });

  it('prints assumption values in the page\'s units', () => {
    const by = Object.fromEntries(ASSUMPTIONS.map(assumption => [assumption.key, assumptionValueParts(assumption)]));
    expect(by.relayPriceCents).toEqual({ figure: '$10.00', rest: 'per package' });
    expect(by.courierEnvelopeCents).toEqual({ figure: '$14.00', rest: 'per package' });
    expect(by.courierSmallBoxCents).toEqual({ figure: '$18.00', rest: 'per package' });
    expect(by.courierPromisedByMin).toEqual({ figure: '10:30 a.m.', rest: '(630 minutes after midnight on the next business day)' });
    expect(by.commuterCo2KgPerMile).toEqual({ figure: '0.4', rest: 'kg CO2 per vehicle mile' });
    expect(by.relayMinAddedMPerLeg).toEqual({ figure: '0', rest: 'meters' });
  });

  it('escapes text that comes from the results', () => {
    const odd = renderStudyPage({
      ...sample,
      assumptions: sample.assumptions.map((assumption, index) =>
        index === 0 ? { ...assumption, label: 'A <b>bold</b> label', reason: 'Tom & "Jerry" <script>alert(1)</script> it\'s' } : assumption),
    });
    expect(odd).toContain('A &lt;b&gt;bold&lt;/b&gt; label');
    expect(odd).toContain('Tom &amp; &quot;Jerry&quot; &lt;script&gt;alert(1)&lt;/script&gt; it&#39;s');
    expect(odd).not.toContain('<script');
  });

  it('draws the charts as inline SVG: cost, miles and CO2 per package, the three run distributions, match rate and timing', () => {
    expect(charts(page)).toEqual([
      'cost', 'miles', 'co2',
      'runs-cost', 'runs-miles', 'runs-co2',
      'match-employees', 'match-packages', 'match-detour',
      'timing',
    ]);
    const svgs = page.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
    expect(svgs).toHaveLength(10);
    for (const svg of svgs) {
      expect(svg).toMatch(new RegExp(`^<svg data-chart="[a-z0-9-]+" viewBox="0 0 ${CHART_WIDTH} \\d+" role="img" aria-label="[^"]+">`));
      expect(svg).toMatch(/<(path|rect) class="f-/); // at least one mark
      expect(svg).not.toMatch(/NaN|undefined|Infinity|null/);
    }
  });

  it('the per-package charts carry both series and their values', () => {
    const pinnedPage = renderStudyPage(pinned);
    const chart = (id: string): string => pinnedPage.match(new RegExp(`<svg data-chart="${id}"[\\s\\S]*?</svg>`))![0];
    expect(chart('cost')).toContain('aria-label="Cost to the sender per package: Relay $10.00, courier $15.99"');
    expect(chart('miles')).toContain('aria-label="Added vehicle miles per package: Relay 1.3 mi, courier 5.2 mi"');
    expect(chart('co2')).toContain('aria-label="CO₂ per package: Relay 0.52 kg, courier 2.07 kg"');
    for (const id of ['cost', 'miles', 'co2']) {
      expect(chart(id)).toContain('class="f-relay"');
      expect(chart(id)).toContain('class="f-courier"');
      expect(chart(id)).toMatch(/>Relay<\/text>[\s\S]*>Courier<\/text>/);
    }
    // The smaller value gets the shorter bar: Relay's bar ends before the courier's.
    const widths = [...chart('cost').matchAll(/<path class="f-(?:relay|courier)" d="M[\d.]+ [\d.]+h([\d.]+)/g)].map(match => Number(match[1]));
    expect(widths).toHaveLength(2);
    expect(widths[0]!).toBeLessThan(widths[1]!);
    expect(widths[0]! / widths[1]!).toBeCloseTo(1000 / 1599, 1);
  });

  it('the run distributions count every run that matched a package exactly once', () => {
    const counted = sample.runs.filter(run => run.totals.matched > 0).length;
    expect(counted).toBe(2);
    for (const id of ['runs-cost', 'runs-miles', 'runs-co2']) {
      const chart = page.match(new RegExp(`<svg data-chart="${id}"[\\s\\S]*?</svg>`))![0];
      const perBar = [...chart.matchAll(/<title>[^<]*: (\d+) runs?<\/title>/g)].map(match => Number(match[1]));
      expect(perBar.reduce((total, value) => total + value, 0)).toBe(counted);
    }
    expect(text(page)).toMatch(/Median \$\d+\.\d\d · 10th to 90th percentile \$\d+\.\d\d to \$\d+\.\d\d · Relay ahead in \d of 2 runs/);
    expect(text(page).match(/Relay ahead in \d of 2 runs/g)).toHaveLength(3);
  });

  it('has no row per run: the runs are summarised, and every run is one click away as a CSV', () => {
    expect(page).not.toMatch(/<table class="runs">/);
    for (const run of sample.runs) expect(page).not.toContain(run.id);
    expect(page.match(/<table /g)).toHaveLength(3); // the spread, the detour limits and the assumptions
    expect(page).toContain(`<h2>Every run</h2>`);
    expect(page).toContain(`<a class="download" href="${RUNS_CSV_HREF}" download>Download every run (CSV)</a>`);
    expect(RUNS_CSV_HREF).toBe('study/runs.csv'); // relative: next to the page wherever it is served
    // As many runs as the real study add digits and a few chart marks, not rows: the page stays far below 150 KB.
    const large = renderStudyPage(manyRuns(3024));
    expect(Buffer.byteLength(large) - Buffer.byteLength(page)).toBeLessThan(5_000);
    expect(Buffer.byteLength(large)).toBeLessThan(150_000);
  });

  it('shows the spread across runs: average, median and 10th to 90th percentile, Relay next to the courier', () => {
    const table = page.match(/<table class="figures spread">[\s\S]*?<\/table>/)![0];
    expect([...table.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map(match => match[1])).toEqual(['Per package', 'Sent with', 'Average', 'Median', '10th to 90th percentile']);
    expect([...table.matchAll(/<th scope="rowgroup" rowspan="2">([^<]*)<\/th>/g)].map(match => match[1])).toEqual(['Cost to the sender', 'Added vehicle miles', 'CO₂']);
    expect([...table.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map(match => match[1])).toEqual(['Relay', 'Courier', 'Relay', 'Courier', 'Relay', 'Courier']);
    const rows = [...table.matchAll(/<th scope="row">[^<]*<\/th><td>([^<]*)<\/td><td>([^<]*)<\/td><td><span>([^<]*)<\/span> <span>to ([^<]*)<\/span><\/td><\/tr>/g)].map(match => match.slice(1, 5));
    expect(rows).toHaveLength(6);

    // The figures are the summary's, in the page's units; the averages are the headline's.
    const summary = summarize(sample);
    const h = sample.headline;
    const dollars = (cents: number | null) => `$${(cents! / 100).toFixed(2)}`;
    const mi = (value: number | null) => `${value!.toFixed(1)} mi`;
    const kg = (value: number | null) => `${value!.toFixed(2)} kg`;
    expect(rows[0]).toEqual([dollars(h.relayCostPerPackageCents), dollars(summary.costCents.relay.median), dollars(summary.costCents.relay.low), dollars(summary.costCents.relay.high)]);
    expect(rows[1]).toEqual([dollars(h.courierCostPerPackageCents), dollars(summary.costCents.courier.median), dollars(summary.costCents.courier.low), dollars(summary.costCents.courier.high)]);
    expect(rows[2]).toEqual([mi(h.relayAddedMilesPerPackage), mi(summary.miles.relay.median), mi(summary.miles.relay.low), mi(summary.miles.relay.high)]);
    expect(rows[3]).toEqual([mi(h.courierMilesPerPackage), mi(summary.miles.courier.median), mi(summary.miles.courier.low), mi(summary.miles.courier.high)]);
    expect(rows[4]).toEqual([kg(h.relayCo2KgPerPackage), kg(summary.co2Kg.relay.median), kg(summary.co2Kg.relay.low), kg(summary.co2Kg.relay.high)]);
    expect(rows[5]).toEqual([kg(h.courierCo2KgPerPackage), kg(summary.co2Kg.courier.median), kg(summary.co2Kg.courier.low), kg(summary.co2Kg.courier.high)]);
    expect(text(page)).toContain(`The average is over all ${sample.totals.matched} matched packages. The median and the percentiles are over the 2 runs that matched a package, one per-package value per run: 8 in 10 runs lie between the 10th and the 90th percentile.`);
  });

  it('shows the match rate by employee count as a chart with one line under it, which says "rises" only when it does', () => {
    const groups = (rates: Array<number | null>) => rates.map((matchRate, index) => ({
      ...sample.runs[0]!, id: `g${index}`, params: { ...sample.runs[0]!.params, employees: [30, 60, 120][index]! },
      totals: { ...sample.runs[0]!.totals, packages: 1000, matched: matchRate === null ? 0 : Math.round(matchRate * 1000), matchRate },
    }));
    const withRates = (rates: Array<number | null>): string => renderStudyPage({
      ...sample, grid: { ...sample.grid, employeeCounts: [30, 60, 120] }, runs: groups(rates),
    });
    const card = (html: string): string => html.match(/<figure class="card"><figcaption>By number of commuting employees<\/figcaption>[\s\S]*?<\/figure>/)![0];

    const rising = card(withRates([0.374, 0.593, 0.778]));
    expect(rising).toMatch(/<\/svg><p class="note">The match rate rises as more employees join: 37\.4% with 30 employees, 77\.8% with 120\.<\/p><\/figure>$/);
    expect(chartOf(rising, 'match-employees')).toContain('aria-label="Match rate by number of employees: 30 employees 37.4%, 60 employees 59.3%, 120 employees 77.8%"');
    expect(rising.match(/<p class="note">/g)).toHaveLength(1); // one line of text

    expect(card(withRates([0.5, 0.4, 0.6]))).toContain('<p class="note">The match rate does not rise steadily with the number of employees here: 50.0% with 30 employees, 60.0% with 120.</p>');
    expect(card(withRates([0.6, 0.6, 0.6]))).not.toContain('rises');
    // One employee count (the two-run sample) has nothing to compare: no line.
    expect(card(page)).not.toContain('<p class="note">');
  });

  it('shows the results by detour limit: one row per limit with its runs, match rate and per-package figures', () => {
    const table = page.match(/<table class="figures detour">[\s\S]*?<\/table>/)![0];
    expect([...table.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map(match => match[1]!.replace(/&nbsp;/g, ' '))).toEqual([
      'Detour limit', 'Match rate', 'Relay added mi / pkg', 'Courier mi / pkg', 'Relay CO₂ / pkg', 'Courier CO₂ / pkg', 'Cost saved / pkg', 'A day early', 'Runs',
    ]);
    // The sample has one detour limit, so its row is the whole study.
    const h = sample.headline;
    expect(table.match(/<tbody>\s*([\s\S]*?)\s*<\/tbody>/)![1]).toBe(
      `<tr><th scope="row">12 min</th><td>${(h.matchRate! * 100).toFixed(1)}%</td>`
      + `<td>${h.relayAddedMilesPerPackage!.toFixed(1)} mi</td><td>${h.courierMilesPerPackage!.toFixed(1)} mi</td>`
      + `<td>${h.relayCo2KgPerPackage!.toFixed(2)} kg</td><td>${h.courierCo2KgPerPackage!.toFixed(2)} kg</td>`
      + `<td>$${(h.costSavedPerPackageCents! / 100).toFixed(2)}</td><td>${(h.earlyRate! * 100).toFixed(1)}%</td><td>2</td></tr>`,
    );

    // Three limits give three rows, each over its own runs.
    const three = renderStudyPage({
      ...sample, grid: { ...sample.grid, detourLimitsMin: [8, 12, 16] },
      runs: [8, 12, 12, 16].map((maxExtraMin, index) => ({ ...sample.runs[index % 2]!, id: `d${index}`, params: { ...sample.runs[index % 2]!.params, maxExtraMin } })),
    });
    const rows = [...three.match(/<table class="figures detour">[\s\S]*?<\/table>/)![0].matchAll(/<tr><th scope="row">(\d+) min<\/th>.*<td>(\d+)<\/td><\/tr>/g)].map(match => [match[1], match[2]]);
    expect(rows).toEqual([['8', '1'], ['12', '2'], ['16', '1']]);
  });

  it('makes no network request: no external src or href, no script, no stylesheet, no web font', () => {
    expectSelfContained(page);
    // The CSV is a link the reader may follow, not something the page loads.
    expect(references(page).sort()).toEqual(['#assumptions', '/', '/', 'data:,', 'study/runs.csv']);
    // The check itself sees the forms it is meant to catch.
    expect(references('<a href="https://x.test/a"><img src=//cdn.test/b.png><p style="background:url(\'http://y.test\')">').filter(isExternal))
      .toEqual(['https://x.test/a', '//cdn.test/b.png', 'http://y.test']);
  });

  it('uses the MVP III palette in plain hex and system fonts as the fallback', () => {
    const css = page.match(/<style>([\s\S]*?)<\/style>/)![1]!;
    for (const hex of ['#F7F7F4', '#FFFFFF', '#171C24', '#5B6472', '#E3E3DE', '#1D5075', '#0F8A5F', '#A8ABB2']) expect(css).toContain(hex);
    expect(css).not.toMatch(/var\(/);
    expect(css).toMatch(/font-family:Inter,system-ui,-apple-system,"Segoe UI",[^;}]*sans-serif/);
    expect(css).toContain('@media (max-width:640px)'); // the assumptions table stacks on a phone
  });

  it('never prints NaN, undefined, Infinity or null: for the sample, a study with no run and runs with no match', () => {
    for (const results of [sample, pinned, empty, unmatched, manyRuns(3024)]) {
      const html = renderStudyPage(results);
      expect(html).not.toMatch(/NaN|undefined|Infinity|\bnull\b|\[object/);
      expectSelfContained(html);
      expect(charts(html)).toHaveLength(10);
    }
    const none = text(renderStudyPage(empty));
    expect(none).toContain('Match rate n/a');
    expect(none).toContain('Relay n/a vs courier n/a per package');
    expect(text(renderStudyPage(unmatched))).toContain('2 runs matched no package and are not shown.');
  });

  it('is deterministic: the same results give the same bytes, with no date and no generated id', () => {
    expect(renderStudyPage(sample)).toBe(page);
    expect(renderStudyPage(JSON.parse(JSON.stringify(sample)) as StudyResults)).toBe(page);
    expect(page).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\bid="(?!assumptions")/);
  });
});

// What headless Chrome showed at 1440 px and at a true 390 px viewport (#808), one test per fault. jsdom lays
// nothing out, so each test checks the markup and CSS the measured fault came from.
describe('the study page on a laptop and on a phone (#808)', () => {
  const css = styleOf(page);
  const pinnedPage = renderStudyPage(pinned);

  it('never draws chart text below 12 px: a card is at least as wide as the chart box, also at 390 px', () => {
    // Before: a 360-unit chart in a 324 px card (390 px viewport) was scaled to 0.9, so 12 px text was 10.8 px.
    expect(CHART_TEXT_PX).toBeGreaterThanOrEqual(12);
    expect(css).toContain(`svg text{font-size:${CHART_TEXT_PX}px}`);
    expect(css).not.toMatch(/font-size:(?:\d|1[01])(?:\.\d+)?px/); // no HTML text below 12 px either
    for (const svg of page.match(/<svg[\s\S]*?<\/svg>/g) ?? []) expect(svg).toContain(` viewBox="0 0 ${CHART_WIDTH} `);

    // The chart fills its card (width 100%) and may only grow from its own width.
    const svgRule = rule(css, 'svg');
    expect(svgRule).toContain('width:100%');
    expect(Number(/max-width:(\d+)px/.exec(svgRule)![1])).toBeGreaterThanOrEqual(CHART_WIDTH);

    // The card: its content box is the chart's width when the card is at its narrowest.
    const card = rule(css, '.card');
    const padding = /padding:\d+px (\d+)px \d+px/.exec(card);
    const border = /border-width:(\d+)px/.exec(card);
    expect(padding).not.toBeNull();
    expect(border).not.toBeNull();
    const cardExtra = 2 * (Number(padding![1]) + Number(border![1]));
    expect(CARD_MIN_WIDTH - cardExtra).toBe(CHART_WIDTH);
    expect(css).toContain('*{box-sizing:border-box}');

    // The grid never makes a column narrower than that card, and never wider than a narrow page.
    expect(rule(css, '.grid3')).toContain(`grid-template-columns:repeat(auto-fit,minmax(min(100%,${CARD_MIN_WIDTH}px),1fr))`);

    // At 390 px the one column is the viewport minus the page padding of the phone layout.
    const phone = css.slice(css.indexOf('@media (max-width:640px)'));
    const pagePadding = Number(/main\{padding:\d+px (\d+)px \d+px\}/.exec(phone)![1]);
    expect(390 - 2 * pagePadding).toBeGreaterThanOrEqual(CARD_MIN_WIDTH);
    // Three columns fit the widest page (main is at most 1120 px with 20 px padding and 12 px gaps).
    expect(3 * CARD_MIN_WIDTH + 2 * 12).toBeLessThanOrEqual(1120 - 2 * 20);
  });

  it('keeps every chart text inside the chart box', () => {
    for (const html of [page, pinnedPage, renderStudyPage(empty), renderStudyPage(unmatched), renderStudyPage(manyRuns(3024))]) {
      for (const svg of html.match(/<svg[\s\S]*?<\/svg>/g) ?? []) {
        const height = Number(/viewBox="0 0 \d+ (\d+)"/.exec(svg)![1]);
        const texts = chartTexts(svg);
        expect(texts.length).toBe((svg.match(/<text/g) ?? []).length); // the reader above saw every text
        for (const t of texts) {
          const { left, right } = extent(t);
          expect(left, `${t.text} left`).toBeGreaterThanOrEqual(0);
          expect(right, `${t.text} right`).toBeLessThanOrEqual(CHART_WIDTH);
          expect(t.y - CHART_TEXT_PX * 0.8, `${t.text} top`).toBeGreaterThanOrEqual(0); // cap height above the baseline
          expect(t.y + CHART_TEXT_PX * 0.25, `${t.text} bottom`).toBeLessThanOrEqual(height); // descender below it
        }
      }
    }
  });

  it('keeps the axis labels of a run distribution apart: "runs" above the top count, the bin labels below "0"', () => {
    // Before: "runs" sat 12 units above the top count label and "0" 13 units above the first bin label,
    // both at the same x, so at 390 px they read as one block.
    const lineGap = CHART_TEXT_PX + 4;
    for (const id of ['runs-cost', 'runs-miles', 'runs-co2']) {
      const texts = chartTexts(chartOf(page, id));
      const runsTitle = texts.find(t => t.text === 'runs')!;
      const counts = texts.filter(t => t.cls === 'tm num' && t.anchor === 'end');
      const bins = texts.filter(t => t.cls === 'tm num' && t.anchor === 'middle');
      const axisTitle = texts.find(t => t.cls === 'tm' && t.anchor === 'middle')!;
      expect(counts.length).toBeGreaterThanOrEqual(2);
      expect(bins.length).toBeGreaterThanOrEqual(2);
      expect(counts.map(t => t.text)).toContain('0');

      const topCountY = Math.min(...counts.map(t => t.y));
      const zeroY = counts.find(t => t.text === '0')!.y;
      expect(new Set(bins.map(t => t.y)).size).toBe(1);
      expect(topCountY - runsTitle.y).toBeGreaterThanOrEqual(lineGap);
      expect(bins[0]!.y - zeroY).toBeGreaterThanOrEqual(lineGap);
      expect(axisTitle.y - bins[0]!.y).toBeGreaterThanOrEqual(lineGap);

      // Neighbouring bin labels do not run into each other.
      const sorted = [...bins].sort((a, b) => a.x - b.x);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(extent(sorted[index]!).left, `${sorted[index - 1]!.text} | ${sorted[index]!.text}`).toBeGreaterThan(extent(sorted[index - 1]!).right);
      }
    }
  });

  it('makes room for a four-digit count left of a run distribution, as a study of thousands of runs has', () => {
    // Before #841: the plot started 30 units in, so "1500" (28.8 units wide, ending 6 before the plot) began left of the chart box.
    const large = renderStudyPage(manyRuns(3024));
    for (const id of ['runs-cost', 'runs-miles', 'runs-co2']) {
      const texts = chartTexts(chartOf(large, id));
      const counts = texts.filter(t => t.cls === 'tm num' && t.anchor === 'end');
      expect(Math.max(...counts.map(t => t.text.length)), id).toBe(4);
      for (const t of counts) expect(extent(t).left, `${id} ${t.text}`).toBeGreaterThanOrEqual(0);
      // The count above the tallest column has its thousands separator.
      const peak = texts.filter(t => t.cls === 't num' && t.anchor === 'middle');
      expect(peak).toHaveLength(1);
      expect(peak[0]!.text).toMatch(/^\d,\d{3}$/);
      // Every run is in exactly one column.
      const perBar = [...chartOf(large, id).matchAll(/<title>[^<]*: ([\d,]+) runs?<\/title>/g)].map(match => Number(match[1]!.replace(/,/g, '')));
      expect(perBar.reduce((total, value) => total + value, 0)).toBe(3024);
    }
    expect(text(large)).toMatch(/Relay ahead in [\d,]+ of 3,024 runs/);
  });

  it('keeps a row label clear of its bar in the match-rate and per-package charts', () => {
    for (const id of ['match-employees', 'match-packages', 'match-detour', 'cost', 'miles', 'co2']) {
      const svg = chartOf(pinnedPage, id);
      const starts = [...svg.matchAll(/<(?:rect class="f-track" x="|path class="f-[a-z]+" d="M)([\d.]+)/g)].map(match => Number(match[1]));
      expect(starts.length).toBeGreaterThanOrEqual(1);
      const barStart = Math.min(...starts);
      const names = chartTexts(svg).filter(t => t.cls === 't' && t.x === 0);
      expect(names.length).toBeGreaterThanOrEqual(1); // the two-run sample has one row per match-rate chart
      for (const name of names) expect(extent(name).right, name.text).toBeLessThan(barStart);
    }
    // And the figure after a per-package bar ends inside the box even for the longest bar.
    for (const id of ['cost', 'miles', 'co2']) {
      for (const value of chartTexts(chartOf(pinnedPage, id)).filter(t => t.cls === 't num')) {
        expect(extent(value).right, value.text).toBeLessThanOrEqual(CHART_WIDTH);
      }
    }
  });

  it('asks the server for nothing but itself: the tab icon is an empty data: URL', () => {
    // Before: with no icon named, Chrome asked for /favicon.ico (and got the app's index.html).
    const head = page.slice(0, page.indexOf('</head>'));
    expect(head).toContain(EMPTY_ICON);
    expect(page.match(/<link\b/g)).toHaveLength(1);
    expect(page).not.toMatch(/favicon|\.ico\b|\.png\b/);
  });

  it('lets the headers of the figure tables wrap and keeps each figure on one line; a table scrolls inside its own box', () => {
    // #808: one-line headers made the old run table wider than the page at 1440 px. The two tables of figures keep that rule.
    expect(rule(css, '.figures thead th')).toContain('white-space:normal');
    expect(rule(css, '.figures th,.figures td')).toContain('white-space:nowrap'); // the numbers stay on one line
    const header = page.match(/<table class="figures detour">\s*<thead>([\s\S]*?)<\/thead>/)![1]!;
    const columns = [...header.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map(match => match[1]!);
    expect(columns).toHaveLength(9);
    // "/ pkg" stays together, so a header breaks before the slash, not after it.
    expect(columns.filter(column => column.includes('pkg'))).toHaveLength(5);
    for (const column of columns.filter(column => column.includes('pkg'))) expect(column).toMatch(/ \/&nbsp;pkg$/);
    // On a phone the spread table fits (its range may break before "to", never inside a figure) and a wider
    // table scrolls inside its own box, not the page (headless Chrome at 390 px, #841).
    expect(rule(css, '.figures td span')).toContain('white-space:nowrap');
    expect(css.slice(css.indexOf('@media (max-width:640px)'))).toContain('.figures.spread td:last-child{white-space:normal}');
    expect(page).toMatch(/<div class="scroll">\s*<table class="figures detour">/);
    expect(page).toMatch(/<div class="scroll">\s*<table class="figures spread">/);
    expect(rule(css, '.scroll')).toContain('overflow-x:auto');
    expect(css).not.toContain('.runs');
  });

  it('lines the headline values up when one label needs two lines: tiles share their rows', () => {
    // Before: at 1440 px "Delivered by the courier’s promised time" wrapped and its value sat a line lower.
    const tileRule = rule(css, '.tile');
    expect(tileRule).toContain('display:grid');
    expect(tileRule).toContain('grid-row:span 3');
    expect(tileRule).toContain('grid-template-rows:subgrid');
    expect(rule(css, '.tiles')).toContain('row-gap:0'); // no gap between the three rows inside a tile
    expect(rule(css, '.tile-label')).toContain('align-self:end'); // a one-line label stays next to its value
    // Three rows per tile: label, value, detail, and nothing else in the section.
    const section = page.match(/<section class="tiles"[^>]*>([\s\S]*?)<\/section>/)![1]!;
    expect(headlineTiles(section)).toHaveLength(5);
    expect(section.match(/<p /g)).toHaveLength(15);
    expect(section.replace(/<div class="tile">(?:<p class="tile-(?:label|value|detail)">[^<]*<\/p>){3}<\/div>/g, '').trim()).toBe('');
  });

  it('changes no headline number: the tiles depend on the results only', () => {
    expect(headlineTiles(pinnedPage).map(tile => tile.value)).toEqual(['37.4% less', '74.8% less', '75.1% less', '98.8%', '53.4%']);
    expect(headlineTiles(pinnedPage)[0]).toEqual({
      label: 'Cost to the sender', value: '37.4% less', detail: 'Relay $10.00 vs courier $15.99 per package',
    });
  });
});

describe('the committed client/public/study.html', () => {
  const committed = fs.readFileSync(DEFAULT_STUDY_PAGE, 'utf8');

  it('has every assumption of scripts/study/assumptions.ts: key, label, value and reason', () => {
    const rows = [...committed.matchAll(/<tr data-key="([^"]+)">([\s\S]*?)<\/tr>/g)];
    expect(rows.map(row => row[1])).toEqual([...ASSUMPTION_KEYS]);
    ASSUMPTIONS.forEach((assumption, index) => {
      const row = rows[index]![2]!;
      const { figure, rest } = assumptionValueParts(assumption);
      expect(row).toContain(escapeHtml(assumption.label));
      expect(row).toContain(`<b class="num">${escapeHtml(figure)}</b> ${escapeHtml(rest)}</td>`);
      expect(row).toContain(`<td>${escapeHtml(assumption.reason)}</td>`);
    });
  });

  it('is self-contained, complete and free of NaN', () => {
    expectSelfContained(committed);
    expect(committed).not.toMatch(/NaN|undefined|Infinity|\bnull\b/);
    expect(committed).toContain('<title>Relay vs. a next-day courier: the numbers</title>');
    expect(committed).toContain('<a class="back" href="/">');
    expect(charts(committed)).toHaveLength(10);
    expect(text(committed)).toContain('standard next-day B2B courier');
    expect(text(committed)).toMatch(/Runs skipped \d+/);
  });

  it('stays under 150 KB and has no row per run', () => {
    expect(Buffer.byteLength(committed)).toBeLessThan(150_000);
    expect(committed).not.toMatch(/<table class="runs">/);
    expect(committed.match(/<table /g)).toHaveLength(3);
  });
});
