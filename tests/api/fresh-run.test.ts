// scripts/fresh-run.mjs (#965): `npm run dev` runs it once, before the servers start, so the app opens on the
// fresh run (the 24 story deliveries). `npm run dev:keep` and `npm start` keep the saved run.
//
// The script is run here as `npm run dev` runs it: with plain `node`, as a process of its own. It finds the
// repo root from its own place, so every test runs a copy in a temp folder laid out like the repo
// (`<root>/scripts/fresh-run.mjs`, `<root>/.env`, `<root>/data/state-v2.json`). The temp folder has no
// node_modules, and the repo's own `.env` and data/ are never read or touched.
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createV2Runtime } from '../../server/api/v2/bootstrap';
import { NYC_FIXTURES_DIR, sourcePathFor } from '../../server/api/v2/bootRun';
import { loadDotEnv } from '../../server/geo/env';
import { STATE_PATH_NAME, statePathFrom } from '../../server/index';

const T = 60_000; // each run starts a node process; the limit is wide for a loaded machine

const repoRoot = path.resolve(__dirname, '../..');
const SCRIPT = path.join(repoRoot, 'scripts', 'fresh-run.mjs');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

const REMOVED = 'Fresh run: removed the saved run';
const NOTHING = 'Fresh run: nothing saved';
// What `npm run dev` was before #965, and what `npm run dev:keep` is now.
const SERVERS = 'concurrently -k -n api,web -c blue,green "tsx watch server/index.ts" "vite"';

// Not real keys: a `.env` holds them next to RELAY_STATE_PATH, and none may reach the output.
const FAKE_KEYS = ['AQ.FAKE_gemini-965', 'AIzaFAKE-browser-965', 'FAKE-server-key-965'];
const KEY_LINES = `GEMINI_API_KEY=${FAKE_KEYS[0]}\nVITE_GOOGLE_MAPS_BROWSER_KEY=${FAKE_KEYS[1]}\nGOOGLE_MAPS_SERVER_KEY=${FAKE_KEYS[2]}\n`;

type Repo = { root: string; script: string; envPath: string; statePath: string };

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A folder laid out like the repo, with a copy of the script and nothing else: no `.env`, no data/. */
function tempRepo(): Repo {
  // realpath: on macOS the temp folder is behind a symlink.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-run-')));
  roots.push(root);
  const script = path.join(root, 'scripts', 'fresh-run.mjs');
  fs.mkdirSync(path.dirname(script));
  fs.copyFileSync(SCRIPT, script);
  return { root, script, envPath: path.join(root, '.env'), statePath: path.join(root, 'data', 'state-v2.json') };
}

/** Writes `file` (and its folder) with something in it. */
function save(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"saved":"run"}\n');
}

/** Every file under `dir`, as paths relative to it, sorted. A folder with no file in it is named with a slash. */
function files(dir: string): string[] {
  const seen: string[] = [];
  const walk = (at: string) => {
    const entries = fs.readdirSync(at, { withFileTypes: true });
    if (entries.length === 0 && at !== dir) seen.push(`${path.relative(dir, at)}/`);
    for (const entry of entries) {
      const file = path.join(at, entry.name);
      if (entry.isDirectory()) walk(file);
      else seen.push(path.relative(dir, file));
    }
  };
  walk(dir);
  return seen.map((file) => file.split(path.sep).join('/')).sort();
}

/**
 * Runs the copy of the script with plain node. The environment is the one given and PATH: RELAY_STATE_PATH of
 * the machine that runs the tests never gets in. The working directory is the repo root, as with `npm run dev`.
 */
