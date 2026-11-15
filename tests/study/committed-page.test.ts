// The committed client/public/study.html, read as a visitor reads it: the claim of docs/mvp4.md F3 (Relay
// beats a next-day courier on cost, added miles and CO2 per package, with the match rate shown) and that the
// page is still what `npm run study` writes. The page embeds no results file, so the numbers are read from
// its headline tiles. No number of the study is pinned here: a new travel cache may move them, and then only
// the relations below and the freshness check must still hold.
// No key, no network, nothing written outside a temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_STUDY_PAGE, runStudyCli } from '../../scripts/study/cli';
import { headlineTiles, type HeadlineTile } from '../../scripts/study/page';
import { STUDY_TIMEOUT_MS } from './study-helper';

const html = fs.readFileSync(DEFAULT_STUDY_PAGE, 'utf8');
const tiles = headlineTiles(html);

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

function runCli(argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runStudyCli({ argv, stdout: line => stdout.push(line), stderr: line => stderr.push(line) });
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

// The full 81-run study takes well under 20 s in the test runner (about a second; see SUMMARY.md of #799),
// so the committed page is checked against a fresh full run here. When this fails after a change to the
// travel cache, the fixtures or the engine: run `npm run study` and commit client/public/study.html.
describe('npm run study -- --check on the committed page (the full study)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-study-page-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('the committed page is byte-identical to what a fresh run writes', () => {
    const before = fs.readFileSync(DEFAULT_STUDY_PAGE);
    const result = runCli(['--check']);
    // The message is part of the expectation so a stale page fails with the line that says what moved.
    expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: [] });
    expect(result.stdout).toHaveLength(1);
    expect(result.stdout[0]).toMatch(/study\.html matches a fresh study run \(\d+ runs, \d+ packages compared\)\.$/);
    expect(fs.readFileSync(DEFAULT_STUDY_PAGE).equals(before)).toBe(true);
  }, STUDY_TIMEOUT_MS);

  it('a temp copy passes unchanged and fails, naming the number, once one headline number is edited', () => {
    const copy = path.join(tmp, 'study.html');
    fs.copyFileSync(DEFAULT_STUDY_PAGE, copy);
    expect(runCli(['--check', '--page', copy]).code).toBe(0);

    const co2 = tileOf('CO₂');
    // The label is part of what is replaced: two tiles can show the same figure.
    const edited = html.replace(`<p class="tile-label">CO₂</p><p class="tile-value">${co2.value}</p>`, '<p class="tile-label">CO₂</p><p class="tile-value">0.1% less</p>');
    expect(edited).not.toBe(html);
    fs.writeFileSync(copy, edited);
    const { code, stdout, stderr } = runCli(['--check', '--page', copy]);
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain(`is out of date: "CO₂" is 0.1% less on the page but ${co2.value} in a fresh run. Run \`npm run study\` and commit the page.`);
    expect(fs.readdirSync(tmp)).toEqual(['study.html']); // nothing written next to the page
  }, STUDY_TIMEOUT_MS);
});
