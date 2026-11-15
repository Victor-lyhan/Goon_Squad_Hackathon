// The committed client/public/study.html, read as a visitor reads it: the claim of docs/mvp4.md F3 (Relay
// beats a next-day courier on cost, added miles and CO2 per package, with the match rate shown), the committed
// client/public/study/runs.csv it links to, and that both are still what `npm run study` writes. The page
// embeds no results file, so the numbers are read from its headline tiles and from the CSV. No number of the
// study is pinned here: a new travel cache may move them, and then only the relations below and the
// freshness check must still hold.
// No key, no network, nothing written outside a temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_STUDY_CSV, DEFAULT_STUDY_PAGE, csvDifference, pageDifference, runStudyCli } from '../../scripts/study/cli';
import { RUNS_CSV_COLUMNS } from '../../scripts/study/csv';
import { DEFAULT_GRID, gridRuns, runIdOf } from '../../scripts/study/grid';
import { RUNS_CSV_HREF, headlineTiles, type HeadlineTile } from '../../scripts/study/page';
import { STUDY_TIMEOUT_MS, sum } from './study-helper';

const html = fs.readFileSync(DEFAULT_STUDY_PAGE, 'utf8');
const tiles = headlineTiles(html);
const csv = fs.readFileSync(DEFAULT_STUDY_CSV, 'utf8');
/** The CSV's rows as objects keyed by column name. No field of the committed file is quoted (checked below). */
const rows = csv.split('\n').slice(1, -1).map(line => Object.fromEntries(line.split(',').map((cell, index) => [RUNS_CSV_COLUMNS[index]!, cell])));
const count = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pageText = html.replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function tileOf(label: string): HeadlineTile {
  const found = tiles.filter(tile => tile.label === label);
  expect(found, `headline tile "${label}"`).toHaveLength(1);
  return found[0]!;
}

/** The two figures of "Relay <a> vs courier <b> per package", which must have exactly the shape `figure`. */
function relayAndCourier(detail: string, figure: string): { relay: number; courier: number } {
  const match = new RegExp(`^Relay ${figure} vs courier ${figure} per package$`).exec(detail);
  expect(match, `"${detail}"`).not.toBeNull();
  return { relay: Number(match![1]), courier: Number(match![2]) };
}

/** "37.4% less" -> 37.4. A page that said "more" (Relay behind) has no such value. */
function percentLess(value: string): number {
  const match = /^(\d+\.\d)% less$/.exec(value);
  expect(match, `"${value}"`).not.toBeNull();
  return Number(match![1]);
}

/** The words a screen reader gets for one chart. */
function chartLabel(id: string): string {
  const match = new RegExp(`<svg data-chart="${id}"[^>]* aria-label="([^"]*)"`).exec(html);
  expect(match, `chart "${id}"`).not.toBeNull();
  return match![1]!;
}

async function runCli(argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runStudyCli({ argv, stdout: line => stdout.push(line), stderr: line => stderr.push(line) });
  return { code, stdout, stderr };
}

describe('the headline of the committed client/public/study.html (docs/mvp4.md F3)', () => {
  it('has the five headline numbers, each once', () => {
    expect(tiles.map(tile => tile.label)).toEqual([
      'Cost to the sender', 'Added vehicle miles', 'CO₂', 'Delivered by the courier’s promised time', 'Match rate',
    ]);
  });

  it('shows Relay cheaper for the sender than the courier, per package', () => {
    const tile = tileOf('Cost to the sender');
    const { relay, courier } = relayAndCourier(tile.detail, '\\$(\\d+\\.\\d\\d)');
    expect(relay).toBeGreaterThan(0);
    expect(relay).toBeLessThan(courier);
    expect(percentLess(tile.value)).toBeGreaterThan(0);
    expect(chartLabel('cost')).toBe(`Cost to the sender per package: Relay $${relay.toFixed(2)}, courier $${courier.toFixed(2)}`);
  });

  it('shows Relay adding fewer vehicle miles than the courier, per package', () => {
    const tile = tileOf('Added vehicle miles');
    const { relay, courier } = relayAndCourier(tile.detail, '(\\d+\\.\\d) mi');
    expect(relay).toBeGreaterThanOrEqual(0);
    expect(relay).toBeLessThan(courier);
    expect(percentLess(tile.value)).toBeGreaterThan(0);
    expect(chartLabel('miles')).toBe(`Added vehicle miles per package: Relay ${relay.toFixed(1)} mi, courier ${courier.toFixed(1)} mi`);
  });

  it('shows Relay emitting less CO₂ than the courier, per package', () => {
    const tile = tileOf('CO₂');
    const { relay, courier } = relayAndCourier(tile.detail, '(\\d+\\.\\d\\d) kg');
    expect(relay).toBeGreaterThanOrEqual(0);
    expect(relay).toBeLessThan(courier);
    expect(percentLess(tile.value)).toBeGreaterThan(0);
    expect(chartLabel('co2')).toBe(`CO₂ per package: Relay ${relay.toFixed(2)} kg, courier ${courier.toFixed(2)} kg`);
  });

  it('shows the match rate, and it is the share of the packages the page counts', () => {
    const tile = tileOf('Match rate');
    const shown = /^(\d+\.\d)%$/.exec(tile.value);
    expect(shown, `"${tile.value}"`).not.toBeNull();
    const counts = /^([\d,]+) of ([\d,]+) packages found a commute$/.exec(tile.detail);
    expect(counts, `"${tile.detail}"`).not.toBeNull();
    const matched = Number(counts![1]!.replace(/,/g, ''));
    const packages = Number(counts![2]!.replace(/,/g, ''));
    expect(matched).toBeGreaterThan(0);
    expect(matched).toBeLessThanOrEqual(packages);
    // Within the one decimal the page prints (the page rounds the rate before it makes the percentage).
    expect(Math.abs(Number(shown![1]) - (matched / packages) * 100)).toBeLessThanOrEqual(0.1);
    expect(Number(shown![1])).toBeLessThanOrEqual(100);
    expect(html).toContain(`<h2>Match rate: ${tile.value}</h2>`);
  });
});

