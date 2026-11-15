// `npm run study`: reads the committed NYC cache and fixtures, runs the study on worker threads
// (scripts/study/parallel.ts), writes the results file, the study page (client/public/study.html,
// scripts/study/page.ts) and every run as CSV next to it (client/public/study/runs.csv, scripts/study/csv.ts),
// prints progress every 100 runs and then a summary table. Only the cache is read: no key, no network, no
// Google provider.
// `npm run study -- --check` writes nothing: it tells whether the committed page and CSV are still what a
// fresh run gives.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NYC_FIXTURES_DIR, readNycFixtures } from '../../server/api/v2/bootRun';
import { readTravelFiles } from '../../server/geo/cache';
import { runsCsv } from './csv';
import type { GridSpec } from './grid';
import { RUNS_CSV_HREF, headlineTiles, renderStudyPage } from './page';
import { defaultWorkerCount, runStudyParallel } from './parallel';
import { summarize, type Spread } from './summary';
import type { Assumption, StudyResults } from './types';
import { dollars, percent } from './units';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** `data/study/results.json` at the repo root. The root `data/` folder is gitignored. */
export const DEFAULT_STUDY_OUT = path.join(repoRoot, 'data', 'study', 'results.json');

/**
 * `client/public/study.html`: the committed, self-contained page of the results. Vite copies its public
 * folder into the build, so the app serves it at /study.html.
 */
export const DEFAULT_STUDY_PAGE = path.join(repoRoot, 'client', 'public', 'study.html');

/**
 * Where the CSV of every run goes for a page at `pageFile`: `study/runs.csv` next to it, which is the
 * address the page links to (RUNS_CSV_HREF). For the committed page: client/public/study/runs.csv.
 */
export function runsCsvFileFor(pageFile: string): string {
  return path.join(path.dirname(pageFile), ...RUNS_CSV_HREF.split('/'));
}

/** `client/public/study/runs.csv`: every run of the committed page, committed with it. */
export const DEFAULT_STUDY_CSV = runsCsvFileFor(DEFAULT_STUDY_PAGE);

/** Progress is printed each time this many more runs are done. */
export const PROGRESS_EVERY_RUNS = 100;

const USAGE = `Usage: npm run study [-- --out <file>] [--page <file>] [--workers <n>]
       npm run study -- --check [--page <file>] [--workers <n>]

Runs the Relay vs next-day courier study on the committed NYC travel cache (fixtures/nyc) and writes
data/study/results.json, the page client/public/study.html and every run as client/public/study/runs.csv.
Prints progress every ${PROGRESS_EVERY_RUNS} runs, then a summary table. Needs no key and no network.

  --out <file>   write the results somewhere else; the committed page and CSV are then left as they are
  --page <file>  write the page somewhere else, and the CSV to study/runs.csv next to it
                 (with --out: also write the page and the CSV)
  --workers <n>  simulate on n worker threads (default: one per CPU core, less one). The results are the
                 same for every n; 1 runs the study on the main thread
  --check        write nothing: run the study in memory and exit 0 when client/public/study.html (or the
                 --page file) and its study/runs.csv are byte-identical to what this run would write,
                 1 when they are not
  --help         show this text`;

export type StudyCliOptions = {
  argv?: string[];
  /** Folder of the travel cache and the NYC fixture files. Default: fixtures/nyc. */
  fixturesDir?: string;
  grid?: GridSpec;
  assumptions?: readonly Assumption[];
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Milliseconds on a clock that only moves forward, for the progress lines and the wall time. Default: performance.now. */
  now?: () => number;
};

/** The exact text of `data/study/results.json`: 2-space JSON and a final newline. */
export function serializeStudy(results: StudyResults): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}

const NA = 'n/a';

/** 2268 -> "2,268". Not toLocaleString: the text must not depend on the machine's locale. */
const count = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 250_400 ms -> "4m10s"; under a minute "42s". Whole seconds, rounded down. */
export function clockTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

/** A time that is only an estimate: whole minutes from one minute up ("~6m"), else whole seconds ("~40s"). */
export function roughTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `~${seconds}s` : `~${Math.round(seconds / 60)}m`;
}

/**
 * One progress line: "1200/3024 runs, 4m10s, ~6m left". The time left assumes the runs still to do take as
 * long each as the runs done so far.
 */
export function progressLine(done: number, planned: number, elapsedMs: number): string {
  const leftMs = done === 0 ? 0 : (elapsedMs / done) * (planned - done);
  return `${done}/${planned} runs, ${clockTime(elapsedMs)}, ${roughTime(leftMs)} left`;
}

/** The last line of the summary: how long the study took on the clock, and on how many workers. */
export function wallTimeLine(elapsedMs: number, workers: number): string {
  return `Wall time: ${clockTime(elapsedMs)} on ${workers} ${workers === 1 ? 'worker' : 'workers'}`;
}

