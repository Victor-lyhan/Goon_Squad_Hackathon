// runFetchScript (server/geo/fetchScript.ts): no line the command prints holds the ID of a home typed into the
// commute editor (`home-c-<lat>_<lng>`, which is the address), on any path and for any flag (issue #640).
// The path that could break the rule before: a cache the reader refuses. server/geo/cache.ts quotes the bad place
// ID or pair key in its error, and a plain run and a `--dry-run` print that message after `Cannot start:`.
// Temp folders with copies of the three real fixtures/nyc files and a fake Google client. Nothing is written
// outside the temp folder. No network, no real key, no .env.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles, writeTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { hideEnteredIds } from '../../server/geo/cacheEdit';
import { USAGE, hideEntered } from '../../server/geo/fetchScript';
import { ENTERED_HOMES, ENTERED_ID_PATTERN } from './cache-edit-helpers';
import { BUSINESS_IDS, KEY, totalCalls } from './fetch-routes-helpers';
import { cityClient, leakedLines, printedLineCount, removeTempDirs, script, snapshot, tempDirWithCacheOf, tempFixturesDir, withCityEnteredHomes } from './fetch-script-helpers';

// The seed run (the whole fetch with the fake client) takes about 0.1 s locally.
const TEST_TIMEOUT_MS = 30_000;
vi.setConfig({ testTimeout: TEST_TIMEOUT_MS, hookTimeout: TEST_TIMEOUT_MS });

/** A made-up point on round numbers; nobody's address. */
const ENTERED = ENTERED_HOMES[0];
const ID = ENTERED.id;
// What `hideEnteredIds` (server/geo/cacheEdit.ts) puts in the place of an ID. It takes everything up to the next
// space, quote, comma, semicolon, `|` or `)`, so a `:` or a `.` right after the ID goes with it.
const HIDDEN = 'home-c (entered address)';
const BUSINESS = BUSINESS_IDS[0];

/** No ID, and neither of its two numbers in any form a line could hold them. */
const noAddress = (lines: readonly string[]) => {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).not.toMatch(/home-c-\d/);
    expect(line).not.toMatch(ENTERED_ID_PATTERN);
    expect(line).not.toContain('40.70000');
    expect(line).not.toContain('73.90000');
  }
};

const cacheOf = (dir: string): TravelFiles => {
  const files = readTravelFiles(dir);
  if (files === null) throw new Error('no matrix.json');
  return files;
};

/** A folder a complete run was made on. Never changed after `beforeAll`; every test works on a copy. */
let seed: string;
let complete: TravelFiles;

/** A copy of the seed's cache plus the entered home, saved the way the live server saves it. */
function dirWithEnteredHome(): string {
  const dir = tempDirWithCacheOf(seed);
  writeTravelFiles(dir, withCityEnteredHomes(complete, [ENTERED]));
  return dir;
}

