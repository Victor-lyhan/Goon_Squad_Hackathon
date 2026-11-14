// Travel cache files (server/geo/cache.ts) in a temp directory: no network, no key, nothing under fixtures/ is touched.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MATRIX_FILE,
  POLYLINES_FILE,
  TravelCacheError,
  emptyTravelFiles,
  mergeTravelFiles,
  minutesFromSeconds,
  readTravelFiles,
  serializeTravelFiles,
  writeTravelFiles,
} from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';

let root: string;
let dir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-travel-cache-'));
  dir = path.join(root, 'nyc');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const matrixPath = () => path.join(dir, MATRIX_FILE);
const polylinesPath = () => path.join(dir, POLYLINES_FILE);

function sample(): TravelFiles {
  return {
    matrix: {
      schemaVersion: 1,
      places: {
        'home-007': { lat: 40.7644, lng: -73.9235 },
        'biz-dumbo-cafe': { lat: 40.7033, lng: -73.9881, formattedAddress: '1 Water St, Brooklyn, NY 11201, USA' },
      },
      pairs: {
        'home-007|biz-dumbo-cafe': { durationS: 1501, distanceM: 12040 },
        'biz-dumbo-cafe|home-007': { durationS: 1622, distanceM: 12911 },
      },
    },
    polylines: { schemaVersion: 1, polylines: { 'home-007|biz-dumbo-cafe': '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } },
  };
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw');
}

describe('minutesFromSeconds', () => {
  it('rounds seconds up to whole minutes', () => {
    expect(minutesFromSeconds(0)).toBe(0);
    expect(minutesFromSeconds(1)).toBe(1);
    expect(minutesFromSeconds(59)).toBe(1);
    expect(minutesFromSeconds(60)).toBe(1);
    expect(minutesFromSeconds(61)).toBe(2);
    expect(minutesFromSeconds(120)).toBe(2);
    expect(minutesFromSeconds(734.5)).toBe(13);
  });

  it('refuses a value that is not a duration instead of guessing', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '90' as unknown as number, undefined as unknown as number]) {
      expect(() => minutesFromSeconds(bad)).toThrow(RangeError);
    }
  });
});

describe('emptyTravelFiles and mergeTravelFiles', () => {
  it('gives a fresh, empty, valid pair of files each time', () => {
    const a = emptyTravelFiles();
    expect(a).toEqual({ matrix: { schemaVersion: 1, places: {}, pairs: {} }, polylines: { schemaVersion: 1, polylines: {} } });
    a.matrix.pairs['x|y'] = { durationS: 1, distanceM: 1 };
    expect(emptyTravelFiles().matrix.pairs).toEqual({});
  });

  it('merges places, pairs and polylines; the second argument wins; inputs are not changed', () => {
    const a = sample();
    const b: TravelFiles = {
      matrix: {
        schemaVersion: 1,
        places: { 'home-008': { lat: 40.68, lng: -73.97 }, 'home-007': { lat: 1, lng: 2 } },
        pairs: { 'home-008|biz-dumbo-cafe': { durationS: 600, distanceM: 3000 }, 'home-007|biz-dumbo-cafe': { durationS: 9, distanceM: 9 } },
      },
      polylines: { schemaVersion: 1, polylines: { 'home-008|biz-dumbo-cafe': 'abc' } },
    };
    const aBefore = structuredClone(a);
    const bBefore = structuredClone(b);

    const merged = mergeTravelFiles(a, b);
    expect(merged.matrix.places).toEqual({
      'home-007': { lat: 1, lng: 2 },
      'home-008': { lat: 40.68, lng: -73.97 },
      'biz-dumbo-cafe': a.matrix.places['biz-dumbo-cafe'],
    });
    expect(merged.matrix.pairs).toEqual({
      'home-007|biz-dumbo-cafe': { durationS: 9, distanceM: 9 },
      'biz-dumbo-cafe|home-007': { durationS: 1622, distanceM: 12911 },
      'home-008|biz-dumbo-cafe': { durationS: 600, distanceM: 3000 },
    });
    expect(merged.polylines.polylines).toEqual({ 'home-007|biz-dumbo-cafe': '_p~iF~ps|U_ulLnnqC_mqNvxq`@', 'home-008|biz-dumbo-cafe': 'abc' });

    // Pure: the result shares no entry objects with the inputs.
    merged.matrix.pairs['biz-dumbo-cafe|home-007'].durationS = 0;
    merged.matrix.places['home-008'].lat = 0;
    expect(a).toEqual(aBefore);
    expect(b).toEqual(bBefore);
  });
});

