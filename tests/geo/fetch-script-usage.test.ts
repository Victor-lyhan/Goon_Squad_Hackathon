// runFetchScript (server/geo/fetchScript.ts): everything that stops before a Google call (no key, a file that
// cannot be used, a wrong flag, --help), and the real `scripts/fetch-routes.ts` started as a process.
// Temp folders with copies of the three real fixtures/nyc files; no network, no real key, no .env.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MATRIX_FILE, POLYLINES_FILE } from '../../server/geo/cache';
import { RESUME_LINE, USAGE, parseArgs } from '../../server/geo/fetchScript';
import { KEY, KEY_ENCODED, repoRoot, totalCalls } from './fetch-routes-helpers';
import { FIXTURE_NAMES, cityClient, fixturesOnly, leakedLines, printedLineCount, removeTempDirs, script, snapshot, tempFixturesDir } from './fetch-script-helpers';

// Starting node with tsx takes about a second; the dry run also reads the fixtures and may run the matcher.
const PROCESS_TIMEOUT_MS = 60_000;

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(20);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

describe('runFetchScript: no key', () => {
  it.each([
    ['unset', {}],
    ['blank', { GOOGLE_MAPS_SERVER_KEY: '   ' }],
  ])('%s: exits 1 with one line naming the variable and .env, and makes no call', async (_name, env) => {
    const dir = tempFixturesDir();
    const { code, lines, keys, calls } = await script({ dir, env });

    expect(code).toBe(1);
    expect(keys).toEqual([]);
    expect(totalCalls(calls)).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('GOOGLE_MAPS_SERVER_KEY is not set');
    expect(lines[0]).toContain('.env');
    expect(snapshot(dir)).toEqual(fixturesOnly());
  });

  it('reads the key from .env when the environment has none, and hands it only to the client', async () => {
    const dir = tempFixturesDir();
    const envPath = path.join(dir, 'test.env');
    fs.writeFileSync(envPath, `GOOGLE_MAPS_SERVER_KEY=${KEY}\n`);
    // Every geocode fails, with the key in the error, so the run stops early and the output can be checked for it.
    const google = cityClient({
      geocode: () => {
        throw new Error(`denied for ${KEY} (https://maps.example/geocode?address=x&key=${KEY_ENCODED})`);
      },
    });

    const { code, lines, keys } = await script({ dir, env: {}, envPath, google });

    expect(keys).toEqual([KEY]);
    expect(code).toBe(1);
    expect(lines.at(-1)).toBe(RESUME_LINE);
    expect(lines.some((line) => line.includes('denied for [redacted]'))).toBe(true);
    expect(lines.join('\n')).not.toContain(KEY);
    expect(lines.join('\n')).not.toContain(KEY_ENCODED);
  });
});

describe('runFetchScript: a file that cannot be used', () => {
  const breakages: [string, (file: string) => void, string][] = [
    ['is not JSON', (file) => fs.writeFileSync(file, '{ "businesses": ['), 'is not valid JSON'],
    ['has the wrong shape', (file) => fs.writeFileSync(file, '{ "items": [] }'), 'does not have the expected shape'],
    ['is missing', (file) => fs.rmSync(file), 'is missing'],
  ];
  const cases = FIXTURE_NAMES.flatMap((name) => breakages.map(([what, breakIt, says]): [string, string, (file: string) => void, string] => [name, what, breakIt, says]));

  it.each(cases)('%s %s: exits 1 with one line naming the file, and makes no call', async (name, _what, breakIt, says) => {
    const dir = tempFixturesDir();
    breakIt(path.join(dir, name));
    const before = snapshot(dir);

    for (const argv of [[], ['--dry-run']]) {
      const { code, lines, keys, calls } = await script({ dir, argv });
      expect(code).toBe(1);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(name);
      expect(lines[0]).toContain(says);
      expect(lines[0]).toContain('No Google call was made.');
    }
    expect(snapshot(dir)).toEqual(before);
  });

  it('names the field of a fixture file that has a wrong value', async () => {
    const dir = tempFixturesDir();
    const file = path.join(dir, 'demoStory.json');
    const story = JSON.parse(fs.readFileSync(file, 'utf8'));
    story.shipments[2].expect = 'maybe';
    fs.writeFileSync(file, JSON.stringify(story));

    const { code, lines, calls } = await script({ dir });

    expect(code).toBe(1);
    expect(totalCalls(calls)).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('demoStory.json does not have the expected shape at shipments.2.expect');
  });

  it('names the story row that points at a business that is not in businesses.json', async () => {
    const dir = tempFixturesDir();
    const file = path.join(dir, 'demoStory.json');
    const story = JSON.parse(fs.readFileSync(file, 'utf8'));
    story.shipments[4].destinationBusinessId = 'biz-closed-last-year';
    fs.writeFileSync(file, JSON.stringify(story));

    const { code, lines, keys, calls } = await script({ dir });

    expect(code).toBe(1);
    expect(keys).toEqual([]);
    expect(totalCalls(calls)).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('demoStory.json names a business at shipments.4.destinationBusinessId that is not in businesses.json.');
    expect(lines[0]).toContain('No Google call was made.');
  });

  it('a cache file that cannot be read: exits 1 naming it, makes no call and leaves it alone', async () => {
    const dir = tempFixturesDir();
    fs.writeFileSync(path.join(dir, MATRIX_FILE), '{ "schemaVersion": 99, "places": {}, "pairs": {} }');
    const before = snapshot(dir);

    for (const argv of [[], ['--dry-run']]) {
      const { code, lines, keys, calls } = await script({ dir, argv });
      expect(code).toBe(1);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(MATRIX_FILE);
      expect(lines[0]).toContain('schemaVersion');
    }
    expect(snapshot(dir)).toEqual(before);
  });

  it('route lines without a matrix: a run refuses to replace them, a dry run still estimates', async () => {
    const dir = tempFixturesDir();
    fs.writeFileSync(path.join(dir, POLYLINES_FILE), '{ "schemaVersion": 1, "polylines": { "biz-etsy|home-001": "paid-for" } }\n');
    const before = snapshot(dir);

    const run = await script({ dir });
    expect(run.code).toBe(1);
    expect(run.keys).toEqual([]);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain(`${POLYLINES_FILE} exists but ${MATRIX_FILE} does not`);

    const dry = await script({ dir, argv: ['--dry-run'] });
    expect(dry.code).toBe(0);
    expect(totalCalls(dry.calls)).toBe(0);
    expect(dry.lines.some((line) => line.startsWith('A run would stop: ') && line.includes(POLYLINES_FILE))).toBe(true);
    expect(snapshot(dir)).toEqual(before);
  });
});

