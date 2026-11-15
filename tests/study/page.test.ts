// The study page (scripts/study/page.ts): rendered from a small real study (two runs on the committed NYC
// cache), and the committed client/public/study.html checked against scripts/study/assumptions.ts.
// No key, no network, nothing written.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSUMPTIONS, ASSUMPTION_KEYS } from '../../scripts/study/assumptions';
import { DEFAULT_STUDY_PAGE } from '../../scripts/study/cli';
import { assumptionValueParts, escapeHtml, renderStudyPage } from '../../scripts/study/page';
import { runStudy } from '../../scripts/study/runner';
import type { StudyResults } from '../../scripts/study/types';
import { STUDY_TIMEOUT_MS, TWO_RUN_GRID, studyInput } from './study-helper';

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
const empty: StudyResults = {
  ...sample,
  grid: {
    ...sample.grid,
    requestWindow: null,
    completedRuns: 0,
    skippedRuns: sample.runs.map(run => ({ id: run.id, params: run.params, reason: 'No travel matrix data for biz-a|home-001' })),
  },
  runs: [],
  totals: {
    ...(Object.fromEntries(Object.keys(sample.totals).map(key => [key, 0])) as unknown as StudyResults['totals']),
    matchRate: null, skippedRuns: sample.runs.length,
  },
  headline: {
    ...(Object.fromEntries(Object.keys(sample.headline).map(key => [key, null])) as unknown as StudyResults['headline']),
    runs: 0, packages: 0, matched: 0,
  },
};

/** Runs that were simulated but matched nothing: the per-package values have nothing to divide by. */
const unmatched: StudyResults = {
  ...empty,
  grid: { ...sample.grid },
  runs: sample.runs.map(run => ({
    ...run,
    packages: [],
    totals: {
      ...(Object.fromEntries(Object.keys(run.totals).map(key => [key, 0])) as unknown as StudyResults['runs'][number]['totals']),
      packages: run.totals.packages, unmatched: run.totals.packages, matchRate: 0,
    },
  })),
  totals: { ...empty.totals, runs: sample.runs.length, skippedRuns: 0, packages: sample.totals.packages, unmatched: sample.totals.packages, matchRate: 0 },
  headline: { ...empty.headline, runs: sample.runs.length, packages: sample.totals.packages, matchRate: 0 },
};

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

function expectSelfContained(html: string): void {
  expect(references(html).filter(isExternal)).toEqual([]);
  expect(html).not.toMatch(/<script|<link|<img|<iframe|<object|<embed|<video|<audio|@import|@font-face|\sxmlns/i);
  expect(html).not.toMatch(/https?:\/\//i);
}

describe('the study page', () => {
  it('is one HTML document with a title, one h1, the how-we-compared paragraph and a link back to /', () => {
    expect(page.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(page.endsWith('</html>\n')).toBe(true);
    const head = page.slice(0, page.indexOf('</head>'));
    expect(head.match(/<title>[^<]+<\/title>/g)).toHaveLength(1);
    expect(page).toContain('<title>Relay vs. a next-day courier: the numbers</title>');
    expect(page.match(/<h1[\s>]/g)).toHaveLength(1);
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
      expect(svg).toMatch(/^<svg data-chart="[a-z0-9-]+" viewBox="0 0 360 \d+" role="img" aria-label="[^"]+">/);
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
    const widths = [...chart('cost').matchAll(/<path class="f-(?:relay|courier)" d="M60 [\d.]+h([\d.]+)/g)].map(match => Number(match[1]));
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
    expect(text(page)).toMatch(/Relay ahead in \d of 2 runs/);
  });

  it('has a table row for every run', () => {
    const table = page.match(/<table class="runs">[\s\S]*?<\/table>/)![0];
    for (const run of sample.runs) {
      expect(table).toContain(`<th scope="row">${run.id}</th><td>${run.params.employees}</td><td>${run.params.packages}</td><td>${run.params.maxExtraMin} min</td><td>${run.totals.matched}</td>`);
    }
    expect(table.match(/<tr>/g)).toHaveLength(sample.runs.length + 1);
  });

  it('makes no network request: no external src or href, no script, no stylesheet, no web font', () => {
    expectSelfContained(page);
    expect(references(page).sort()).toEqual(['#assumptions', '/', '/']);
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
    for (const results of [sample, pinned, empty, unmatched]) {
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
});
