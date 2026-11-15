// `npm run study`: reads the committed NYC cache and fixtures, runs the study, writes the results file and
// prints the five summary lines. Only the cache is read: no key, no network, no Google provider.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NYC_FIXTURES_DIR, readNycFixtures } from '../../server/api/v2/bootRun';
import { readTravelFiles } from '../../server/geo/cache';
import { createCachedProvider } from '../../server/geo/providers';
import type { GridSpec } from './grid';
import { runStudy } from './runner';
import type { Assumption, StudyResults } from './types';
import { dollars, percent } from './units';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** `data/study/results.json` at the repo root. The root `data/` folder is gitignored. */
export const DEFAULT_STUDY_OUT = path.join(repoRoot, 'data', 'study', 'results.json');

const USAGE = `Usage: npm run study [-- --out <file>]

Runs the Relay vs next-day courier study on the committed NYC travel cache (fixtures/nyc) and writes
data/study/results.json. Needs no key and no network.

  --out <file>   write the results somewhere else
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

/** Through a temp file and a rename, so a crash never leaves half a results file. Creates the folder. */
function writeResults(file: string, text: string): void {
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

/** Runs the command line. Returns the exit code: 0 written, 1 no travel cache or a write error, 2 bad arguments. */
export function runStudyCli(options: StudyCliOptions = {}): number {
  const argv = options.argv ?? [];
  const out = options.stdout ?? ((line: string) => console.log(line));
  const err = options.stderr ?? ((line: string) => console.error(line));

  let outFile = DEFAULT_STUDY_OUT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      out(USAGE);
      return 0;
    }
    const value = argv[index + 1];
    if (arg === '--out' && value !== undefined && value !== '') {
      outFile = path.resolve(value);
      index += 1;
    } else {
      err(arg === '--out' ? '--out needs a file path.' : `Unknown argument: ${arg}`);
      err(USAGE);
      return 2;
    }
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
    writeResults(outFile, serializeStudy(results));
    for (const line of summaryLines(results)) out(line);
    const relative = path.relative(process.cwd(), outFile);
    err(`Wrote ${relative !== '' && !relative.startsWith('..') ? relative : outFile}`);
    return 0;
  } catch (error) {
    err(`Study failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