describe('runFetchScript: the command line', () => {
  it.each([
    [['--nope'], 'Unknown flag --nope.'],
    [['--dry-run', '--nope'], 'Unknown flag --nope.'],
    [['--refetch', 'biz-etsy'], 'Unknown flag --refetch.'],
    [['--dry-run=yes'], '--dry-run takes no value.'],
    [['--help', '--dry-run'], '--help is used alone.'],
    [['fixtures/nyc'], 'Unexpected argument: this command takes only flags.'],
  ])('%j: exits 2 with the problem and the usage text, before anything is read', async (argv, problem) => {
    const missing = path.join(tempFixturesDir(), 'no-such-folder');
    const { code, lines, keys, calls } = await script({ dir: missing, argv });

    expect(code).toBe(2);
    expect(keys).toEqual([]);
    expect(totalCalls(calls)).toBe(0);
    expect(lines).toEqual([problem, '', ...USAGE]);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('does not repeat an argument that is not a plain flag name: it could be a pasted key', async () => {
    for (const argv of [[KEY], [`--key=${KEY}`], [`--${KEY}`], ['--dry-run', KEY_ENCODED]]) {
      const { code, lines } = await script({ dir: tempFixturesDir(), argv });
      expect(code).toBe(2);
      expect(lines.join('\n')).not.toContain(KEY);
      expect(lines.join('\n')).not.toContain(KEY_ENCODED);
    }
  });

  it.each([[['--help']], [['-h']]])('%j: prints the usage text and exits 0, before anything is read', async (argv) => {
    const missing = path.join(tempFixturesDir(), 'no-such-folder');
    const { code, lines, keys } = await script({ dir: missing, argv, env: {} });

    expect(code).toBe(0);
    expect(keys).toEqual([]);
    expect(lines).toEqual([...USAGE]);
  });

  it('the usage text names both flags, the key variable, that re-running is safe and that the key is never printed', () => {
    const usage = USAGE.join('\n');
    expect(usage).toContain('--dry-run');
    expect(usage).toContain('--help');
    expect(usage).toContain('GOOGLE_MAPS_SERVER_KEY');
    expect(usage).toContain('Re-running is safe: whatever is already in the two cache files is skipped');
    expect(usage).toContain('It is never printed.');
    expect(usage).toContain('fixtures/nyc/matrix.json');
    expect(usage).toContain('fixtures/nyc/polylines.json');
  });

  it('parseArgs: no flag is a real run, --dry-run may be repeated', () => {
    expect(parseArgs([])).toEqual({ ok: true, options: { dryRun: false, help: false } });
    expect(parseArgs(['--dry-run'])).toEqual({ ok: true, options: { dryRun: true, help: false } });
    expect(parseArgs(['--dry-run', '--dry-run'])).toEqual({ ok: true, options: { dryRun: true, help: false } });
    expect(parseArgs(['--help'])).toEqual({ ok: true, options: { dryRun: false, help: true } });
  });
});

describe('npm run fetch:routes: the real script file', () => {
  // The root tsconfig does not typecheck scripts/, so these start the file itself. The child gets no key, and
  // neither --help nor --dry-run calls Google or writes a file.
  const env = { ...process.env };
  delete env.GOOGLE_MAPS_SERVER_KEY;
  const start = (...flags: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/fetch-routes.ts', ...flags], { cwd: repoRoot, env, encoding: 'utf8', timeout: PROCESS_TIMEOUT_MS });

  it('package.json has the fetch:routes entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['fetch:routes']).toBe('tsx scripts/fetch-routes.ts');
  });

  it(
    '--help exits 0 with the usage text, an unknown flag exits 2',
    () => {
      const help = start('--help');
      expect(help.status).toBe(0);
      expect(help.stdout).toBe(`${USAGE.join('\n')}\n`);

      const wrong = start('--nope');
      expect(wrong.status).toBe(2);
      expect(wrong.stdout).toContain('Unknown flag --nope.');
    },
    PROCESS_TIMEOUT_MS * 2,
  );

  it(
    '--dry-run exits 0 from the repo root, prints the estimate and changes nothing in fixtures/nyc',
    () => {
      const dir = path.join(repoRoot, 'fixtures/nyc');
      const before = snapshot(dir);

      const dry = start('--dry-run');

      expect(dry.stderr).toBe('');
      expect(dry.status).toBe(0);
      expect(dry.stdout.split('\n')[0]).toBe('Fetch estimate (no Google call was made)');
      expect(dry.stdout).toContain('Nothing was written. Cache folder: fixtures/nyc');
      expect(snapshot(dir)).toEqual(before);
    },
    PROCESS_TIMEOUT_MS,
  );
});