describe('readTravelFiles', () => {
  it('returns null when the directory does not exist', () => {
    expect(readTravelFiles(dir)).toBeNull();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('returns null when the directory has no matrix.json, even with a polylines.json', () => {
    fs.mkdirSync(dir);
    expect(readTravelFiles(dir)).toBeNull();
    fs.writeFileSync(polylinesPath(), JSON.stringify(sample().polylines));
    expect(readTravelFiles(dir)).toBeNull();
  });

  it('treats a missing polylines.json as an empty polylines file', () => {
    fs.mkdirSync(dir);
    fs.writeFileSync(matrixPath(), JSON.stringify(sample().matrix));
    expect(readTravelFiles(dir)).toEqual({ matrix: sample().matrix, polylines: { schemaVersion: 1, polylines: {} } });
  });

  it('names the file and both versions when schemaVersion is wrong', () => {
    fs.mkdirSync(dir);
    fs.writeFileSync(matrixPath(), JSON.stringify({ ...sample().matrix, schemaVersion: 2 }));
    const err = thrownBy(() => readTravelFiles(dir));
    expect(err).toBeInstanceOf(TravelCacheError);
    expect((err as TravelCacheError).file).toBe(matrixPath());
    expect((err as Error).message).toContain('matrix.json');
    expect((err as Error).message).toContain('schemaVersion is 2, expected 1');

    fs.writeFileSync(matrixPath(), JSON.stringify(sample().matrix));
    fs.writeFileSync(polylinesPath(), JSON.stringify({ polylines: {} }));
    const second = thrownBy(() => readTravelFiles(dir));
    expect(second).toBeInstanceOf(TravelCacheError);
    expect((second as Error).message).toContain('polylines.json');
    expect((second as Error).message).toContain('schemaVersion is missing, expected 1');
  });

  it('rejects a file that is not JSON or has the wrong shape, with the reason', () => {
    fs.mkdirSync(dir);
    const cases: Array<[string, string]> = [
      ['{"schemaVersion": 1, "places": {', 'is not valid JSON'],
      ['[]', 'expected a JSON object'],
      [JSON.stringify({ schemaVersion: 1, pairs: {} }), '`places` must be an object'],
      [JSON.stringify({ schemaVersion: 1, places: {}, pairs: [] }), '`pairs` must be an object'],
      [JSON.stringify({ schemaVersion: 1, places: { 'biz-a': { lat: '40.7', lng: -73.9 } }, pairs: {} }), 'place "biz-a" needs a numeric lat and lng'],
      [JSON.stringify({ schemaVersion: 1, places: { 'biz-a': { lat: 140.7, lng: -73.9 } }, pairs: {} }), 'place "biz-a" needs a numeric lat and lng'],
      [JSON.stringify({ schemaVersion: 1, places: {}, pairs: { 'a|b': { durationS: 60 } } }), 'pair "a|b" needs a non-negative durationS and distanceM'],
      [JSON.stringify({ schemaVersion: 1, places: {}, pairs: { 'a|b': { durationS: null, distanceM: 5 } } }), 'pair "a|b" needs a non-negative durationS and distanceM'],
      [JSON.stringify({ schemaVersion: 1, places: {}, pairs: { 'a|b': { durationS: -3, distanceM: 5 } } }), 'pair "a|b" needs a non-negative durationS and distanceM'],
      [JSON.stringify({ schemaVersion: 1, places: {}, pairs: { ab: { durationS: 3, distanceM: 5 } } }), 'pair key "ab" is not "<from>|<to>"'],
    ];
    for (const [text, reason] of cases) {
      fs.writeFileSync(matrixPath(), text);
      const err = thrownBy(() => readTravelFiles(dir));
      expect(err).toBeInstanceOf(TravelCacheError);
      expect((err as Error).message).toContain(reason);
      expect((err as Error).message).toContain('matrix.json');
    }

    fs.writeFileSync(matrixPath(), JSON.stringify(sample().matrix));
    fs.writeFileSync(polylinesPath(), JSON.stringify({ schemaVersion: 1, polylines: { 'a|b': 7 } }));
    expect((thrownBy(() => readTravelFiles(dir)) as Error).message).toContain('polyline "a|b" must be a non-empty string');
  });

  it('drops fields the format does not have', () => {
    fs.mkdirSync(dir);
    const matrix = { ...sample().matrix, generatedAt: 'today', pairs: { 'a|b': { durationS: 61, distanceM: 400, note: 'x' } } };
    fs.writeFileSync(matrixPath(), JSON.stringify(matrix));
    const files = readTravelFiles(dir)!;
    expect(files.matrix.pairs).toEqual({ 'a|b': { durationS: 61, distanceM: 400 } });
    expect(Object.keys(files.matrix)).toEqual(['schemaVersion', 'places', 'pairs']);
  });
});

describe('writeTravelFiles', () => {
  it('round-trips: write, then read, gives the same data (and creates the directory)', () => {
    writeTravelFiles(dir, sample());
    expect(readTravelFiles(dir)).toEqual(sample());
    expect(fs.readdirSync(dir).sort()).toEqual([MATRIX_FILE, POLYLINES_FILE]);
  });

  it('writes sorted keys, 2-space JSON and a trailing newline', () => {
    writeTravelFiles(dir, sample());
    expect(fs.readFileSync(matrixPath(), 'utf8')).toBe(
      [
        '{',
        '  "schemaVersion": 1,',
        '  "places": {',
        '    "biz-dumbo-cafe": {',
        '      "lat": 40.7033,',
        '      "lng": -73.9881,',
        '      "formattedAddress": "1 Water St, Brooklyn, NY 11201, USA"',
        '    },',
        '    "home-007": {',
        '      "lat": 40.7644,',
        '      "lng": -73.9235',
        '    }',
        '  },',
        '  "pairs": {',
        '    "biz-dumbo-cafe|home-007": {',
        '      "durationS": 1622,',
        '      "distanceM": 12911',
        '    },',
        '    "home-007|biz-dumbo-cafe": {',
        '      "durationS": 1501,',
        '      "distanceM": 12040',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(fs.readFileSync(polylinesPath(), 'utf8')).toBe(
      ['{', '  "schemaVersion": 1,', '  "polylines": {', '    "home-007|biz-dumbo-cafe": "_p~iF~ps|U_ulLnnqC_mqNvxq`@"', '  }', '}', ''].join('\n'),
    );
  });

  it('writes identical bytes for the same data, whatever order the keys were added in', () => {
    writeTravelFiles(dir, sample());
    const first = { matrix: fs.readFileSync(matrixPath()), polylines: fs.readFileSync(polylinesPath()) };

    writeTravelFiles(dir, sample());
    expect(fs.readFileSync(matrixPath()).equals(first.matrix)).toBe(true);
    expect(fs.readFileSync(polylinesPath()).equals(first.polylines)).toBe(true);

    // Same data, built in the opposite key order, into a second directory.
    const reversed = emptyTravelFiles();
    const original = sample();
    for (const id of Object.keys(original.matrix.places).reverse()) {
      const { formattedAddress, lng, lat } = original.matrix.places[id];
      reversed.matrix.places[id] = formattedAddress === undefined ? { lng, lat } : { formattedAddress, lng, lat };
    }
    for (const key of Object.keys(original.matrix.pairs).reverse()) {
      const { distanceM, durationS } = original.matrix.pairs[key];
      reversed.matrix.pairs[key] = { distanceM, durationS };
    }
    Object.assign(reversed.polylines.polylines, original.polylines.polylines);
    const other = path.join(root, 'other');
    writeTravelFiles(other, reversed);
    expect(fs.readFileSync(path.join(other, MATRIX_FILE)).equals(first.matrix)).toBe(true);
    expect(fs.readFileSync(path.join(other, POLYLINES_FILE)).equals(first.polylines)).toBe(true);
  });

  it('does not rewrite a file whose bytes would not change', () => {
    writeTravelFiles(dir, sample());
    const old = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(matrixPath(), old, old);
    fs.utimesSync(polylinesPath(), old, old);

    const next = sample();
    next.polylines.polylines['biz-dumbo-cafe|home-007'] = 'abc';
    writeTravelFiles(dir, next);
    expect(fs.statSync(matrixPath()).mtimeMs).toBe(old.getTime()); // untouched
    expect(fs.statSync(polylinesPath()).mtimeMs).toBeGreaterThan(old.getTime());
    expect(readTravelFiles(dir)).toEqual(next);
  });

  it('refuses bad data before touching the disk: matrix.json keeps its old bytes', () => {
    writeTravelFiles(dir, sample());
    const before = fs.readFileSync(matrixPath());

    const bad = sample();
    bad.matrix.pairs['home-007|biz-dumbo-cafe'].durationS = Number.NaN; // JSON would turn this into null
    const err = thrownBy(() => writeTravelFiles(dir, bad));
    expect(err).toBeInstanceOf(TravelCacheError);
    expect((err as Error).message).toContain('pair "home-007|biz-dumbo-cafe" needs a non-negative durationS and distanceM');

    const wrongVersion = { ...sample(), polylines: { schemaVersion: 2, polylines: {} } } as unknown as TravelFiles;
    expect(() => writeTravelFiles(dir, wrongVersion)).toThrow(/schemaVersion is 2, expected 1/);

    expect(fs.readFileSync(matrixPath()).equals(before)).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual([MATRIX_FILE, POLYLINES_FILE]);

    // Nothing is created for bad data in a new directory either.
    const fresh = path.join(root, 'fresh');
    expect(() => writeTravelFiles(fresh, bad)).toThrow(TravelCacheError);
    expect(fs.existsSync(fresh)).toBe(false);
  });

  it('a write that fails half way never leaves a half-written matrix.json or a temp file', () => {
    writeTravelFiles(dir, sample());
    const before = fs.readFileSync(matrixPath());

    // Make the polylines rename fail: its target is now a non-empty directory.
    fs.rmSync(polylinesPath());
    fs.mkdirSync(polylinesPath());
    fs.writeFileSync(path.join(polylinesPath(), 'keep'), 'x');

    const next = sample();
    next.matrix.pairs['home-007|biz-dumbo-cafe'] = { durationS: 1, distanceM: 1 };
    next.polylines.polylines['biz-dumbo-cafe|home-007'] = 'abc';
    const err = thrownBy(() => writeTravelFiles(dir, next));
    expect(err).toBeInstanceOf(TravelCacheError);
    expect((err as Error).message).toContain('could not be written');

    expect(fs.readFileSync(matrixPath()).equals(before)).toBe(true); // the old, complete file
    expect(JSON.parse(fs.readFileSync(matrixPath(), 'utf8'))).toEqual(sample().matrix);
    expect(fs.readdirSync(dir).sort()).toEqual([MATRIX_FILE, POLYLINES_FILE]); // no *.tmp left behind
  });

  it('fails clearly, and writes nothing, when the directory path is a file', () => {
    fs.writeFileSync(dir, 'not a directory');
    const err = thrownBy(() => writeTravelFiles(dir, sample()));
    expect(err).toBeInstanceOf(TravelCacheError);
    expect(fs.readFileSync(dir, 'utf8')).toBe('not a directory');
    expect(readTravelFiles(dir)).toBeNull();
  });

  it('serializeTravelFiles gives exactly the bytes that are written', () => {
    writeTravelFiles(dir, sample());
    const text = serializeTravelFiles(sample());
    expect(fs.readFileSync(matrixPath(), 'utf8')).toBe(text.matrix);
    expect(fs.readFileSync(polylinesPath(), 'utf8')).toBe(text.polylines);
  });
});