function run(repo: Repo, env: Record<string, string> = {}, cwd: string = repo.root) {
  const result = spawnSync(process.execPath, [repo.script], {
    cwd, env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: T,
  });
  for (const key of FAKE_KEYS) expect(result.stdout + result.stderr).not.toContain(key);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const removed = { status: 0, stdout: `${REMOVED}\n`, stderr: '' };
const nothing = { status: 0, stdout: `${NOTHING}\n`, stderr: '' };

describe('fresh run: the default state file', () => {
  it('removes data/state-v2.json, says so in one line and exits 0', () => {
    const repo = tempRepo();
    save(repo.statePath);
    expect(run(repo)).toStrictEqual(removed);
    expect(fs.existsSync(repo.statePath)).toBe(false);
    // A second start has nothing to remove.
    expect(run(repo)).toStrictEqual(nothing);
  }, T);

  it('removes only the state file: the sidecar and the runs set aside stay', () => {
    const repo = tempRepo();
    const kept = [sourcePathFor(repo.statePath), `${repo.statePath}.stale-1`, `${repo.statePath}.bad-1`, path.join(repo.root, 'data', 'study', 'results.json')];
    for (const file of [repo.statePath, ...kept]) save(file);
    expect(run(repo)).toStrictEqual(removed);
    expect(files(path.join(repo.root, 'data'))).toStrictEqual([
      'state-v2.json.bad-1', 'state-v2.json.stale-1', 'state-v2.source.json', 'study/results.json',
    ]);
  }, T);

  it('nothing saved: one line, exit 0, and nothing is created', () => {
    // No data folder at all (a fresh clone).
    const clone = tempRepo();
    expect(run(clone)).toStrictEqual(nothing);
    expect(files(clone.root)).toStrictEqual(['scripts/fresh-run.mjs']);

    // A data folder with no state file in it.
    const empty = tempRepo();
    fs.mkdirSync(path.join(empty.root, 'data'));
    expect(run(empty)).toStrictEqual(nothing);
    expect(files(empty.root)).toStrictEqual(['data/', 'scripts/fresh-run.mjs']);

    // "data" is a file, so data/state-v2.json cannot be there (ENOTDIR).
    const odd = tempRepo();
    fs.writeFileSync(path.join(odd.root, 'data'), 'not a folder');
    expect(run(odd)).toStrictEqual(nothing);
    expect(files(odd.root)).toStrictEqual(['data', 'scripts/fresh-run.mjs']);
  }, T);

  it('the working directory does not move the default file or the .env', () => {
    const repo = tempRepo();
    const elsewhere = tempRepo();
    save(repo.statePath);
    save(elsewhere.statePath);
    expect(run(repo, {}, elsewhere.root)).toStrictEqual(removed);
    expect(fs.existsSync(repo.statePath)).toBe(false);
    expect(fs.existsSync(elsewhere.statePath)).toBe(true);
  }, T);

  it('a state file that cannot be removed: one line with the file and the code, still exit 0', () => {
    const repo = tempRepo();
    fs.mkdirSync(repo.statePath, { recursive: true }); // a folder where the file would be
    const result = run(repo);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.endsWith('\n')).toBe(true);
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(result.stdout).toMatch(/^Fresh run: could not remove the saved run .*state-v2\.json \(E[A-Z]+\)\n$/);
    expect(result.stdout).toContain(repo.statePath);
    expect(fs.statSync(repo.statePath).isDirectory()).toBe(true);
  }, T);
});

