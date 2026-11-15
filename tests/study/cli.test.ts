// `npm run study`: the command line around the study. Writes only into a temp folder; reads the committed cache.
// Unless a test names a worker count, the study runs on the test's own thread (`--workers 1`), so the fs spies
// of the --check tests see every write; the worker threads have their own tests (parallel.test.ts, and below).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STUDY_CSV, DEFAULT_STUDY_OUT, DEFAULT_STUDY_PAGE, PROGRESS_EVERY_RUNS,
  clockTime, csvDifference, pageDifference, progressLine, roughTime, runStudyCli, runsCsvFileFor, serializeStudy, summaryTable, wallTimeLine,
} from '../../scripts/study/cli';
import { RUNS_CSV_COLUMNS, runsCsv } from '../../scripts/study/csv';
import type { GridSpec } from '../../scripts/study/grid';
import { RUNS_CSV_HREF, headlineTiles, renderStudyPage } from '../../scripts/study/page';
import { defaultWorkerCount } from '../../scripts/study/parallel';
import { runStudy } from '../../scripts/study/runner';
import { STUDY_TIMEOUT_MS, TWO_RUN_GRID, allSkipped, noneMatched, studyInput } from './study-helper';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-study-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function run(argv: string[], options: Parameters<typeof runStudyCli>[0] = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runStudyCli({
    grid: TWO_RUN_GRID, ...options,
    argv: argv.includes('--workers') ? argv : ['--workers', '1', ...argv],
    stdout: line => stdout.push(line), stderr: line => stderr.push(line),
  });
  return { code, stdout, stderr };
}

const WALL_TIME = /^Wall time: \d+s on (\d+) workers?$/;

