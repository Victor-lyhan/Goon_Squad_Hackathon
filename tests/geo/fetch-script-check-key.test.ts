// runFetchScript --check-key (server/geo/fetchScript.ts): the three-call Google access check behind a flag of the
// fetch command. It prints the rows of server/geo/keyCheck.ts, writes nothing and fetches nothing else.
// Temp folders with copies of the three real fixtures/nyc files and a fake Google client. No network, no real key, no .env.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MATRIX_FILE } from '../../server/geo/cache';
import { KEY_CHECK_FROM, KEY_CHECK_HEADER, KEY_CHECK_TO, USAGE, parseArgs } from '../../server/geo/fetchScript';
import { checkGoogleAccess, formatKeyCheck } from '../../server/geo/keyCheck';
import { KEY, KEY_ENCODED, businessesFile } from './fetch-routes-helpers';
import { fixturesOnly, leakedLines, printedLineCount, removeTempDirs, script, snapshot, tempDirWithCacheOf, tempFixturesDir } from './fetch-script-helpers';
import type { FakeGoogle } from './fetch-script-helpers';
import { APIS, GEOCODE_OK, MATRIX_OK, ROUTE_OK, failing, fakeClient, googleError } from './key-check-helpers';
import type { Api } from './key-check-helpers';

// The check is three calls on a fake client: a test takes a few ms locally. The seed run in `beforeAll` is a whole
// fetch with the matcher, about 20 ms locally (DECISIONS pass 51 and 52: explicit limits, at least 10x).
vi.setConfig({ testTimeout: 10_000, hookTimeout: 30_000 });

const FIRST_ADDRESS = businessesFile.businesses[0].address;
const FIX_LINE = 'Fix the rows above, then run the check again.';
const PASS_LINE = 'All three Google APIs answered.';

type KeyCheckFake = ReturnType<typeof fakeClient>;

/** The key-check fake as the `google` of `script`. Its own `calls` list is the one the tests read. */
const asGoogle = (fake: KeyCheckFake): FakeGoogle => ({ calls: { geocode: [], matrix: [], polyline: [] }, client: fake.client });

async function check(args: { dir: string; fake?: KeyCheckFake; argv?: string[]; env?: Record<string, string | undefined>; envPath?: string }) {
  const fake = args.fake ?? fakeClient();
  const run = await script({ dir: args.dir, argv: args.argv ?? ['--check-key'], env: args.env, envPath: args.envPath, google: asGoogle(fake) });
  return { code: run.code, lines: run.lines, keys: run.keys, calls: fake.calls };
}

const THREE_CALLS = [
  { fn: 'geocodeAddress', address: FIRST_ADDRESS },
  { fn: 'computeRouteMatrix', origins: [KEY_CHECK_FROM], destinations: [KEY_CHECK_TO] },
  { fn: 'computeRoutePolyline', origin: KEY_CHECK_FROM, destination: KEY_CHECK_TO },
];

// Google's documented wording for each cause (the same texts as tests/geo/key-check-classify.test.ts).
const ROUTES_NOT_ENABLED =
  'Routes API has not been used in project 123456789012 before or it is disabled. Enable it by visiting ' +
  'https://console.developers.google.com/apis/api/routes.googleapis.com/overview?project=123456789012 then retry.';
const GEOCODING_NOT_ENABLED = 'This API project is not authorized to use this API.';
const ROUTES_BILLING = 'This API method requires billing to be enabled. Please enable billing on project #123456789012 then retry.';

/** A folder a complete run was made on. Never changed after `beforeAll`; a test works on a copy. */
let seed: string;

beforeAll(async () => {
  seed = tempFixturesDir();
  const first = await script({ dir: seed });
  expect(first.code).toBe(0);
});

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(50);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