describe('fresh run: RELAY_STATE_PATH', () => {
  it('from the environment: removes that file and leaves data/state-v2.json alone', () => {
    const repo = tempRepo();
    const qa = path.join(repo.root, 'qa', 'run.json');
    save(repo.statePath);
    save(qa);
    expect(run(repo, { [STATE_PATH_NAME]: qa })).toStrictEqual(removed);
    expect(fs.existsSync(qa)).toBe(false);
    expect(fs.existsSync(repo.statePath)).toBe(true);
    expect(run(repo, { [STATE_PATH_NAME]: qa })).toStrictEqual(nothing);
    expect(fs.existsSync(repo.statePath)).toBe(true);
  }, T);

  it('from .env: removes that file, and prints nothing of the keys next to it', () => {
    const repo = tempRepo();
    const qa = path.join(repo.root, 'qa', 'run.json');
    save(repo.statePath);
    save(qa);
    fs.writeFileSync(repo.envPath, `${KEY_LINES}${STATE_PATH_NAME}=${qa}\n`);
    expect(run(repo)).toStrictEqual(removed);
    expect(fs.existsSync(qa)).toBe(false);
    expect(fs.existsSync(repo.statePath)).toBe(true);
    expect(run(repo)).toStrictEqual(nothing);
    expect(fs.readFileSync(repo.envPath, 'utf8')).toBe(`${KEY_LINES}${STATE_PATH_NAME}=${qa}\n`); // read, never written
  }, T);

  it('a relative path counts from the working directory', () => {
    const repo = tempRepo();
    const cwd = tempRepo();
    save(path.join(repo.root, 'qa', 'run.json'));
    save(path.join(cwd.root, 'qa', 'run.json'));
    expect(run(repo, { [STATE_PATH_NAME]: 'qa/run.json' }, cwd.root)).toStrictEqual(removed);
    expect(fs.existsSync(path.join(cwd.root, 'qa', 'run.json'))).toBe(false);
    expect(fs.existsSync(path.join(repo.root, 'qa', 'run.json'))).toBe(true);
  }, T);

  // The script cannot import the server's code (plain Node, nothing compiled), so it has the two rules written
  // out again. Each case below pins the file by name and also asks the server's own `loadDotEnv` and
  // `statePathFrom` for it: a change to either rule that the script does not follow fails here.
  type Case = {
    name: string;
    /** RELAY_STATE_PATH in the environment; left out: not set. `{qa}`, `{dir}` and `{other}` are filled in. */
    env?: string;
    /** The `.env` file; left out: none. */
    dotEnv?: string;
    /** The one file that goes: 'default' | 'qa' (a file) | 'dir' (state-v2.json in a folder) | 'other'. */
    want: 'default' | 'qa' | 'dir' | 'other';
  };
  const CASES: Case[] = [
    { name: 'not set anywhere', want: 'default' },
    { name: 'a file, in the environment', env: '{qa}', want: 'qa' },
    { name: 'spaces around the value', env: '  {qa}  ', want: 'qa' },
    { name: 'a folder that is there, without a slash', env: '{dir}', want: 'dir' },
    { name: 'a folder with a slash at the end', env: '{dir}/', want: 'dir' },
    { name: 'blank in the environment', env: '   ', want: 'default' },
    { name: 'empty in the environment still wins over .env', env: '', dotEnv: 'RELAY_STATE_PATH={qa}\n', want: 'default' },
    { name: 'the environment wins over .env', env: '{other}', dotEnv: 'RELAY_STATE_PATH={qa}\n', want: 'other' },
    { name: '.env, plain', dotEnv: 'RELAY_STATE_PATH={qa}\n', want: 'qa' },
    { name: '.env, no newline at the end', dotEnv: 'RELAY_STATE_PATH={qa}', want: 'qa' },
    { name: '.env, export and double quotes and a comment', dotEnv: 'export RELAY_STATE_PATH="{qa}"   # the QA run\n', want: 'qa' },
    { name: '.env, single quotes and spaces around =', dotEnv: "  RELAY_STATE_PATH = '{qa}'\n", want: 'qa' },
    { name: '.env, unquoted with a comment after it', dotEnv: 'RELAY_STATE_PATH={qa} # the QA run\n', want: 'qa' },
    { name: '.env, a byte order mark and Windows line ends', dotEnv: '﻿RELAY_STATE_PATH={qa}\r\nPORT=3001\r\n', want: 'qa' },
    { name: '.env, after other lines', dotEnv: `# keys\n\n${KEY_LINES}PORT=3001\nRELAY_STATE_PATH={qa}\n`, want: 'qa' },
    { name: '.env, the first of two lines counts', dotEnv: 'RELAY_STATE_PATH={qa}\nRELAY_STATE_PATH={other}\n', want: 'qa' },
    { name: '.env, a folder with a slash', dotEnv: 'RELAY_STATE_PATH={dir}/\n', want: 'dir' },
    { name: '.env, blank value', dotEnv: 'RELAY_STATE_PATH=\n', want: 'default' },
    { name: '.env, a comment line and another name are not it', dotEnv: '# RELAY_STATE_PATH={qa}\nMY_RELAY_STATE_PATH={other}\nRELAY_STATE_PATHS={other}\n', want: 'default' },
  ];

  it.each(CASES)('finds the file as the server does: $name', ({ env, dotEnv, want }) => {
    const repo = tempRepo();
    const dir = path.join(repo.root, 'qa-folder');
    const candidates = {
      default: repo.statePath,
      qa: path.join(repo.root, 'qa', 'run.json'),
      dir: path.join(dir, 'state-v2.json'),
      other: path.join(repo.root, 'other', 'state-v2.json'),
    };
    const fill = (text: string) => text.replaceAll('{qa}', candidates.qa).replaceAll('{dir}', dir).replaceAll('{other}', candidates.other);
    for (const file of Object.values(candidates)) save(file);
    if (dotEnv !== undefined) fs.writeFileSync(repo.envPath, fill(dotEnv));
    const given: Record<string, string> = env === undefined ? {} : { [STATE_PATH_NAME]: fill(env) };

    // The server's answer: `.env` loaded into the environment, then the state file read from it.
    const serverEnv: Record<string, string | undefined> = { ...given };
    loadDotEnv(repo.envPath, serverEnv);
    expect(statePathFrom(serverEnv, repo.statePath)).toBe(candidates[want]);

    expect(run(repo, given)).toStrictEqual(removed);
    for (const [name, file] of Object.entries(candidates)) expect(fs.existsSync(file), name).toBe(name !== want);
  }, T);
});

