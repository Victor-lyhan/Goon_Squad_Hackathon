// `npm run study`: reads the committed NYC cache and fixtures, runs the study, writes the results file and the
// study page (client/public/study.html, scripts/study/page.ts) and prints the five summary lines. Only the cache is read: no key, no network, no Google provider.
// `npm run study -- --check` writes nothing: it tells whether the committed page is still what a fresh run gives.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NYC_FIXTURES_DIR, readNycFixtures } from '../../server/api/v2/bootRun';
import { readTravelFiles } from '../../server/geo/cache';
import { createCachedProvider } from '../../server/geo/providers';
import type { GridSpec } from './grid';
import { headlineTiles, renderStudyPage } from './page';
import { runStudy } from './runner';
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

const USAGE = `Usage: npm run study [-- --out <file>] [--page <file>]
       npm run study -- --check [--page <file>]

Runs the Relay vs next-day courier study on the committed NYC travel cache (fixtures/nyc) and writes
data/study/results.json and the page client/public/study.html. Needs no key and no network.

  --out <file>   write the results somewhere else; the committed page is then left as it is
  --page <file>  write the page somewhere else (with --out: also write the page, to this file)
  --check        write nothing: run the study in memory and exit 0 when client/public/study.html (or the
                 --page file) is byte-identical to the page this run would write, 1 when it is not
  --help         show this text`;

export type StudyCliOptions = {
  argv?: string[];
  /** Folder of the travel cache and the NYC fixture files. Default: fixtures/nyc. */
  fixturesDir?: string;
  grid?: GridSpec;
  assumptions?: readonly Assumption[];
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
};

/** The exact text of `data/study/results.json`: 2-space JSON and a final newline. */
export function serializeStudy(results: StudyResults): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}

const na = 'n/a (no package matched)';

/** The five lines `npm run study` prints: runs, packages, match rate, cost saved and CO2 saved per package. */
export function summaryLines(results: StudyResults): string[] {
  const { headline: h, totals } = results;
  const kg = (value: number) => `${value.toFixed(2)} kg`;
  return [
    `Runs: ${totals.runs} simulated, ${totals.skippedRuns} skipped (uncached travel pair)`,
    `Packages: ${totals.packages} requested, ${totals.matched} matched and delivered by Relay`,
    `Match rate: ${h.matchRate === null ? 'n/a (no package requested)' : percent(h.matchRate)}`,
    `Cost saved per package: ${h.costSavedPerPackageCents === null || h.relayCostPerPackageCents === null || h.courierCostPerPackageCents === null
      ? na
      : `${dollars(h.costSavedPerPackageCents)} (Relay ${dollars(h.relayCostPerPackageCents)} vs courier ${dollars(h.courierCostPerPackageCents)})`}`,
    `CO2 saved per package: ${h.co2SavedKgPerPackage === null || h.relayCo2KgPerPackage === null || h.courierCo2KgPerPackage === null
      ? na
      : `${kg(h.co2SavedKgPerPackage)} (Relay ${kg(h.relayCo2KgPerPackage)} vs courier ${kg(h.courierCo2KgPerPackage)})`}`,
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

/**
 * Runs the command line. Returns the exit code: 0 written (with --check: the page is up to date),
 * 1 no travel cache, a write error or (with --check) a page that is missing or out of date, 2 bad arguments.
 */
export function runStudyCli(options: StudyCliOptions = {}): number {
  const argv = options.argv ?? [];
  const out = options.stdout ?? ((line: string) => console.log(line));
  const err = options.stderr ?? ((line: string) => console.error(line));

  let outFile: string | null = null;
  let pageFile: string | null = null;
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
    if ((arg === '--out' || arg === '--page') && value !== undefined && value !== '') {
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
    const results = runStudy({
      travel: createCachedProvider(files),
      places: files.matrix.places,
      fixtures: readNycFixtures(fixturesDir),
      grid: options.grid,
      assumptions: options.assumptions,
    });
    if (check) {
      const target = pageFile ?? DEFAULT_STUDY_PAGE;
      const fix = 'Run `npm run study` and commit the page.';
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
      out(`${shown(target)} matches a fresh study run (${results.totals.runs} runs, ${results.totals.matched} packages compared).`);
      return 0;
    }
    // The page goes to its committed place only on a plain `npm run study`. A run that sends the results
    // elsewhere (a trial, a test with a small grid) must not replace the committed page unless it names one.
    const pageTarget = pageFile ?? (outFile === null ? DEFAULT_STUDY_PAGE : null);
    const written: string[] = [];
    const write = (file: string, text: string) => {
      writeFileWhole(file, text);
      written.push(file);
    };
    const page = pageTarget === null ? null : renderStudyPage(results); // before any write: both files or neither
    write(outFile ?? DEFAULT_STUDY_OUT, serializeStudy(results));
    if (pageTarget !== null && page !== null) write(pageTarget, page);
    for (const line of summaryLines(results)) out(line);
    for (const file of written) err(`Wrote ${shown(file)}`);
    return 0;
  } catch (error) {
    err(`Study failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