describe('the committed page and client/public/study/runs.csv (#841)', () => {
  const planned = gridRuns(DEFAULT_GRID);

  it('has the number of simulations as its headline: 3,024', () => {
    expect(planned).toHaveLength(3024);
    expect(html).toContain('<h1>3,024 simulations</h1>');
    expect(pageText).toContain('3,024 runs planned, 3,024 simulated, 0 skipped');
    expect(pageText).toContain('every combination of seeds 1 to 112; 30, 60, 120 commuting employees; 24'.replace('; 24', '; 12, 24, 48 packages'));
  });

  it('stays under 150 KB with no row per run, and links to the CSV of every run, which is committed next to it', () => {
    expect(fs.statSync(DEFAULT_STUDY_PAGE).size).toBeLessThan(150_000);
    for (const id of [runIdOf(planned[0]!), runIdOf(planned.at(-1)!)]) expect(html).not.toContain(id);
    expect(html).toContain(`<a class="download" href="${RUNS_CSV_HREF}" download>Download every run (CSV)</a>`);
    expect(path.resolve(path.dirname(DEFAULT_STUDY_PAGE), RUNS_CSV_HREF)).toBe(DEFAULT_STUDY_CSV);
    expect(fs.existsSync(DEFAULT_STUDY_CSV)).toBe(true);
  });

  it('the CSV has every planned run once, in grid order, all simulated', () => {
    expect(csv.split('\n')[0]).toBe(RUNS_CSV_COLUMNS.join(','));
    expect(csv).not.toMatch(/"|\r|NaN|null|undefined/);
    expect(rows.map(row => row.run)).toEqual(planned.map(runIdOf));
    for (const [index, row] of rows.entries()) {
      const params = planned[index]!;
      expect([row.seed, row.employees, row.packages_requested, row.detour_limit_min, row.status])
        .toEqual([String(params.seed), String(params.employees), String(params.packages), String(params.maxExtraMin), 'simulated']);
    }
  });

  it('the page counts what the CSV holds: runs, packages requested and matched, how they were carried and when they arrived', () => {
    const total = (column: string): number => sum(rows.map(row => Number(row[column])));
    expect(pageText).toContain(`Runs simulated ${count(rows.length)} `);
    expect(pageText).toContain(`Packages requested ${count(total('packages_requested'))} `);
    expect(pageText).toContain(`Matched and compared ${count(total('packages_matched'))} `);
    expect(pageText).toContain(`Carried on one commute ${count(total('matched_on_one_commute'))} `);
    expect(pageText).toContain(`Carried on two commutes, one relay point ${count(total('matched_on_two_commutes'))} `);
    expect(tileOf('Match rate').detail).toBe(`${count(total('packages_matched'))} of ${count(total('packages_requested'))} packages found a commute`);
    expect(total('packages_matched') + total('packages_unmatched')).toBe(total('packages_requested'));
    expect(total('delivered_a_day_early') + total('delivered_on_time') + total('delivered_late')).toBe(total('packages_matched'));
    // Nothing arrives after the courier's promise, in any run.
    expect(total('delivered_late')).toBe(0);
    // The cost tile is the CSV's cents per matched package.
    const dollars = (cents: number): string => `$${(Math.round(cents / total('packages_matched')) / 100).toFixed(2)}`;
    expect(tileOf('Cost to the sender').detail).toBe(`Relay ${dollars(total('relay_cost_cents'))} vs courier ${dollars(total('courier_cost_cents'))} per package`);
  });

  it('the match rate rises as more employees join, in the CSV and in the line under the chart', () => {
    const rateOf = (employees: number): number => {
      const group = rows.filter(row => Number(row.employees) === employees);
      return sum(group.map(row => Number(row.packages_matched))) / sum(group.map(row => Number(row.packages_requested)));
    };
    const rates = DEFAULT_GRID.employeeCounts.map(rateOf);
    expect(rates[0]!).toBeLessThan(rates[1]!);
    expect(rates[1]!).toBeLessThan(rates[2]!);
    const percent = (fraction: number): string => `${(Math.round(fraction * 10_000) / 100).toFixed(1)}%`;
    expect(html).toContain(`<p class="note">The match rate rises as more employees join: ${percent(rates[0]!)} with 30 employees, ${percent(rates[2]!)} with 120.</p>`);
    expect(chartLabel('match-employees')).toBe(`Match rate by number of employees: 30 employees ${percent(rates[0]!)}, 60 employees ${percent(rates[1]!)}, 120 employees ${percent(rates[2]!)}`);
  });

  it('has the spread across runs and the results by detour limit, one row per limit over a third of the runs', () => {
    expect(html).toContain('<h2>Spread across runs</h2>');
    expect(html).toMatch(/<table class="figures spread">/);
    expect(html).toContain('<h2>Results by detour limit</h2>');
    const detour = html.match(/<table class="figures detour">[\s\S]*?<\/table>/)![0];
    expect([...detour.matchAll(/<tr><th scope="row">(\d+) min<\/th><td>\d+\.\d%<\/td>.*<td>([\d,]+)<\/td><\/tr>/g)].map(match => [match[1], match[2]]))
      .toEqual(DEFAULT_GRID.detourLimitsMin.map(limit => [String(limit), '1,008']));
    expect(html).toContain('<h2>Assumptions</h2>');
  });
});

// The whole 3,024-run study is run here once per test run, on worker threads (about 4 s on 4 workers, 12 s on
// one thread; no duration is asserted). When this fails after a change to the travel cache, the fixtures, the
// engine or the study: run `npm run study` and commit client/public/study.html and client/public/study/runs.csv.
describe('npm run study -- --check on the committed page and CSV (the full study)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-study-page-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('the committed page and CSV are byte-identical to what a fresh run on worker threads writes', async () => {
    const before = [fs.readFileSync(DEFAULT_STUDY_PAGE), fs.readFileSync(DEFAULT_STUDY_CSV)];
    const result = await runCli(['--check', '--workers', '4']);
    // The message is part of the expectation so a stale page fails with the line that says what moved.
    const progress = result.stderr.filter(line => /^\d+\/3024 runs, /.test(line));
    expect({ code: result.code, stderr: result.stderr.filter(line => !progress.includes(line)) }).toEqual({ code: 0, stderr: [] });
    expect(progress.map(line => line.split(' ')[0])).toEqual(Array.from({ length: 30 }, (_, index) => `${(index + 1) * 100}/3024`));
    expect(result.stdout).toHaveLength(1);
    expect(result.stdout[0]).toMatch(/study\.html and .*study[\\/]runs\.csv match a fresh study run \(3024 runs, \d+ packages compared\)\.$/);
    expect(fs.readFileSync(DEFAULT_STUDY_PAGE).equals(before[0]!)).toBe(true);
    expect(fs.readFileSync(DEFAULT_STUDY_CSV).equals(before[1]!)).toBe(true);
    expect(fs.readdirSync(tmp)).toEqual([]); // nothing written
  }, STUDY_TIMEOUT_MS);

  it('an edit of one headline number or of one CSV row is named by the check\'s comparison', () => {
    // The comparison `--check` makes, on the committed bytes (the small-grid runs of cli.test.ts go through the command itself).
    expect(pageDifference(html, html)).toBeNull();
    expect(csvDifference(csv, csv)).toBeNull();
    const co2 = tileOf('CO₂');
    // The label is part of what is replaced: two tiles can show the same figure.
    const edited = html.replace(`<p class="tile-label">CO₂</p><p class="tile-value">${co2.value}</p>`, '<p class="tile-label">CO₂</p><p class="tile-value">0.1% less</p>');
    expect(edited).not.toBe(html);
    expect(pageDifference(edited, html)).toBe(`"CO₂" is 0.1% less on the page but ${co2.value} in a fresh run`);
    const lines = csv.split('\n');
    lines[2000] = lines[2000]!.replace(',simulated,', ',skipped,');
    expect(csvDifference(lines.join('\n'), csv)).toBe('it differs from a fresh run, first at line 2001');
  });
});