describe('fresh run: the next start', () => {
  it('a run with a test delivery in it is gone: the server opens on the 24 story deliveries, with no notice', async () => {
    const repo = tempRepo();
    const fixturesDir = path.join(repo.root, 'fixtures', 'nyc');
    fs.cpSync(NYC_FIXTURES_DIR, fixturesDir, { recursive: true });
    const boot = () => {
      const runtime = createV2Runtime({ fixturesDir, statePath: repo.statePath, key: null });
      if (runtime.status !== 'ready' || !runtime.deps.store) throw new Error(`expected a ready runtime, got: ${runtime.reason}`);
      return { runtime, store: runtime.deps.store };
    };

    // A session that added a test delivery, stopped: the state file holds 25.
    const first = boot();
    const fresh = structuredClone(first.store.get().scenario);
    expect(fresh.shipments).toHaveLength(24);
    await first.store.mutate((saved) => {
      saved.scenario.shipments.push({ ...saved.scenario.shipments[0], id: 'shp-test-request' });
    });
    await first.runtime.shutdown();
    expect(JSON.parse(fs.readFileSync(repo.statePath, 'utf8')).run.scenario.shipments).toHaveLength(25);

    // `npm run dev:keep` and `npm start`: no fresh-run, so the next start restores the 25.
    const kept = boot();
    expect(kept.store.get().scenario.shipments).toHaveLength(25);
    await kept.runtime.shutdown();

    // `npm run dev`: fresh-run first, then the server.
    expect(run(repo)).toStrictEqual(removed);
    const next = boot();
    expect(next.runtime.notice).toBeUndefined(); // the sidecar stayed, so nothing is reported as set aside
    expect(next.store.get().scenario).toStrictEqual(fresh);
    expect(next.store.get().clock.timeMin).toBe(fresh.settings.simStartMin);
    await next.runtime.shutdown();
    expect(files(path.join(repo.root, 'data')).filter((file) => /stale|bad/.test(file))).toStrictEqual([]);
  }, T);
});

describe('fresh run: how it is wired', () => {
  it('npm run dev calls it once, before concurrently; npm run dev:keep is the old dev command', () => {
    expect(pkg.scripts['dev:keep']).toBe(SERVERS);
    expect(pkg.scripts.dev).toBe(`node scripts/fresh-run.mjs && ${SERVERS}`);
    const dev = pkg.scripts.dev;
    expect(dev.indexOf('scripts/fresh-run.mjs')).toBeGreaterThanOrEqual(0);
    expect(dev.indexOf('scripts/fresh-run.mjs')).toBeLessThan(dev.indexOf('concurrently'));
    expect(dev.split('fresh-run').length - 1).toBe(1);
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });

  it('nothing else calls it: not the watched server command (a reload keeps the run), not npm start', () => {
    // `tsx watch` restarts exactly this command at every reload.
    expect(SERVERS).toContain('"tsx watch server/index.ts"');
    expect(SERVERS).not.toContain('fresh-run');
    expect(pkg.scripts.start).toBe('tsx server/index.ts'); // production: unchanged
    const others = Object.entries(pkg.scripts).filter(([name, command]) => name !== 'dev' && command.includes('fresh-run'));
    expect(others).toStrictEqual([]);
    // The server never removes its state file by itself.
    for (const file of ['server/index.ts', 'server/api/v2/bootstrap.ts', 'server/api/v2/bootRun.ts']) {
      expect(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file).not.toContain('fresh-run');
    }
  });

  it('is plain Node: it imports only node: modules', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');
    const imports = [...source.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) expect(name).toMatch(/^node:/);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it('the README names both commands and the two lines in Setup and run', () => {
    const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
    const start = readme.indexOf('\n## Setup and run\n');
    const setup = readme.slice(start, readme.indexOf('\n## ', start + 1));
    expect(setup).toContain('`npm run dev` starts on the fresh run, the 24 story deliveries');
    expect(setup).toContain('`npm run dev:keep`');
    expect(setup).toContain(`"${REMOVED}"`);
    expect(setup).toContain(`"${NOTHING}"`);
  });
});