/** Lines of cells as text columns: each column as wide as its widest cell, two spaces apart, no trailing space. */
function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, index) => { widths[index] = Math.max(widths[index] ?? 0, cell.length); });
  return rows.map(row => row.map((cell, index) => cell.padEnd(widths[index]!)).join('  ').trimEnd());
}

/**
 * The summary `npm run study` prints after the last run: runs, packages and match rate; Relay against the
 * courier per matched package (average over all packages, then median and 10th to 90th percentile across
 * runs) for cost, added miles, CO2 and the on-time rate; and the match rate by employee count.
 * Deterministic: the wall time is a separate line (`wallTimeLine`).
 */
export function summaryTable(results: StudyResults): string[] {
  const { headline: h, totals } = results;
  const summary = summarize(results);
  const text = (format: (value: number) => string) => (value: number | null): string => (value === null ? NA : format(value));
  const rows = (name: string, sides: { relay: Spread; courier: Spread }, format: (value: number) => string, courierNote = ''): string[][] => {
    const show = text(format);
    const cells = (spread: Spread): string[] => [show(spread.average), show(spread.median), `${show(spread.low)} to ${show(spread.high)}`];
    const courier = cells(sides.courier);
    if (courierNote !== '') courier[courier.length - 1] += ` ${courierNote}`;
    return [[name, 'Relay', ...cells(sides.relay)], ['', 'Courier', ...courier]];
  };
  const leftOut = summary.runsWithoutMatch;
  return [
    `Relay vs a next-day courier: ${count(totals.runs)} ${totals.runs === 1 ? 'simulation' : 'simulations'}`,
    '',
    ...columns([
      ['Runs', `${count(totals.runs)} simulated, ${count(totals.skippedRuns)} skipped (uncached travel pair)`],
      ['Packages', `${count(totals.packages)} requested, ${count(totals.matched)} matched and delivered by Relay`],
      ['Match rate', h.matchRate === null ? `${NA} (no package requested)` : percent(h.matchRate)],
    ]),
    '',
    ...columns([
      ['Per matched package', '', 'Average', 'Median', '10th to 90th percentile across runs'],
      ...rows('Cost to the sender', summary.costCents, dollars),
      ...rows('Added vehicle miles', summary.miles, value => `${value.toFixed(2)} mi`),
      ...rows('CO2', summary.co2Kg, value => `${value.toFixed(2)} kg`),
      ...rows('On-time rate', summary.onTimeRate, percent, '(assumed)'),
    ]),
    ...(leftOut === 0 ? [] : [`${count(leftOut)} ${leftOut === 1 ? 'run' : 'runs'} matched no package and ${leftOut === 1 ? 'is' : 'are'} left out of the median and the percentiles.`]),
    '',
    'Match rate by employee count',
    ...columns(summary.byEmployees.map(group => [
      `${group.value} employees`,
      text(percent)(group.headline.matchRate),
      `${count(group.headline.matched)} of ${count(group.headline.packages)} packages in ${count(group.runs)} ${group.runs === 1 ? 'run' : 'runs'}`,
    ])),
  ];
}