/** Rewrites one cache file of the folder by hand, the way a bad merge or an editor would. */
function edit(dir: string, name: string, change: (json: any) => void): void {
  const file = path.join(dir, name);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(json);
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

beforeAll(async () => {
  expect(ID).toBe('home-c-40.70000_-73.90000');
  seed = tempFixturesDir();
  const first = await script({ dir: seed });
  expect(first.code).toBe(0);
  complete = cacheOf(seed);
});

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(100);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

describe('runFetchScript on a cache the reader refuses at an entered home', () => {
  // Each entry: the hand edit, and the reader's message (server/geo/cache.ts) with the ID hidden.
  const broken: [string, (dir: string) => void, RegExp][] = [
    [
      'a place whose lat is not a number',
      (dir) => edit(dir, MATRIX_FILE, (matrix) => (matrix.places[ID].lat = 'not a number')),
      /matrix\.json: place "home-c \(entered address\)" needs a numeric lat and lng /,
    ],
    [
      'a place whose formattedAddress is not a string',
      (dir) => edit(dir, MATRIX_FILE, (matrix) => (matrix.places[ID].formattedAddress = 7)),
      /matrix\.json: place "home-c \(entered address\)" has a formattedAddress that is not a string /,
    ],
    [
      'a pair from it with a negative duration',
      (dir) => edit(dir, MATRIX_FILE, (matrix) => (matrix.pairs[`${ID}|${BUSINESS}`].durationS = -1)),
      new RegExp(`matrix\\.json: pair "home-c \\(entered address\\)\\|${BUSINESS}" needs a non-negative durationS and distanceM `),
    ],
    [
      'a pair to it without a distance',
      (dir) => edit(dir, MATRIX_FILE, (matrix) => delete matrix.pairs[`${BUSINESS}|${ID}`].distanceM),
      new RegExp(`matrix\\.json: pair "${BUSINESS}\\|home-c \\(entered address\\)" needs a non-negative durationS and distanceM `),
    ],
    [
      'a pair key that is only its ID',
      (dir) => edit(dir, MATRIX_FILE, (matrix) => (matrix.pairs[ID] = { durationS: 600, distanceM: 4000 })),
      /matrix\.json: pair key "home-c \(entered address\)" is not "<from>\|<to>" /,
    ],
    [
      'an empty route line to it',
      (dir) => edit(dir, POLYLINES_FILE, (lines) => (lines.polylines[`${BUSINESS}|${ID}`] = '')),
      new RegExp(`polylines\\.json: polyline "${BUSINESS}\\|home-c \\(entered address\\)" must be a non-empty string `),
    ],
  ];

  describe.each(broken)('%s', (_name, breakIt, message) => {
    it.each([
      ['a plain run', [] as string[]],
      ['--dry-run', ['--dry-run']],
      ['--refetch of a business', ['--refetch', BUSINESS]],
      ['--drop-entered', ['--drop-entered']],
    ])('%s exits 1 with one line that holds no ID and neither number, without a key, a call or a write', async (_flag, argv) => {
      const dir = dirWithEnteredHome();
      breakIt(dir);
      const before = snapshot(dir);

      const { code, lines, keys, calls } = await script({ dir, argv, env: {} });

      expect(code).toBe(1);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^Cannot start: Travel cache /);
      expect(lines[0]).toMatch(message);
      expect(lines[0]).toMatch(argv[0] === '--drop-entered' ? / Nothing was dropped or written\.$/ : / No Google call was made\.$/);
      noAddress(lines);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(dir)).toEqual(before);
    });
  });

  it('with a key set: the same line, still no client and no call', async () => {
    const dir = dirWithEnteredHome();
    edit(dir, MATRIX_FILE, (matrix) => (matrix.places[ID].lat = null));
    const before = snapshot(dir);

    for (const argv of [[], ['--dry-run']]) {
      const { code, lines, keys, calls } = await script({ dir, argv });

      expect(code).toBe(1);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`place "${HIDDEN}" needs a numeric lat and lng`);
      noAddress(lines);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
    }
    expect(snapshot(dir)).toEqual(before);
  });
});

describe('runFetchScript --refetch with the ID of an entered home', () => {
  it('an ID the cache does not hold: exits 1 and names it only as an entered address', async () => {
    const dir = tempDirWithCacheOf(seed);
    const before = snapshot(dir);

    const { code, lines, calls } = await script({ dir, argv: ['--refetch', ID] });

    expect(code).toBe(1);
    expect(lines[0]).toBe(`Not in the travel cache: ${HIDDEN} Nothing was dropped for it.`);
    noAddress(lines);
    expect(totalCalls(calls)).toBe(0);
    expect(snapshot(dir)).toEqual(before);
  });

  it('with --dry-run on a cache that holds it: the drop it would make is reported without the ID', async () => {
    const dir = dirWithEnteredHome();
    const before = snapshot(dir);

    const { code, lines, calls } = await script({ dir, argv: ['--refetch', ID, '--dry-run'], env: {} });

    expect(code).toBe(0);
    expect(lines).toContain(`  Dropped ${HIDDEN} 1 place, ${2 * BUSINESS_IDS.length} pairs, 2 route lines. Run fetch:routes to refill.`);
    noAddress(lines);
    expect(totalCalls(calls)).toBe(0);
    expect(snapshot(dir)).toEqual(before);
  });

  it('a run: drops it, saves, finishes with exit 0, and no line of the whole run holds the ID', async () => {
    const dir = dirWithEnteredHome();

    const { code, lines } = await script({ dir, argv: ['--refetch', ID] });

    expect(code).toBe(0);
    expect(lines[0]).toBe(`Dropped ${HIDDEN} 1 place, ${2 * BUSINESS_IDS.length} pairs, 2 route lines. Run fetch:routes to refill.`);
    noAddress(lines);
    expect(snapshot(dir)).toEqual(snapshot(seed));
  });
});

