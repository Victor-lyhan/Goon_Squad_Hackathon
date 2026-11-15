// `npm run study`: the command line around runStudy. Writes only into a temp folder; reads the committed cache.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STUDY_OUT, DEFAULT_STUDY_PAGE, pageDifference, runStudyCli, serializeStudy, summaryLines } from '../../scripts/study/cli';
import { headlineTiles, renderStudyPage } from '../../scripts/study/page';
import { runStudy } from '../../scripts/study/runner';
import { TWO_RUN_GRID, studyInput } from './study-helper';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-study-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(argv: string[], options: Parameters<typeof runStudyCli>[0] = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runStudyCli({
    grid: TWO_RUN_GRID, ...options, argv,
    stdout: line => stdout.push(line), stderr: line => stderr.push(line),
  });
  return { code, stdout, stderr };
}

describe('npm run study', () => {
  it('is wired in package.json and writes to data/study/results.json, which git ignores', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.study).toBe('tsx scripts/study.ts');
    expect(fs.existsSync(path.join(repoRoot, 'scripts', 'study.ts'))).toBe(true);
    expect(path.relative(repoRoot, DEFAULT_STUDY_OUT)).toBe(path.join('data', 'study', 'results.json'));
    expect(fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8').split('\n')).toContain('/data/');
  });

  it('writes the results file and prints the five summary lines', () => {
    const out = path.join(tmp, 'nested', 'results.json');
    const { code, stdout, stderr } = run(['--out', out]);
    expect(code).toBe(0);
    expect(stdout).toHaveLength(5);
    expect(stdout[0]).toMatch(/^Runs: 2 simulated, 0 skipped/);
    expect(stdout[1]).toMatch(/^Packages: 48 requested, \d+ matched and delivered by Relay$/);
    expect(stdout[2]).toMatch(/^Match rate: \d+\.\d%$/);
    expect(stdout[3]).toMatch(/^Cost saved per package: \$\d+\.\d\d \(Relay \$10\.00 vs courier \$\d+\.\d\d\)$/);
    expect(stdout[4]).toMatch(/^CO2 saved per package: \d+\.\d\d kg \(Relay \d+\.\d\d kg vs courier \d+\.\d\d kg\)$/);
    expect(stderr.join('\n')).toMatch(/^Wrote .*results\.json$/);

    const expected = runStudy(studyInput({ grid: TWO_RUN_GRID }));
    expect(fs.readFileSync(out, 'utf8')).toBe(serializeStudy(expected));
    expect(stdout).toEqual(summaryLines(expected));
    expect(fs.readdirSync(path.dirname(out))).toEqual(['results.json']); // no temp file left behind
  });

  it('writes a byte-identical file when run again', () => {
    const first = path.join(tmp, 'first.json');
    const second = path.join(tmp, 'second.json');
    expect(run(['--out', first]).code).toBe(0);
    expect(run(['--out', second]).code).toBe(0);
    expect(fs.readFileSync(second).equals(fs.readFileSync(first))).toBe(true);
    // Overwriting an existing file gives the same bytes again.
    expect(run(['--out', first]).code).toBe(0);
    expect(fs.readFileSync(first).equals(fs.readFileSync(second))).toBe(true);
  });

  it('says so and writes nothing when there is no travel cache', () => {
    const empty = path.join(tmp, 'no-cache');
    fs.mkdirSync(empty);
    const out = path.join(tmp, 'never.json');
    const { code, stdout, stderr } = run(['--out', out], { fixturesDir: empty });
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('\n')).toMatch(/No travel cache/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('rejects an unknown argument and a missing --out value', () => {
    const unknown = run(['--fast']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr[0]).toBe('Unknown argument: --fast');
    expect(unknown.stdout).toEqual([]);
    const missing = run(['--out']);
    expect(missing.code).toBe(2);
    expect(missing.stderr[0]).toBe('--out needs a file path.');
  });

  it('writes the page after the results when --page names a file, the same bytes every time', () => {
    const out = path.join(tmp, 'page-run', 'results.json');
    const page = path.join(tmp, 'page-run', 'site', 'study.html');
    const { code, stdout, stderr } = run(['--out', out, '--page', page]);
    expect(code).toBe(0);
    expect(stderr).toHaveLength(2);
    expect(stderr[0]).toMatch(/^Wrote .*results\.json$/);
    expect(stderr[1]).toMatch(/^Wrote .*study\.html$/);

    const expected = runStudy(studyInput({ grid: TWO_RUN_GRID }));
    expect(fs.readFileSync(out, 'utf8')).toBe(serializeStudy(expected));
    expect(fs.readFileSync(page, 'utf8')).toBe(renderStudyPage(expected));
    expect(stdout).toEqual(summaryLines(expected));
    expect(fs.readdirSync(path.dirname(page))).toEqual(['study.html']); // no temp file left behind

    const again = path.join(tmp, 'page-run', 'again.html');
    expect(run(['--out', out, '--page', again]).code).toBe(0);
    expect(fs.readFileSync(again).equals(fs.readFileSync(page))).toBe(true);
  });

  it('a plain run writes the page to client/public/study.html; --out alone leaves that file alone', () => {
    expect(path.relative(repoRoot, DEFAULT_STUDY_PAGE)).toBe(path.join('client', 'public', 'study.html'));
    // client/public is Vite's public folder (root: client), so the build copies the page to client/dist.
    expect(fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8')).toMatch(/root: 'client'/);

    const before = fs.readFileSync(DEFAULT_STUDY_PAGE);
    const { code, stderr } = run(['--out', path.join(tmp, 'only-results.json')]); // a two-run grid
    expect(code).toBe(0);
    expect(stderr).toHaveLength(1);
    expect(fs.readFileSync(DEFAULT_STUDY_PAGE).equals(before)).toBe(true);
  });

  it('rejects --page without a file', () => {
    const missing = run(['--page']);
    expect(missing.code).toBe(2);
    expect(missing.stderr[0]).toBe('--page needs a file path.');
  });

  it('prints help without running', () => {
    const { code, stdout } = run(['--help']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toMatch(/Usage: npm run study/);
  });
});

describe('npm run study -- --check', () => {
  afterEach(() => vi.restoreAllMocks());

  const FIX = 'Run `npm run study` and commit the page.';

  /** A page of the two-run grid in its own temp folder, as `npm run study -- --page` writes it. */
  function tempPage(name: string): { file: string; html: string } {
    const file = path.join(tmp, name, 'study.html');
    expect(run(['--out', path.join(tmp, name, 'results.json'), '--page', file]).code).toBe(0);
    fs.rmSync(path.join(tmp, name, 'results.json'));
    return { file, html: fs.readFileSync(file, 'utf8') };
  }

  /** `--check` on `file`, with every way cli.ts writes watched: the check must not call any of them. */
  function check(file: string) {
    const writes = [vi.spyOn(fs, 'writeFileSync'), vi.spyOn(fs, 'renameSync'), vi.spyOn(fs, 'mkdirSync'), vi.spyOn(fs, 'rmSync')];
    const result = run(['--check', '--page', file]);
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    return result;
  }

  it('exits 0 on a page that is what the run would write, and writes nothing', () => {
    const { file, html } = tempPage('check-same');
    const { code, stdout, stderr } = check(file);
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toMatch(/study\.html matches a fresh study run \(2 runs, \d+ packages compared\)\.$/);
    expect(fs.readFileSync(file, 'utf8')).toBe(html);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['study.html']); // no results file, no temp file
  });

  it('exits 1 with one line that names the edited headline number and says how to fix it', () => {
    const { file, html } = tempPage('check-number');
    const cost = headlineTiles(html)[0]!;
    expect(cost.label).toBe('Cost to the sender');
    // The label is part of what is replaced: two tiles can show the same figure.
    const edited = html.replace(`<p class="tile-label">${cost.label}</p><p class="tile-value">${cost.value}</p>`, `<p class="tile-label">${cost.label}</p><p class="tile-value">99.9% less</p>`);
    expect(edited).not.toBe(html);
    fs.writeFileSync(file, edited);

    const { code, stdout, stderr } = check(file);
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toMatch(/study\.html is out of date: /);
    expect(stderr[0]).toContain(`"Cost to the sender" is 99.9% less on the page but ${cost.value} in a fresh run. ${FIX}`);
    expect(stderr[0]).not.toContain('\n');
    expect(fs.readFileSync(file, 'utf8')).toBe(edited); // the check never repairs the page
  });

  it('names a headline number whose small print changed, and the first one when several did', () => {
    const { file, html } = tempPage('check-detail');
    const [, miles, co2] = headlineTiles(html);
    const edited = html
      .replace(`<p class="tile-detail">${miles!.detail}</p>`, '<p class="tile-detail">Relay 9.9 mi vs courier 1.0 mi per package</p>')
      .replace(`<p class="tile-label">${co2!.label}</p><p class="tile-value">${co2!.value}</p>`, `<p class="tile-label">${co2!.label}</p><p class="tile-value">1.0% less</p>`);
    expect(headlineTiles(edited).map(tile => tile.value !== '1.0% less')).toEqual([true, true, false, true, true]);
    fs.writeFileSync(file, edited);
    const { code, stderr } = check(file);
    expect(code).toBe(1);
    expect(stderr).toEqual([
      `${path.relative(process.cwd(), file).startsWith('..') ? file : path.relative(process.cwd(), file)} is out of date: `
      + `"Added vehicle miles" reads "Relay 9.9 mi vs courier 1.0 mi per package" on the page but "${miles!.detail}" in a fresh run. ${FIX}`,
    ]);
  });

  it('says "page differs" when the headline is the same and something else changed', () => {
    const { file, html } = tempPage('check-other');
    const lines = html.split('\n');
    const footer = lines.findIndex(line => line.startsWith('<footer>'));
    expect(footer).toBeGreaterThan(0);
    lines[footer] = lines[footer]!.replace('Generated by', 'Made by');
    fs.writeFileSync(file, lines.join('\n'));
    const { code, stderr } = check(file);
    expect(code).toBe(1);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain(`is out of date: page differs from a fresh run, first at line ${footer + 1} (the headline numbers are the same). ${FIX}`);

    // One byte is enough: a missing final newline.
    fs.writeFileSync(file, html.slice(0, -1));
    const trimmed = check(file);
    expect(trimmed.code).toBe(1);
    expect(trimmed.stderr[0]).toMatch(/page differs/);
  });

  it('says a headline number is not on the page when its tile is gone', () => {
    const { file, html } = tempPage('check-missing-tile');
    fs.writeFileSync(file, html.replace(/<div class="tile"><p class="tile-label">Match rate<[^\n]*\n/, ''));
    const { code, stderr } = check(file);
    expect(code).toBe(1);
    expect(stderr[0]).toContain(`the headline number "Match rate" is not on the page. ${FIX}`);
  });

  it('exits 1 when the page does not exist, and does not create it', () => {
    const file = path.join(tmp, 'check-absent', 'study.html');
    const { code, stdout, stderr } = check(file);
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain(`study.html does not exist. ${FIX}`);
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });

  it('checks client/public/study.html when no --page is given', () => {
    // The two-run grid can never give the committed 81-run page, so this shows which file was read.
    const before = fs.readFileSync(DEFAULT_STUDY_PAGE);
    const { code, stderr } = run(['--check']);
    expect(code).toBe(1);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toMatch(/^client[\\/]public[\\/]study\.html is out of date: /);
    expect(fs.readFileSync(DEFAULT_STUDY_PAGE).equals(before)).toBe(true);
  });

  it('cannot be combined with --out, and still needs the travel cache', () => {
    const out = path.join(tmp, 'check-out.json');
    const both = run(['--check', '--out', out]);
    expect(both.code).toBe(2);
    expect(both.stderr[0]).toBe('--check writes nothing, so it cannot be used with --out.');
    expect(fs.existsSync(out)).toBe(false);

    const empty = path.join(tmp, 'check-no-cache');
    fs.mkdirSync(empty);
    const noCache = run(['--check'], { fixturesDir: empty });
    expect(noCache.code).toBe(1);
    expect(noCache.stderr.join('\n')).toMatch(/No travel cache/);
  });

  it('is in the help text, and is a flag of the existing script', () => {
    expect(run(['--help']).stdout.join('\n')).toMatch(/npm run study -- --check/);
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts).filter(name => name.includes('study'))).toEqual(['study']);
  });
});