/** Through a temp file and a rename, so a crash never leaves half a file. Creates the folder. */
function writeFileWhole(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

/** A path as the messages show it: relative to where the command runs when it is inside that folder. */
function shown(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative !== '' && !relative.startsWith('..') ? relative : file;
}

/**
 * What is wrong with the page `onDisk` when a fresh run renders `fresh`, as the middle of one sentence, or
 * null when the two are byte-identical. Names the first headline number (a tile at the top of the page) that
 * differs; when the headline is the same and something else changed, says "page differs" and where.
 */
export function pageDifference(onDisk: string, fresh: string): string | null {
  if (Buffer.from(onDisk, 'utf8').equals(Buffer.from(fresh, 'utf8'))) return null;
  const pageTiles = headlineTiles(onDisk);
  for (const [index, want] of headlineTiles(fresh).entries()) {
    const have = pageTiles[index];
    if (have === undefined || have.label !== want.label) return `the headline number "${want.label}" is not on the page`;
    if (have.value !== want.value) return `"${want.label}" is ${have.value} on the page but ${want.value} in a fresh run`;
    if (have.detail !== want.detail) return `"${want.label}" reads "${have.detail}" on the page but "${want.detail}" in a fresh run`;
  }
  const pageLines = onDisk.split('\n');
  const freshLines = fresh.split('\n');
  let line = 0;
  while (line < pageLines.length && line < freshLines.length && pageLines[line] === freshLines[line]) line += 1;
  return `page differs from a fresh run, first at line ${line + 1} (the headline numbers are the same)`;
}

/** What is wrong with the CSV `onDisk` when a fresh run writes `fresh`, as the middle of one sentence; null when they are the same bytes. */
export function csvDifference(onDisk: string, fresh: string): string | null {
  if (Buffer.from(onDisk, 'utf8').equals(Buffer.from(fresh, 'utf8'))) return null;
  const diskLines = onDisk.split('\n');
  const freshLines = fresh.split('\n');
  let line = 0;
  while (line < diskLines.length && line < freshLines.length && diskLines[line] === freshLines[line]) line += 1;
  return `it differs from a fresh run, first at line ${line + 1}`;
}

/**
 * Runs the command line. Resolves to the exit code: 0 written (with --check: the page and the CSV are up to
 * date), 1 no travel cache, a failed run, a write error or (with --check) a page or CSV that is missing or
 * out of date, 2 bad arguments.
 */
export async function runStudyCli(options: StudyCliOptions = {}): Promise<number> {
  const argv = options.argv ?? [];
  const out = options.stdout ?? ((line: string) => console.log(line));
  const err = options.stderr ?? ((line: string) => console.error(line));
  const now = options.now ?? (() => performance.now());

  let outFile: string | null = null;
  let pageFile: string | null = null;
  let workers: number | undefined;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      out(USAGE);
      return 0;
    }
    if (arg === '--check') {
      check = true;
      continue;
    }
    const value = argv[index + 1];
    if (arg === '--workers') {
      if (value === undefined || !/^[1-9]\d*$/.test(value)) {
        err('--workers needs a whole number of 1 or more.');
        err(USAGE);
        return 2;
      }
      workers = Number(value);
      index += 1;
    } else if ((arg === '--out' || arg === '--page') && value !== undefined && value !== '') {
      if (arg === '--out') outFile = path.resolve(value);
      else pageFile = path.resolve(value);
      index += 1;
    } else {
      err(arg === '--out' || arg === '--page' ? `${arg} needs a file path.` : `Unknown argument: ${arg}`);
      err(USAGE);
      return 2;
    }
  }

  if (check && outFile !== null) {
    err('--check writes nothing, so it cannot be used with --out.');
    err(USAGE);
    return 2;
  }

  const fixturesDir = options.fixturesDir ?? NYC_FIXTURES_DIR;
  try {
    const files = readTravelFiles(fixturesDir);
    if (!files) {
      err(`No travel cache in ${fixturesDir} (matrix.json and polylines.json). The study only reads cached travel data.`);
      return 1;
    }
    const startedAt = now();
    const study = await runStudyParallel(
      { files, fixtures: readNycFixtures(fixturesDir), grid: options.grid, assumptions: options.assumptions },
      {
        workers: workers ?? defaultWorkerCount(),
        // Progress goes to stderr: stdout carries only the summary (or the one line of --check).
        onRun: (done, planned) => {
          if (done % PROGRESS_EVERY_RUNS === 0) err(progressLine(done, planned, now() - startedAt));
        },
      },
    );
    const elapsedMs = now() - startedAt;
    const { results } = study;
    if (check) {
      const target = pageFile ?? DEFAULT_STUDY_PAGE;
      const csvTarget = runsCsvFileFor(target);
      const fix = 'Run `npm run study` and commit the page and the CSV.';
      if (!fs.existsSync(target)) {
        err(`${shown(target)} does not exist. ${fix}`);
        return 1;
      }
      // Compared as text decoded from the file's bytes: a byte that is not valid UTF-8 never equals the fresh page.
      const difference = pageDifference(fs.readFileSync(target, 'utf8'), renderStudyPage(results));
      if (difference !== null) {
        err(`${shown(target)} is out of date: ${difference}. ${fix}`);
        return 1;
      }
      if (!fs.existsSync(csvTarget)) {
        err(`${shown(csvTarget)} does not exist. ${fix}`);
        return 1;
      }
      const csvProblem = csvDifference(fs.readFileSync(csvTarget, 'utf8'), runsCsv(results));
      if (csvProblem !== null) {
        err(`${shown(csvTarget)} is out of date: ${csvProblem}. ${fix}`);
        return 1;
      }
      out(`${shown(target)} and ${shown(csvTarget)} match a fresh study run (${results.totals.runs} runs, ${results.totals.matched} packages compared).`);
      return 0;
    }
    // The page and the CSV go to their committed place only on a plain `npm run study`. A run that sends the
    // results elsewhere (a trial, a test with a small grid) must not replace them unless it names a page.
    const pageTarget = pageFile ?? (outFile === null ? DEFAULT_STUDY_PAGE : null);
    const written: string[] = [];
    const write = (file: string, text: string) => {
      writeFileWhole(file, text);
      written.push(file);
    };
    // Rendered before any write: all the files or none.
    const page = pageTarget === null ? null : { file: pageTarget, html: renderStudyPage(results), csv: runsCsv(results) };
    write(outFile ?? DEFAULT_STUDY_OUT, serializeStudy(results));
    if (page !== null) {
      write(page.file, page.html);
      write(runsCsvFileFor(page.file), page.csv);
    }
    for (const line of summaryTable(results)) out(line);
    out('');
    out(wallTimeLine(elapsedMs, study.workers));
    for (const file of written) err(`Wrote ${shown(file)}`);
    return 0;
  } catch (error) {
    err(`Study failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