describe('runFetchScript --check-key: all three calls work', () => {
  it('makes exactly the three calls, in order: the first address of businesses.json, then the two fixed points', async () => {
    const { code, calls, keys } = await check({ dir: tempFixturesDir() });

    expect(code).toBe(0);
    expect(calls).toEqual(THREE_CALLS);
    expect(keys).toEqual([KEY]);
  });

  it('prints the header, then exactly what formatKeyCheck returns for the rows', async () => {
    const { lines } = await check({ dir: tempFixturesDir() });
    const rows = await checkGoogleAccess({ client: fakeClient().client, address: FIRST_ADDRESS, from: KEY_CHECK_FROM, to: KEY_CHECK_TO });

    expect(lines).toEqual([KEY_CHECK_HEADER, ...formatKeyCheck(rows)]);
    expect(lines).toHaveLength(5);
    expect(lines[1]).toMatch(/^Geocoding API \(geocode\): ok/);
    expect(lines[2]).toMatch(/^Routes API \(route matrix\): ok/);
    expect(lines[3]).toMatch(/^Routes API \(route line\): ok/);
    expect(lines.at(-1)).toBe(PASS_LINE);
    expect(KEY_CHECK_HEADER).toContain('three billable calls');
    expect(KEY_CHECK_HEADER).toContain('Nothing is written.');
  });

  it('writes nothing on an empty cache folder', async () => {
    const dir = tempFixturesDir();
    await check({ dir });
    expect(snapshot(dir)).toEqual(fixturesOnly());
  });

  it('leaves a complete cache byte for byte as it was, and asks for nothing the fetch would ask for', async () => {
    const dir = tempDirWithCacheOf(seed);
    const before = snapshot(dir);

    const { code, calls } = await check({ dir });

    expect(code).toBe(0);
    expect(calls).toHaveLength(3);
    expect(snapshot(dir)).toEqual(before);
  });

  it('does not open the cache: a matrix.json that cannot be read does not stop the check and is left alone', async () => {
    const dir = tempFixturesDir();
    fs.writeFileSync(path.join(dir, MATRIX_FILE), '{ "schemaVersion": 99, "places": {}, "pairs": {} }');
    const before = snapshot(dir);

    const { code, calls, lines } = await check({ dir });

    expect(code).toBe(0);
    expect(calls).toHaveLength(3);
    expect(lines.at(-1)).toBe(PASS_LINE);
    expect(snapshot(dir)).toEqual(before);
  });

  it('reads the key from .env when the environment has none', async () => {
    const dir = tempFixturesDir();
    const envPath = path.join(dir, 'test.env');
    fs.writeFileSync(envPath, `GOOGLE_MAPS_SERVER_KEY=${KEY}\n`);

    const { code, keys, calls, lines } = await check({ dir, env: {}, envPath });

    expect(code).toBe(0);
    expect(keys).toEqual([KEY]);
    expect(calls).toHaveLength(3);
    expect(lines.join('\n')).not.toContain(KEY);
  });

  it('the two fixed points are two different points inside New York City', () => {
    for (const point of [KEY_CHECK_FROM, KEY_CHECK_TO]) {
      expect(point.lat).toBeGreaterThan(40.57);
      expect(point.lat).toBeLessThan(40.88);
      expect(point.lng).toBeGreaterThan(-74.03);
      expect(point.lng).toBeLessThan(-73.75);
    }
    expect(KEY_CHECK_FROM).not.toEqual(KEY_CHECK_TO);
  });
});