describe('runFetchScript: a line of a run that quotes an entered home', () => {
  it('a failure reason in the fetch summary: the ID is hidden, and so is a key in the same message', async () => {
    const dir = tempFixturesDir();
    const google = cityClient({
      geocode: (businessId) => {
        if (businessId === BUSINESS) throw new Error(`no answer for ${ID} (https://maps.example/geocode?key=${KEY})`);
        return undefined;
      },
    });

    const { code, lines } = await script({ dir, google });

    expect(code).toBe(1);
    const quoted = lines.filter((line) => line.includes(HIDDEN));
    expect(quoted.length).toBeGreaterThan(0);
    for (const line of quoted) expect(line).toContain('key=[redacted]');
    noAddress(lines);
  });

  it('a run and a dry run on a cache that holds it print the count line and never the ID', async () => {
    const dir = dirWithEnteredHome();

    const dry = await script({ dir, argv: ['--dry-run'], env: {} });
    const run = await script({ dir });

    expect(dry.code).toBe(0);
    expect(run.code).toBe(0);
    for (const { lines } of [dry, run]) {
      expect(lines.filter((line) => line.startsWith('Entered homes: 1 '))).toHaveLength(1);
      noAddress(lines);
    }
  });
});

describe('runFetchScript: output without an entered home is as it was', () => {
  it('--help and a usage error print the usage text as written, with the bare prefix home-c-', async () => {
    const dir = tempDirWithCacheOf(seed);

    const help = await script({ dir, argv: ['--help'] });
    const wrong = await script({ dir, argv: ['--drop-entered', '--check-key'] });

    expect(help.code).toBe(0);
    expect(help.lines).toEqual([...USAGE]);
    expect(help.lines.join('\n')).toContain('place IDs that start with home-c-) from');
    expect(wrong.code).toBe(2);
    expect(wrong.lines.slice(2)).toEqual([...USAGE]);
  });

  it('a dry run and a run on a complete cache print no line that the hiding changed', async () => {
    const dir = tempDirWithCacheOf(seed);

    const dry = await script({ dir, argv: ['--dry-run'], env: {} });
    const run = await script({ dir });

    expect(dry.code).toBe(0);
    expect(run.code).toBe(0);
    for (const line of [...dry.lines, ...run.lines]) expect(line).not.toContain('home-c');
  });
});

describe('hideEntered: what the print wrapper does to a line', () => {
  it('leaves a line without the prefix, and every line of the usage text, as it is', () => {
    for (const line of ['', 'Plan check', '  - home-001: moved 12 m', 'home-c is not the prefix', ...USAGE]) expect(hideEntered(line)).toBe(line);
  });

  it.each([
    [`place "${ID}" needs a numeric lat and lng`, `place "${HIDDEN}" needs a numeric lat and lng`],
    [`pair "${ID}|${BUSINESS}"`, `pair "${HIDDEN}|${BUSINESS}"`],
    [`pair "${BUSINESS}|${ID}"`, `pair "${BUSINESS}|${HIDDEN}"`],
    [`${ID}|${ENTERED_HOMES[1].id}`, `${HIDDEN}|${HIDDEN}`],
    [`Dropped ${ID}, ${ENTERED_HOMES[1].id}: 2 places`, `Dropped ${HIDDEN}, ${HIDDEN} 2 places`],
    [`npm run fetch:routes -- --refetch ${ID}`, `npm run fetch:routes -- --refetch ${HIDDEN}`],
    [ID, HIDDEN],
    [`IDs that start with home-c-) like ${ID}`, `IDs that start with home-c-) like ${HIDDEN}`],
    ['home-c-x', HIDDEN],
  ])('%j -> %j', (line, hidden) => {
    expect(hideEntered(line)).toBe(hidden);
    expect(hideEntered(hidden)).toBe(hidden);
  });

  it('hides exactly what hideEnteredIds hides when every prefix starts an ID', () => {
    for (const line of [`place "${ID}"`, `${ID}|${BUSINESS}`, `a ${ID}, b ${ENTERED_HOMES[1].id}; c`, `(${ID})`, `'${ID}'`]) {
      expect(hideEntered(line)).toBe(hideEnteredIds(line));
    }
  });

  it('a prefix right before an ID stays, and the ID after it is hidden all the same', () => {
    expect(hideEntered(`home-c-${ID}`)).toBe(`home-c-${HIDDEN}`);
    expect(hideEntered(`home-c- ${ID}`)).toBe(`home-c- ${HIDDEN}`);
  });

  it('keeps the prefix only where nothing of an ID follows it', () => {
    for (const end of ['', ' ', ')', '"', "'", '`', ',', ';', '|']) {
      expect(hideEntered(`home-c-${end}`)).toBe(`home-c-${end}`);
      expect(hideEntered(`home-c-4${end}`)).toBe(`${HIDDEN}${end}`);
    }
  });
});
