// `npm run study`: the command line around runStudy. Writes only into a temp folder; reads the committed cache.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_STUDY_OUT, runStudyCli, serializeStudy, summaryLines } from '../../scripts/study/cli';
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

  it('prints help without running', () => {
    const { code, stdout } = run(['--help']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toMatch(/Usage: npm run study/);
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
