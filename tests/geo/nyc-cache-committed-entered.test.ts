// Guard on the committed Google cache, part 3: no home typed into the commute editor (issue #515).
// A commute saved with a typed address creates the place `home-c-<lat>_<lng>`, and the running server writes it
// with its pairs and route lines into fixtures/nyc/matrix.json and polylines.json, which are committed files. So a
// human who tries the address search with a real address and then commits the cache puts a real home's
// coordinates into git. SPEC "MVP II" rule 6: never a real person's address.
// A red run here gives the number of entered homes and the fix, and never an ID, because the ID is the coordinates.
// No network, no key, nothing written.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { MATRIX_FILE, POLYLINES_FILE } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { ENTERED_HOME_PREFIX, dropEnteredHomes, enteredHomes } from '../../server/geo/cacheEdit';
import { DROP_ENTERED_COMMAND, parseArgs } from '../../server/geo/fetchScript';
import { ENTERED_HOME_IDS, ENTERED_ID_PATTERN, withEnteredHomes } from './cache-edit-helpers';
import { COMMITTED_CACHE_TEST_TIMEOUT_MS, fixturesDir, loadCommittedCache, loadExpected, polylinesFileExists } from './nyc-cache-committed-helper';

vi.setConfig({ testTimeout: COMMITTED_CACHE_TEST_TIMEOUT_MS, hookTimeout: COMMITTED_CACHE_TEST_TIMEOUT_MS });

/**
 * What a red test prints: how many, and the two ways out. Counts and commands only. Empty string for zero.
 * The assertions below compare numbers, never the IDs, so vitest has no ID to print in a diff either.
 */
function enteredFailureMessage(entered: number, where: string): string {
  if (entered === 0) return '';
  const one = entered === 1;
  return [
    `${where} holds ${entered} entered home${one ? '' : 's'}: ${one ? 'a place' : 'places'} created from an address typed into the commute editor.`,
    `${one ? 'Its ID holds its' : 'Their IDs hold their'} coordinates, so ${one ? 'it' : 'they'} must not be committed (SPEC "MVP II" rule 6: never a real person's address).`,
    'Remove them, with all their pairs and route lines (free: no key, no Google call):',
    `  ${DROP_ENTERED_COMMAND}`,
    'or throw away every uncommitted change to the cache:',
    '  git checkout fixtures/nyc',
    // The empty last line keeps what vitest appends (": expected 2 to be +0") off the command line.
    '',
  ].join('\n');
}

/** How often `home-c-` is written in a committed file, whatever the field: a count, so nothing of the text is printed. */
function prefixCount(name: string): number {
  const text = fs.readFileSync(path.join(fixturesDir, name), 'utf8');
  return text.split(ENTERED_HOME_PREFIX).length - 1;
}

let files: TravelFiles;

beforeAll(() => {
  files = loadCommittedCache();
});

describe('committed NYC travel cache: no home entered in the commute editor', () => {
  it('has no place whose ID starts with home-c-', () => {
    const entered = Object.keys(files.matrix.places).filter((id) => id.startsWith(ENTERED_HOME_PREFIX)).length;
    expect(entered, enteredFailureMessage(entered, `fixtures/nyc/${MATRIX_FILE} "places"`)).toBe(0);
  });

  it('has no pair and no route line that names such a place, at either end', () => {
    const entered = enteredHomes(files).length;
    expect(entered, enteredFailureMessage(entered, `The committed NYC travel cache (fixtures/nyc/${MATRIX_FILE} and ${POLYLINES_FILE})`)).toBe(0);
  });

  it('does not have home-c- anywhere in the text of matrix.json or polylines.json', () => {
    // The reader keeps only the fields it knows, so this also covers a field a later format adds.
    for (const name of [MATRIX_FILE, ...(polylinesFileExists() ? [POLYLINES_FILE] : [])]) {
      const written = prefixCount(name);
      expect(written, enteredFailureMessage(written, `The text of fixtures/nyc/${name}`)).toBe(0);
    }
  });

  it('would lose nothing to --drop-entered: the drop leaves the committed cache as it is', () => {
    const edit = dropEnteredHomes(files);
    expect(edit.removed).toEqual({ places: 0, pairs: 0, polylines: 0 });
    expect(edit.files).toEqual(files);
  });
});

// The guard has to bite. Each case adds entered homes to a copy of the committed cache in memory, the way a live
// commute save does, and reads the message a red CI run would show. No file is written.
describe('committed NYC travel cache: the entered-home check catches a copy that has them', () => {
  const businessIds = () => loadExpected().businessIds;

  it('two entered homes with their pairs and commute lines are counted as 2', () => {
    const broken = withEnteredHomes(files, businessIds());
    expect(Object.keys(broken.matrix.places).filter((id) => id.startsWith(ENTERED_HOME_PREFIX))).toHaveLength(2);
    expect(enteredHomes(broken)).toHaveLength(2);
    // And the fix the message names really is the fix.
    expect(dropEnteredHomes(broken).files).toEqual(files);
  });

  it('a leftover pair or route line is counted too, when its places entry is already gone', () => {
    const [business] = businessIds();
    const pairOnly = structuredClone(files);
    pairOnly.matrix.pairs[pairKey(business, ENTERED_HOME_IDS[0])] = { durationS: 700, distanceM: 5000 };
    const lineOnly = structuredClone(files);
    lineOnly.polylines.polylines[pairKey(ENTERED_HOME_IDS[1], business)] = 'line:leftover';

    expect(enteredHomes(pairOnly)).toHaveLength(1);
    expect(enteredHomes(lineOnly)).toHaveLength(1);
    expect(Object.keys(pairOnly.matrix.places).some((id) => id.startsWith(ENTERED_HOME_PREFIX))).toBe(false);
  });

  it('the message gives the number and both fixes, and never an ID or a coordinate', () => {
    const message = enteredFailureMessage(2, 'The committed NYC travel cache');
    expect(message).toContain('holds 2 entered homes');
    expect(message.split('\n')).toContain('  npm run fetch:routes -- --drop-entered');
    expect(message.split('\n')).toContain('  git checkout fixtures/nyc');
    expect(message).not.toMatch(ENTERED_ID_PATTERN);
    for (const id of ENTERED_HOME_IDS) expect(message).not.toContain(id);

    expect(enteredFailureMessage(1, `fixtures/nyc/${MATRIX_FILE}`)).toContain('holds 1 entered home: a place created');
    expect(enteredFailureMessage(0, 'anything')).toBe('');
  });

  it('the command in the message is one the fetch script accepts', () => {
    const flags = DROP_ENTERED_COMMAND.split(' -- ')[1].split(' ');
    expect(DROP_ENTERED_COMMAND.startsWith('npm run fetch:routes -- ')).toBe(true);
    expect(parseArgs(flags)).toMatchObject({ ok: true, options: { dropEntered: true, dryRun: false } });
  });

  it('none of the cases above changed the committed cache in memory', () => {
    expect(enteredHomes(files)).toHaveLength(0);
  });
});