describe('pageDifference', () => {
  const page = renderStudyPage(runStudy(studyInput({ grid: TWO_RUN_GRID })));

  it('is null only for the same bytes', () => {
    expect(pageDifference(page, page)).toBeNull();
    expect(pageDifference(`${page} `, page)).toMatch(/^page differs/);
    expect(pageDifference(`\uFEFF${page}`, page)).toMatch(/^page differs from a fresh run, first at line 1 /);
    expect(pageDifference(page.replace(/\n/g, '\r\n'), page)).toMatch(/^page differs from a fresh run, first at line 1 /);
  });

  it('reads the five headline tiles back out of a rendered page', () => {
    expect(headlineTiles(page).map(tile => tile.label)).toEqual([
      'Cost to the sender', 'Added vehicle miles', 'CO₂', 'Delivered by the courier’s promised time', 'Match rate',
    ]);
    for (const tile of headlineTiles(page)) {
      expect(tile.value).not.toBe('');
      expect(page).toContain(`<p class="tile-value">${tile.value}</p><p class="tile-detail">${tile.detail}</p>`);
    }
  });
});

describe('the summary lines', () => {
  it('have no NaN when nothing was matched', () => {
    const results = runStudy(studyInput({ grid: TWO_RUN_GRID }));
    const none = {
      ...results,
      headline: {
        ...results.headline,
        costSavedPerPackageCents: null, relayCostPerPackageCents: null, courierCostPerPackageCents: null,
        co2SavedKgPerPackage: null, relayCo2KgPerPackage: null, courierCo2KgPerPackage: null, matchRate: null,
      },
    };
    const lines = summaryLines(none);
    expect(lines).toHaveLength(5);
    expect(lines.join('\n')).not.toMatch(/NaN|null|undefined/);
    expect(lines[3]).toBe('Cost saved per package: n/a (no package matched)');
  });
});