describe('npm run study', () => {
  it('is wired in package.json and writes to data/study/results.json, which git ignores', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.study).toBe('tsx scripts/study.ts');
    expect(fs.existsSync(path.join(repoRoot, 'scripts', 'study.ts'))).toBe(true);
    expect(path.relative(repoRoot, DEFAULT_STUDY_OUT)).toBe(path.join('data', 'study', 'results.json'));
    expect(fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8').split('\n')).toContain('/data/');
  });

  it('writes the results file and prints the summary table, then the wall time and the number of workers', async () => {
    const out = path.join(tmp, 'nested', 'results.json');
    const { code, stdout, stderr } = await run(['--out', out]);
    expect(code).toBe(0);
    expect(stderr.join('\n')).toMatch(/^Wrote .*results\.json$/);

    const expected = runStudy(studyInput({ grid: TWO_RUN_GRID }));
    expect(fs.readFileSync(out, 'utf8')).toBe(serializeStudy(expected));
    expect(stdout.slice(0, -2)).toEqual(summaryTable(expected));
    expect(stdout.at(-2)).toBe('');
    expect(stdout.at(-1)).toMatch(WALL_TIME);
    expect(stdout.at(-1)).toMatch(/ on 1 worker$/);
    expect(fs.readdirSync(path.dirname(out))).toEqual(['results.json']); // no temp file left behind
  });

  it('writes a byte-identical file when run again', async () => {
    const first = path.join(tmp, 'first.json');
    const second = path.join(tmp, 'second.json');
    expect((await run(['--out', first])).code).toBe(0);
    expect((await run(['--out', second])).code).toBe(0);
    expect(fs.readFileSync(second).equals(fs.readFileSync(first))).toBe(true);
    // Overwriting an existing file gives the same bytes again.
    expect((await run(['--out', first])).code).toBe(0);
    expect(fs.readFileSync(first).equals(fs.readFileSync(second))).toBe(true);
  });

  it('says so and writes nothing when there is no travel cache', async () => {
    const empty = path.join(tmp, 'no-cache');
    fs.mkdirSync(empty);
    const out = path.join(tmp, 'never.json');
    const { code, stdout, stderr } = await run(['--out', out], { fixturesDir: empty });
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('\n')).toMatch(/No travel cache/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('rejects an unknown argument and a missing --out value', async () => {
    const unknown = await run(['--fast']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr[0]).toBe('Unknown argument: --fast');
    expect(unknown.stdout).toEqual([]);
    const missing = await run(['--out']);
    expect(missing.code).toBe(2);
    expect(missing.stderr[0]).toBe('--out needs a file path.');
  });

  it('writes the page and the CSV after the results when --page names a file, the same bytes every time', async () => {
    const out = path.join(tmp, 'page-run', 'results.json');
    const page = path.join(tmp, 'page-run', 'site', 'study.html');
    const csv = path.join(tmp, 'page-run', 'site', 'study', 'runs.csv');
    const { code, stdout, stderr } = await run(['--out', out, '--page', page]);
    expect(code).toBe(0);
    expect(stderr).toHaveLength(3);
    expect(stderr[0]).toMatch(/^Wrote .*results\.json$/);
    expect(stderr[1]).toMatch(/^Wrote .*study\.html$/);
    expect(stderr[2]).toMatch(/^Wrote .*study[\\/]runs\.csv$/);

    const expected = runStudy(studyInput({ grid: TWO_RUN_GRID }));
    expect(fs.readFileSync(out, 'utf8')).toBe(serializeStudy(expected));
    expect(fs.readFileSync(page, 'utf8')).toBe(renderStudyPage(expected));
    expect(fs.readFileSync(csv, 'utf8')).toBe(runsCsv(expected));
    expect(stdout.slice(0, -2)).toEqual(summaryTable(expected));
    // No temp file left behind, and the CSV is where the page's link points.
    expect(fs.readdirSync(path.dirname(page)).sort()).toEqual(['study', 'study.html']);
    expect(fs.readdirSync(path.dirname(csv))).toEqual(['runs.csv']);
    expect(runsCsvFileFor(page)).toBe(csv);
    expect(path.resolve(path.dirname(page), RUNS_CSV_HREF)).toBe(csv);
    expect(fs.readFileSync(page, 'utf8')).toContain(`<a class="download" href="${RUNS_CSV_HREF}" download>Download every run (CSV)</a>`);

    const again = path.join(tmp, 'page-run', 'again', 'study.html');
    expect((await run(['--out', out, '--page', again])).code).toBe(0);
    expect(fs.readFileSync(again).equals(fs.readFileSync(page))).toBe(true);
    expect(fs.readFileSync(runsCsvFileFor(again)).equals(fs.readFileSync(csv))).toBe(true);
  });

  it('a plain run writes the page to client/public/study.html and the CSV to client/public/study/runs.csv; --out alone leaves both alone', async () => {
    expect(path.relative(repoRoot, DEFAULT_STUDY_PAGE)).toBe(path.join('client', 'public', 'study.html'));
    expect(path.relative(repoRoot, DEFAULT_STUDY_CSV)).toBe(path.join('client', 'public', 'study', 'runs.csv'));
    // client/public is Vite's public folder (root: client), so the build copies both to client/dist.
    expect(fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8')).toMatch(/root: 'client'/);

    const before = [fs.readFileSync(DEFAULT_STUDY_PAGE), fs.readFileSync(DEFAULT_STUDY_CSV)];
    const { code, stderr } = await run(['--out', path.join(tmp, 'only-results.json')]); // a two-run grid
    expect(code).toBe(0);
    expect(stderr).toHaveLength(1);
    expect(fs.readFileSync(DEFAULT_STUDY_PAGE).equals(before[0]!)).toBe(true);
    expect(fs.readFileSync(DEFAULT_STUDY_CSV).equals(before[1]!)).toBe(true);
  });

  it('rejects --page without a file', async () => {
    const missing = await run(['--page']);
    expect(missing.code).toBe(2);
    expect(missing.stderr[0]).toBe('--page needs a file path.');
  });

  it('prints help without running', async () => {
    const { code, stdout } = await run(['--help']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toMatch(/Usage: npm run study/);
    expect(stdout.join('\n')).toMatch(/--workers <n>/);
  });
});

describe('npm run study -- --workers', () => {
  it('gives the same results file, page and CSV on 2 worker threads as on 1', async () => {
    const files = (name: string) => {
      const page = path.join(tmp, name, 'study.html');
      return { out: path.join(tmp, name, 'results.json'), page, csv: runsCsvFileFor(page) };
    };
    const one = files('workers-1');
    const two = files('workers-2');
    const single = await run(['--out', one.out, '--page', one.page, '--workers', '1']);
    const threaded = await run(['--out', two.out, '--page', two.page, '--workers', '2']);
    expect([single.code, threaded.code]).toEqual([0, 0]);
    for (const key of ['out', 'page', 'csv'] as const) {
      expect(fs.readFileSync(two[key]).equals(fs.readFileSync(one[key])), key).toBe(true);
    }
    // The summary is the same; only the last line (time and workers) may differ.
    expect(threaded.stdout.slice(0, -1)).toEqual(single.stdout.slice(0, -1));
    expect(single.stdout.at(-1)).toMatch(/ on 1 worker$/);
    expect(threaded.stdout.at(-1)).toMatch(/ on 2 workers$/);
  }, STUDY_TIMEOUT_MS);

  it('uses one worker per CPU core less one when no number is given, and never more than there are runs', async () => {
    const stdout: string[] = [];
    const code = await runStudyCli({
      grid: TWO_RUN_GRID, argv: ['--out', path.join(tmp, 'default-workers.json')],
      stdout: line => stdout.push(line), stderr: () => {},
    });
    expect(code).toBe(0);
    const used = Number(WALL_TIME.exec(stdout.at(-1)!)![1]);
    expect(used).toBe(Math.min(defaultWorkerCount(), 2)); // the grid has two runs
    expect(defaultWorkerCount()).toBe(Math.max(1, os.availableParallelism() - 1));
  }, STUDY_TIMEOUT_MS);

  it('rejects a worker count that is not a whole number of 1 or more', async () => {
    for (const argv of [['--workers'], ['--workers', '0'], ['--workers', '-2'], ['--workers', '1.5'], ['--workers', 'many'], ['--workers', '']]) {
      const { code, stdout, stderr } = await run(argv);
      expect(code, argv.join(' ')).toBe(2);
      expect(stderr[0], argv.join(' ')).toBe('--workers needs a whole number of 1 or more.');
      expect(stdout).toEqual([]);
    }
  });
});

describe('progress', () => {
  /** 102 small runs: one more than a hundred, so exactly one progress line. */
  const grid: GridSpec = { seeds: Array.from({ length: 34 }, (_, index) => index + 1), employeeCounts: [30], packageCounts: [12], detourLimitsMin: [8, 12, 16] };

  it('is one line every 100 runs, with the runs done, the time so far and the time left', async () => {
    expect(PROGRESS_EVERY_RUNS).toBe(100);
    // A clock that reads 0 when the study starts and 4 min 10 s at every later look.
    let looks = 0;
    const now = () => (looks++ === 0 ? 0 : 250_000);
    const { code, stdout, stderr } = await run(['--out', path.join(tmp, 'progress.json')], { grid, now });
    expect(code).toBe(0);
    // 100 runs took 250 s, so the 2 runs left take about 5 s.
    expect(stderr).toEqual(['100/102 runs, 4m10s, ~5s left', expect.stringMatching(/^Wrote .*progress\.json$/)]);
    expect(stdout[0]).toBe('Relay vs a next-day courier: 102 simulations');
    expect(stdout.at(-1)).toBe('Wall time: 4m10s on 1 worker');
  }, STUDY_TIMEOUT_MS);

  it('is printed on worker threads too, and by --check', async () => {
    const page = path.join(tmp, 'progress-page', 'study.html');
    const written = await run(['--out', path.join(tmp, 'progress-page', 'results.json'), '--page', page, '--workers', '2'], { grid });
    expect(written.code).toBe(0);
    expect(written.stderr.filter(line => /runs, /.test(line))).toEqual([expect.stringMatching(/^100\/102 runs, \d+s, ~\d+s left$/)]);
    expect(written.stdout.at(-1)).toMatch(/ on 2 workers$/);

    const checked = await run(['--check', '--page', page, '--workers', '2'], { grid });
    expect(checked.code).toBe(0);
    expect(checked.stderr).toEqual([expect.stringMatching(/^100\/102 runs, \d+s, ~\d+s left$/)]);
    expect(checked.stdout).toHaveLength(1);
  }, STUDY_TIMEOUT_MS);

  it('writes the line of the issue: "1200/3024 runs, 4m10s, ~6m left"', () => {
    expect(progressLine(1200, 3024, 250_000)).toBe('1200/3024 runs, 4m10s, ~6m left');
    expect(progressLine(100, 3024, 900)).toBe('100/3024 runs, 0s, ~26s left');
    expect(progressLine(3000, 3024, 125_000)).toBe('3000/3024 runs, 2m05s, ~1s left');
    expect(progressLine(0, 10, 0)).toBe('0/10 runs, 0s, ~0s left');
    expect(progressLine(10, 10, 61_000)).toBe('10/10 runs, 1m01s, ~0s left');
  });

  it('writes times as whole seconds, and minutes from one minute up', () => {
    expect([0, 999, 1000, 59_999, 60_000, 250_400, 3_600_000].map(clockTime)).toEqual(['0s', '0s', '1s', '59s', '1m00s', '4m10s', '60m00s']);
    expect([0, 499, 500, 59_400, 59_600, 89_000, 91_000, 380_000].map(roughTime)).toEqual(['~0s', '~0s', '~1s', '~59s', '~1m', '~1m', '~2m', '~6m']);
    expect(wallTimeLine(125_000, 13)).toBe('Wall time: 2m05s on 13 workers');
    expect(wallTimeLine(900, 1)).toBe('Wall time: 0s on 1 worker');
  });
});

describe('npm run study -- --check', () => {
  afterEach(() => vi.restoreAllMocks());

  const FIX = 'Run `npm run study` and commit the page and the CSV.';

  /** A page of the two-run grid and its CSV in their own temp folder, as `npm run study -- --page` writes them. */
  async function tempPage(name: string): Promise<{ file: string; html: string; csvFile: string; csv: string }> {
    const file = path.join(tmp, name, 'study.html');
    expect((await run(['--out', path.join(tmp, name, 'results.json'), '--page', file])).code).toBe(0);
    fs.rmSync(path.join(tmp, name, 'results.json'));
    const csvFile = runsCsvFileFor(file);
    return { file, html: fs.readFileSync(file, 'utf8'), csvFile, csv: fs.readFileSync(csvFile, 'utf8') };
  }

  /** `--check` on `file`, with every way cli.ts writes watched: the check must not call any of them. */
  async function check(file: string) {
    const writes = [vi.spyOn(fs, 'writeFileSync'), vi.spyOn(fs, 'renameSync'), vi.spyOn(fs, 'mkdirSync'), vi.spyOn(fs, 'rmSync')];
    const result = await run(['--check', '--page', file]);
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    return result;
  }

  it('exits 0 on a page that is what the run would write, and writes nothing', async () => {
    const { file, html } = await tempPage('check-same');
    const { code, stdout, stderr } = await check(file);
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toMatch(/study\.html and .*study[\\/]runs\.csv match a fresh study run \(2 runs, \d+ packages compared\)\.$/);
    expect(fs.readFileSync(file, 'utf8')).toBe(html);
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(['study', 'study.html']); // no results file, no temp file
    expect(fs.readdirSync(path.join(path.dirname(file), 'study'))).toEqual(['runs.csv']);
  });

  it('exits 1 with one line that names the edited headline number and says how to fix it', async () => {
    const { file, html } = await tempPage('check-number');
    const cost = headlineTiles(html)[0]!;
    expect(cost.label).toBe('Cost to the sender');
    // The label is part of what is replaced: two tiles can show the same figure.
    const edited = html.replace(`<p class="tile-label">${cost.label}</p><p class="tile-value">${cost.value}</p>`, `<p class="tile-label">${cost.label}</p><p class="tile-value">99.9% less</p>`);
    expect(edited).not.toBe(html);
    fs.writeFileSync(file, edited);

    const { code, stdout, stderr } = await check(file);
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toMatch(/study\.html is out of date: /);
    expect(stderr[0]).toContain(`"Cost to the sender" is 99.9% less on the page but ${cost.value} in a fresh run. ${FIX}`);
    expect(stderr[0]).not.toContain('\n');
    expect(fs.readFileSync(file, 'utf8')).toBe(edited); // the check never repairs the page
  });

  it('names a headline number whose small print changed, and the first one when several did', async () => {
    const { file, html } = await tempPage('check-detail');
    const [, miles, co2] = headlineTiles(html);
    const edited = html
      .replace(`<p class="tile-detail">${miles!.detail}</p>`, '<p class="tile-detail">Relay 9.9 mi vs courier 1.0 mi per package</p>')
      .replace(`<p class="tile-label">${co2!.label}</p><p class="tile-value">${co2!.value}</p>`, `<p class="tile-label">${co2!.label}</p><p class="tile-value">1.0% less</p>`);
    expect(headlineTiles(edited).map(tile => tile.value !== '1.0% less')).toEqual([true, true, false, true, true]);
    fs.writeFileSync(file, edited);
    const { code, stderr } = await check(file);
    expect(code).toBe(1);
    expect(stderr).toEqual([
      `${path.relative(process.cwd(), file).startsWith('..') ? file : path.relative(process.cwd(), file)} is out of date: `
      + `"Added vehicle miles" reads "Relay 9.9 mi vs courier 1.0 mi per package" on the page but "${miles!.detail}" in a fresh run. ${FIX}`,
    ]);
  });

  it('says "page differs" when the headline is the same and something else changed', async () => {
    const { file, html } = await tempPage('check-other');
    const lines = html.split('\n');
    const footer = lines.findIndex(line => line.startsWith('<footer>'));
    expect(footer).toBeGreaterThan(0);
    lines[footer] = lines[footer]!.replace('Generated by', 'Made by');
    fs.writeFileSync(file, lines.join('\n'));
    const { code, stderr } = await check(file);
    expect(code).toBe(1);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain(`is out of date: page differs from a fresh run, first at line ${footer + 1} (the headline numbers are the same). ${FIX}`);

    // One byte is enough: a missing final newline.
    fs.writeFileSync(file, html.slice(0, -1));
    const trimmed = await check(file);
    expect(trimmed.code).toBe(1);
    expect(trimmed.stderr[0]).toMatch(/page differs/);
  });

  it('says a headline number is not on the page when its tile is gone', async () => {
    const { file, html } = await tempPage('check-missing-tile');
    fs.writeFileSync(file, html.replace(/<div class="tile"><p class="tile-label">Match rate<[^\n]*\n/, ''));
    const { code, stderr } = await check(file);
    expect(code).toBe(1);
    expect(stderr[0]).toContain(`the headline number "Match rate" is not on the page. ${FIX}`);
  });

  it('exits 1 with one line when the CSV is not what the run would write, or is gone', async () => {
    const { file, html, csvFile, csv } = await tempPage('check-csv');
    const lines = csv.split('\n');
    expect(lines[0]).toBe(RUNS_CSV_COLUMNS.join(','));
    lines[2] = lines[2]!.replace(',simulated,', ',skipped,');
    fs.writeFileSync(csvFile, lines.join('\n'));
    const edited = await check(file);
    expect(edited.code).toBe(1);
    expect(edited.stdout).toEqual([]);
    expect(edited.stderr).toHaveLength(1);
    expect(edited.stderr[0]).toMatch(/study[\\/]runs\.csv is out of date: it differs from a fresh run, first at line 3\. /);
    expect(edited.stderr[0]).toContain(FIX);
    expect(fs.readFileSync(csvFile, 'utf8')).toBe(lines.join('\n')); // the check never repairs the file
    expect(fs.readFileSync(file, 'utf8')).toBe(html);

    fs.rmSync(csvFile);
    const gone = await check(file);
    expect(gone.code).toBe(1);
    expect(gone.stderr).toHaveLength(1);
    expect(gone.stderr[0]).toMatch(/study[\\/]runs\.csv does not exist\. /);
    expect(fs.existsSync(csvFile)).toBe(false);
  });

  it('exits 1 when the page does not exist, and does not create it', async () => {
    const file = path.join(tmp, 'check-absent', 'study.html');
    const { code, stdout, stderr } = await check(file);
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain(`study.html does not exist. ${FIX}`);
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });

  it('checks client/public/study.html when no --page is given', async () => {
    // The two-run grid can never give the committed 3,024-run page, so this shows which file was read.
    const before = fs.readFileSync(DEFAULT_STUDY_PAGE);
    const { code, stderr } = await run(['--check']);
    expect(code).toBe(1);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toMatch(/^client[\\/]public[\\/]study\.html is out of date: /);
    expect(fs.readFileSync(DEFAULT_STUDY_PAGE).equals(before)).toBe(true);
  });

  it('cannot be combined with --out, and still needs the travel cache', async () => {
    const out = path.join(tmp, 'check-out.json');
    const both = await run(['--check', '--out', out]);
    expect(both.code).toBe(2);
    expect(both.stderr[0]).toBe('--check writes nothing, so it cannot be used with --out.');
    expect(fs.existsSync(out)).toBe(false);

    const empty = path.join(tmp, 'check-no-cache');
    fs.mkdirSync(empty);
    const noCache = await run(['--check'], { fixturesDir: empty });
    expect(noCache.code).toBe(1);
    expect(noCache.stderr.join('\n')).toMatch(/No travel cache/);
  });

  it('is in the help text, and is a flag of the existing script', async () => {
    expect((await run(['--help'])).stdout.join('\n')).toMatch(/npm run study -- --check/);
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

describe('csvDifference', () => {
  const csv = runsCsv(runStudy(studyInput({ grid: TWO_RUN_GRID })));

  it('is null only for the same bytes, and names the first line that differs', () => {
    expect(csvDifference(csv, csv)).toBeNull();
    expect(csvDifference(csv.slice(0, -1), csv)).toBe('it differs from a fresh run, first at line 4');
    expect(csvDifference(csv.replace(/\n/g, '\r\n'), csv)).toBe('it differs from a fresh run, first at line 1');
    expect(csvDifference(csv.replace('s2-e60', 's3-e60'), csv)).toBe('it differs from a fresh run, first at line 3');
  });
});

describe('the summary table', () => {
  const results = runStudy(studyInput({ grid: TWO_RUN_GRID }));
  const lines = summaryTable(results);

  it('has the runs, the packages, the match rate, Relay against the courier and the match rate by employee count', () => {
    expect(lines[0]).toBe('Relay vs a next-day courier: 2 simulations');
    expect(lines[2]).toBe('Runs        2 simulated, 0 skipped (uncached travel pair)');
    expect(lines[3]).toMatch(/^Packages    48 requested, \d+ matched and delivered by Relay$/);
    expect(lines[4]).toMatch(/^Match rate  \d+\.\d%$/);
    const table = lines.slice(6, 15);
    expect(table[0]).toMatch(/^Per matched package +Average +Median +10th to 90th percentile across runs$/);
    const figure = { money: '\\$\\d+\\.\\d\\d', miles: '\\d+\\.\\d\\d mi', kg: '\\d+\\.\\d\\d kg', rate: '\\d+\\.\\d%' };
    const row = (name: string, side: string, f: string, end = '') => new RegExp(`^${name} +${side} +${f} +${f} +${f} to ${f}${end}$`);
    expect(table[1]).toMatch(row('Cost to the sender', 'Relay', figure.money));
    expect(table[2]).toMatch(row('', 'Courier', figure.money));
    expect(table[3]).toMatch(row('Added vehicle miles', 'Relay', figure.miles));
    expect(table[4]).toMatch(row('', 'Courier', figure.miles));
    expect(table[5]).toMatch(row('CO2', 'Relay', figure.kg));
    expect(table[6]).toMatch(row('', 'Courier', figure.kg));
    expect(table[7]).toMatch(row('On-time rate', 'Relay', figure.rate));
    expect(table[8]).toMatch(row('', 'Courier', figure.rate, ' \\(assumed\\)'));
    expect(table[1]).toMatch(/Relay +\$10\.00 +\$10\.00 +\$10\.00 to \$10\.00$/);
    // The columns line up: every figure of a column starts where its heading starts.
    for (const heading of ['Average', 'Median', '10th to 90th']) {
      const at = table[0]!.indexOf(heading);
      for (const line of table.slice(1)) expect(line[at - 1] + line[at]!, line).toMatch(/^ \S$/);
    }
    expect(lines.slice(15)).toEqual(['', 'Match rate by employee count', expect.stringMatching(/^60 employees  \d+\.\d%  \d+ of 48 packages in 2 runs$/)]);
    for (const line of lines) expect(line).toBe(line.trimEnd());
  });

  it('shows the same averages as the headline, and a median between the 10th and the 90th percentile', () => {
    const h = results.headline;
    const text = lines.join('\n');
    expect(text).toContain(`$${(h.relayCostPerPackageCents! / 100).toFixed(2)}`);
    expect(text).toContain(`$${(h.courierCostPerPackageCents! / 100).toFixed(2)}`);
    expect(text).toContain(`${h.relayAddedMilesPerPackage!.toFixed(2)} mi`);
    expect(text).toContain(`${h.courierMilesPerPackage!.toFixed(2)} kg`.replace(' kg', ' mi'));
    expect(text).toContain(`${h.relayCo2KgPerPackage!.toFixed(2)} kg`);
    for (const line of lines.slice(7, 15)) {
      const [median, low, high] = [...line.matchAll(/(\d+\.\d+)/g)].slice(1).map(match => Number(match[1]));
      expect(low!, line).toBeLessThanOrEqual(median!);
      expect(median!, line).toBeLessThanOrEqual(high!);
    }
  });

  it('has no NaN when every run was skipped or nothing was matched, and says which runs are left out', () => {
    const skipped = summaryTable(allSkipped(results));
    expect(skipped.join('\n')).not.toMatch(/NaN|null|undefined|Infinity/);
    expect(skipped[0]).toBe('Relay vs a next-day courier: 0 simulations');
    expect(skipped[2]).toBe('Runs        0 simulated, 2 skipped (uncached travel pair)');
    expect(skipped[4]).toBe('Match rate  n/a (no package requested)');
    expect(skipped[7]).toMatch(/^Cost to the sender +Relay +n\/a +n\/a +n\/a to n\/a$/);

    const none = summaryTable(noneMatched(results));
    expect(none.join('\n')).not.toMatch(/NaN|null|undefined|Infinity/);
    expect(none[4]).toBe('Match rate  0.0%');
    expect(none).toContain('2 runs matched no package and are left out of the median and the percentiles.');
    expect(lines.join('\n')).not.toMatch(/left out/);
  });
});