describe('runFetchScript --check-key: a row failed', () => {
  const failures: [Api, number, string | null, string, string, string][] = [
    ['geocoding', 200, 'REQUEST_DENIED', GEOCODING_NOT_ENABLED, 'Geocoding API (geocode): api_not_enabled. Enable the Geocoding API for this project', 'HTTP 200 REQUEST_DENIED'],
    ['route_matrix', 403, 'PERMISSION_DENIED', ROUTES_NOT_ENABLED, 'Routes API (route matrix): api_not_enabled. Enable the Routes API for this project', 'HTTP 403 PERMISSION_DENIED'],
    ['routes', 403, 'PERMISSION_DENIED', ROUTES_BILLING, 'Routes API (route line): billing_off. Turn on billing for the Google Cloud project', 'HTTP 403 PERMISSION_DENIED'],
    ['route_matrix', 403, 'PERMISSION_DENIED', 'Something Google has never said before.', 'Routes API (route matrix): unknown. The answer from the Routes API does not point to one setting', 'HTTP 403 PERMISSION_DENIED: Something Google has never said before.'],
  ];

  it.each(failures)('%s refused (HTTP %i %s): exits 1 with that row, still makes all three calls and writes nothing', async (api, status, googleStatus, message, row, detail) => {
    const dir = tempDirWithCacheOf(seed);
    const before = snapshot(dir);

    const { code, lines, calls } = await check({ dir, fake: failing(api, googleError(api, status, googleStatus, message)) });

    expect(code).toBe(1);
    expect(calls).toEqual(THREE_CALLS);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe(KEY_CHECK_HEADER);
    const at = 1 + APIS.indexOf(api);
    expect(lines[at].startsWith(row)).toBe(true);
    expect(lines[at]).toContain(`Detail: ${detail}`);
    // The other two rows are ok.
    expect(lines.slice(1, 4).filter((line) => line.includes(': ok')).length).toBe(2);
    expect(lines.at(-1)).toBe(FIX_LINE);
    expect(snapshot(dir)).toEqual(before);
  });

  it('all three refused: three rows, exit 1', async () => {
    const denied = (api: Api) => () => {
      throw googleError(api, api === 'geocoding' ? 200 : 400, api === 'geocoding' ? 'REQUEST_DENIED' : 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.');
    };
    const fake = fakeClient({ geocoding: denied('geocoding'), route_matrix: denied('route_matrix'), routes: denied('routes') });

    const { code, lines, calls } = await check({ dir: tempFixturesDir(), fake });

    expect(code).toBe(1);
    expect(calls).toHaveLength(3);
    expect(lines.slice(1, 4).every((line) => line.includes(': key_invalid. Set GOOGLE_MAPS_SERVER_KEY in .env to a valid server key'))).toBe(true);
    expect(lines.at(-1)).toBe(FIX_LINE);
  });

  it('a call that answers with nothing usable is a failed row too (exit 1), not a pass', async () => {
    const { code, lines } = await check({ dir: tempFixturesDir(), fake: fakeClient({ geocoding: [] }) });

    expect(code).toBe(1);
    expect(lines[1]).toMatch(/^Geocoding API \(geocode\): no_result\./);
    expect(lines.at(-1)).toBe(FIX_LINE);
  });
});

describe('runFetchScript --check-key: what stops it before any call', () => {
  it.each([
    ['unset', {}],
    ['blank', { GOOGLE_MAPS_SERVER_KEY: '   ' }],
  ])('key %s: exits 1 with one line naming the variable and where it is read from', async (_name, env) => {
    const dir = tempFixturesDir();

    const { code, lines, keys, calls } = await check({ dir, env });

    expect(code).toBe(1);
    expect(keys).toEqual([]);
    expect(calls).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('GOOGLE_MAPS_SERVER_KEY is not set');
    expect(lines[0]).toContain('read from the environment or from .env at the repo root');
    expect(lines[0]).toContain('No Google call was made.');
    expect(snapshot(dir)).toEqual(fixturesOnly());
  });

  it('no key and no businesses.json: the missing key is the one thing reported', async () => {
    const dir = tempFixturesDir();
    fs.rmSync(path.join(dir, 'businesses.json'));

    const { code, lines, calls } = await check({ dir, env: {} });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('GOOGLE_MAPS_SERVER_KEY is not set');
  });

  it.each([
    ['is missing', (file: string) => fs.rmSync(file), 'is missing'],
    ['is not JSON', (file: string) => fs.writeFileSync(file, '{ "businesses": ['), 'is not valid JSON'],
    ['has no business', (file: string) => fs.writeFileSync(file, '{ "businesses": [] }'), 'does not have the expected shape'],
  ])('businesses.json %s: exits 1 with one line naming the file, and makes no call', async (_what, breakIt, says) => {
    const dir = tempFixturesDir();
    breakIt(path.join(dir, 'businesses.json'));

    const { code, lines, keys, calls } = await check({ dir });

    expect(code).toBe(1);
    expect(keys).toEqual([]);
    expect(calls).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('businesses.json');
    expect(lines[0]).toContain(says);
    expect(lines[0]).toContain('No Google call was made.');
  });

  it('needs only businesses.json: the check runs without neighborhoods.json and demoStory.json', async () => {
    const dir = tempFixturesDir();
    fs.rmSync(path.join(dir, 'neighborhoods.json'));
    fs.rmSync(path.join(dir, 'demoStory.json'));

    const { code, calls } = await check({ dir });

    expect(code).toBe(0);
    expect(calls).toHaveLength(3);
  });
});

describe('runFetchScript --check-key: the command line', () => {
  const WITH_DRY_RUN = '--check-key cannot be used with --dry-run: the check is three Google calls, and a dry run makes none.';
  const WITH_REFETCH = '--check-key cannot be used with --refetch: the check writes nothing, and --refetch changes the cache.';

  it.each([
    [['--check-key', '--dry-run'], WITH_DRY_RUN],
    [['--dry-run', '--check-key'], WITH_DRY_RUN],
    [['--check-key', '--refetch', 'biz-etsy'], WITH_REFETCH],
    [['--refetch=biz-etsy,home-001', '--check-key'], WITH_REFETCH],
    [['--check-key', '--dry-run', '--refetch', 'biz-etsy'], WITH_DRY_RUN],
    [['--check-key=yes'], '--check-key takes no value.'],
    [['--check-key', '--help'], '--help is used alone.'],
    [['--check-key', 'now'], 'Unexpected argument: this command takes only flags.'],
  ])('%j: exits 2 with the sentence and the usage text, before anything is read or called', async (argv, problem) => {
    const missing = path.join(tempFixturesDir(), 'no-such-folder');

    const { code, lines, keys, calls } = await check({ dir: missing, argv });

    expect(code).toBe(2);
    expect(keys).toEqual([]);
    expect(calls).toEqual([]);
    expect(lines).toEqual([problem, '', ...USAGE]);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('parseArgs: --check-key alone is the check, and may be repeated', () => {
    const checkOnly = { ok: true, options: { dryRun: false, help: false, refetch: [], checkKey: true } };
    expect(parseArgs(['--check-key'])).toEqual(checkOnly);
    expect(parseArgs(['--check-key', '--check-key'])).toEqual(checkOnly);
    expect(parseArgs([])).toEqual({ ok: true, options: { dryRun: false, help: false, refetch: [], checkKey: false } });
  });

  it('the usage text documents the flag, its three billable calls, that it writes nothing and its exit codes', () => {
    const usage = USAGE.join('\n');
    expect(usage).toContain('npm run fetch:routes -- --check-key');
    expect(usage).toContain('  --check-key');
    expect(usage).toMatch(/Costs three\s+billable calls\./);
    expect(usage).toContain('one geocode');
    expect(usage).toContain('one 1x1 route matrix and one route line');
    expect(usage).toContain('writes nothing and fetches nothing else');
    expect(usage).toMatch(/without\s+--dry-run or --refetch/);
    expect(usage).toContain('Exits 0 when all three calls worked, 1 when one did not or no key is set.');
    expect(usage).toContain('points at --check-key');
  });
});

describe('runFetchScript --check-key: the key is never printed', () => {
  // What Google or a proxy could echo back: the key itself, its URL-encoded form, a request URL and a header.
  const echo = `denied for ${KEY} (https://maps.example/geocode?address=x&key=${KEY_ENCODED}) X-Goog-Api-Key: ${KEY}`;

  it.each([
    ['a Google error on every call', (api: Api) => googleError(api, 403, 'PERMISSION_DENIED', echo)],
    ['a Google error with the key in its status', (api: Api) => googleError(api, 403, KEY, `API key not valid. ${echo}`)],
    ['a plain Error on every call', () => new Error(echo)],
    ['something that is not an Error', () => ({ key: KEY, url: `https://maps.example/?key=${KEY_ENCODED}` })],
  ])('%s: exit 1, and no line holds the key in either form', async (_name, errorFor) => {
    const thrower = (api: Api) => () => {
      throw errorFor(api);
    };
    const fake = fakeClient({ geocoding: thrower('geocoding'), route_matrix: thrower('route_matrix'), routes: thrower('routes') });

    const { code, lines, calls } = await check({ dir: tempFixturesDir(), fake });

    expect(code).toBe(1);
    expect(calls).toHaveLength(3);
    expect(lines).toHaveLength(5);
    const printed = lines.join('\n');
    expect(printed).not.toContain(KEY);
    expect(printed).not.toContain(KEY_ENCODED);
    expect(lines.at(-1)).toBe(FIX_LINE);
  });

  it('a working check and a check without a key print no key either', async () => {
    const dir = tempFixturesDir();
    const answers = { geocoding: [{ ...GEOCODE_OK[0], formattedAddress: `somewhere ${KEY}` }], route_matrix: MATRIX_OK, routes: ROUTE_OK };
    const runs = [await check({ dir, fake: fakeClient(answers) }), await check({ dir, env: {} }), await check({ dir, argv: ['--check-key', `--key=${KEY}`] })];

    expect(runs.map((run) => run.code)).toEqual([0, 1, 2]);
    for (const run of runs) {
      expect(run.lines.join('\n')).not.toContain(KEY);
      expect(run.lines.join('\n')).not.toContain(KEY_ENCODED);
    }
  });
});
