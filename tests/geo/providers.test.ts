// CachedProvider (server/geo/providers.ts) and the test-only FakeProvider (server/geo/fakeProvider.ts). No network, no key.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import polyline from '@mapbox/polyline';
import { TravelDataMissingError, pairKey } from '../../shared/v2/types';
import type { TravelProvider } from '../../shared/v2/types';
import { emptyTravelFiles, minutesFromSeconds } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { createCachedProvider } from '../../server/geo/providers';
import { FAKE_DEFAULT_SPEED_KMH, createFakeProvider, fakeProviderFromCoords, straightLineM } from '../../server/geo/fakeProvider';

function files(): TravelFiles {
  return {
    matrix: {
      schemaVersion: 1,
      places: {
        'biz-a': { lat: 40.7484, lng: -73.9857, formattedAddress: '350 5th Ave, New York, NY 10118, USA' },
        'biz-b': { lat: 40.7033, lng: -73.9881 },
        'home-001': { lat: 40.7644, lng: -73.9235 },
      },
      pairs: {
        'biz-a|biz-b': { durationS: 61, distanceM: 900 },
        'biz-b|biz-a': { durationS: 60, distanceM: 1100 },
        'biz-a|home-001': { durationS: 0, distanceM: 0 },
        'home-001|biz-b': { durationS: 1499.2, distanceM: 12040 },
      },
    },
    polylines: { schemaVersion: 1, polylines: { 'biz-a|biz-b': '_p~iF~ps|U_ulLnnqC' } },
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

describe('createCachedProvider', () => {
  it('rounds Google seconds up to whole minutes, per pair', () => {
    const travel = createCachedProvider(files());
    expect(travel.durationMin('biz-a', 'biz-b')).toBe(2); // 61 s
    expect(travel.durationMin('biz-b', 'biz-a')).toBe(1); // 60 s
    expect(travel.durationMin('home-001', 'biz-b')).toBe(25); // 1499.2 s
  });

  it('keeps 0 seconds between two different places at 0', () => {
    const travel = createCachedProvider(files());
    expect(travel.durationMin('biz-a', 'home-001')).toBe(0);
    expect(travel.distanceM('biz-a', 'home-001')).toBe(0);
  });

  it('returns raw meters, and treats A->B and B->A as separate pairs', () => {
    const travel = createCachedProvider(files());
    expect(travel.distanceM('biz-a', 'biz-b')).toBe(900);
    expect(travel.distanceM('biz-b', 'biz-a')).toBe(1100);
    expect(travel.has('biz-a', 'home-001')).toBe(true);
    expect(travel.has('home-001', 'biz-a')).toBe(false);
    expect(() => travel.durationMin('home-001', 'biz-a')).toThrow(TravelDataMissingError);
    expect(() => travel.distanceM('home-001', 'biz-a')).toThrow(TravelDataMissingError);
  });

  it('answers 0 for the same place without needing data, even an unknown place', () => {
    const travel = createCachedProvider(emptyTravelFiles());
    expect(travel.durationMin('biz-a', 'biz-a')).toBe(0);
    expect(travel.distanceM('nowhere', 'nowhere')).toBe(0);
    expect(travel.has('nowhere', 'nowhere')).toBe(true);
    expect(travel.polyline('biz-a', 'biz-a')).toBeNull();
  });

  it('throws TravelDataMissingError with from and to for an unknown pair, never a number', () => {
    const travel = createCachedProvider(files());
    for (const lookup of [() => travel.durationMin('biz-b', 'home-009'), () => travel.distanceM('biz-b', 'home-009')]) {
      const err = thrownBy(lookup);
      expect(err).toBeInstanceOf(TravelDataMissingError);
      expect(err).toMatchObject({ name: 'TravelDataMissingError', from: 'biz-b', to: 'home-009', what: 'matrix' });
      expect((err as Error).message).toContain('biz-b|home-009');
    }
    // Names that exist on every object are still just unknown places.
    expect(() => travel.durationMin('constructor', 'toString')).toThrow(TravelDataMissingError);
    expect(travel.has('__proto__', 'constructor')).toBe(false);
  });

  it('returns the cached polyline, or null when there is none (never throws)', () => {
    const travel = createCachedProvider(files());
    expect(travel.polyline('biz-a', 'biz-b')).toBe('_p~iF~ps|U_ulLnnqC');
    expect(travel.polyline('biz-b', 'biz-a')).toBeNull();
    expect(travel.polyline('nowhere', 'biz-a')).toBeNull();
    expect(travel.polyline('constructor', 'toString')).toBeNull();
  });

  it('returns the coordinates of a cached place, or null', () => {
    const travel = createCachedProvider(files());
    expect(travel.place('biz-a')).toEqual({ lat: 40.7484, lng: -73.9857 }); // no formattedAddress
    expect(travel.place('home-001')).toEqual({ lat: 40.7644, lng: -73.9235 });
    expect(travel.place('home-999')).toBeNull();
    expect(travel.place('constructor')).toBeNull();
  });

  it('reads the object it was given: data added, or a file swapped, later is visible without a rebuild', () => {
    const cache = files();
    const travel = createCachedProvider(cache);
    expect(travel.has('home-001', 'biz-a')).toBe(false);

    cache.matrix.pairs[pairKey('home-001', 'biz-a')] = { durationS: 601, distanceM: 4200 };
    cache.matrix.places['home-002'] = { lat: 40.68, lng: -73.97 };
    cache.polylines.polylines[pairKey('home-001', 'biz-a')] = 'abc';
    expect(travel.has('home-001', 'biz-a')).toBe(true);
    expect(travel.durationMin('home-001', 'biz-a')).toBe(11);
    expect(travel.distanceM('home-001', 'biz-a')).toBe(4200);
    expect(travel.polyline('home-001', 'biz-a')).toBe('abc');
    expect(travel.place('home-002')).toEqual({ lat: 40.68, lng: -73.97 });

    cache.matrix = { schemaVersion: 1, places: {}, pairs: { 'x|y': { durationS: 1, distanceM: 2 } } };
    expect(travel.durationMin('x', 'y')).toBe(1);
    expect(travel.has('home-001', 'biz-a')).toBe(false);
  });

  it('is a TravelProvider', () => {
    const travel: TravelProvider = createCachedProvider(files());
    expect(travel.durationMin('biz-a', 'biz-b')).toBe(minutesFromSeconds(61));
  });
});

describe('createFakeProvider', () => {
  const table = [
    { from: 'biz-a', to: 'biz-b', durationMin: 12, distanceM: 5000 },
    { from: 'biz-b', to: 'home-1', durationMin: 7, distanceM: 2500 },
    { from: 'home-1', to: 'biz-b', durationMin: 9, distanceM: 2600 },
  ];

  it('answers exactly the table, in minutes, and throws for anything else', () => {
    const travel = createFakeProvider({ pairs: table });
    expect(travel.durationMin('biz-a', 'biz-b')).toBe(12);
    expect(travel.distanceM('biz-a', 'biz-b')).toBe(5000);
    expect(travel.durationMin('biz-b', 'home-1')).toBe(7);
    expect(travel.durationMin('home-1', 'biz-b')).toBe(9);
    expect(travel.durationMin('biz-a', 'biz-a')).toBe(0);
    expect(travel.polyline('biz-a', 'biz-b')).toBeNull();

    const err = thrownBy(() => travel.durationMin('biz-b', 'biz-a')); // not symmetric by default
    expect(err).toBeInstanceOf(TravelDataMissingError);
    expect(err).toMatchObject({ from: 'biz-b', to: 'biz-a' });
    expect(() => travel.distanceM('biz-a', 'home-1')).toThrow(TravelDataMissingError);
  });

  it('with symmetric: true mirrors each pair and polyline unless the other direction is listed', () => {
    const line = polyline.encode([
      [40.7, -73.9],
      [40.71, -73.95],
      [40.75, -73.98],
    ]);
    const travel = createFakeProvider({ pairs: table, polylines: [{ from: 'biz-a', to: 'biz-b', encoded: line }], symmetric: true });
    expect(travel.durationMin('biz-b', 'biz-a')).toBe(12);
    expect(travel.distanceM('biz-b', 'biz-a')).toBe(5000);
    expect(travel.durationMin('biz-b', 'home-1')).toBe(7); // listed both ways: each keeps its own numbers
    expect(travel.durationMin('home-1', 'biz-b')).toBe(9);
    expect(travel.polyline('biz-a', 'biz-b')).toBe(line);
    expect(polyline.decode(travel.polyline('biz-b', 'biz-a')!)).toEqual([
      [40.75, -73.98],
      [40.71, -73.95],
      [40.7, -73.9],
    ]);
    expect(() => travel.durationMin('biz-a', 'home-1')).toThrow(TravelDataMissingError);
  });

  it('exposes its cache files, so a test can add or remove a pair', () => {
    const travel = createFakeProvider({ pairs: table });
    travel.files.matrix.pairs[pairKey('biz-a', 'home-1')] = { durationS: 121, distanceM: 10 };
    expect(travel.durationMin('biz-a', 'home-1')).toBe(3);
    delete travel.files.matrix.pairs[pairKey('biz-a', 'biz-b')];
    expect(() => travel.durationMin('biz-a', 'biz-b')).toThrow(TravelDataMissingError);
  });

  it('rejects a table with a typo instead of guessing', () => {
    expect(() => createFakeProvider({ pairs: [...table, { from: 'biz-a', to: 'biz-b', durationMin: 1, distanceM: 1 }] })).toThrow(/biz-a\|biz-b is listed twice/);
    expect(() => createFakeProvider({ pairs: [{ from: 'biz-a', to: 'biz-a', durationMin: 1, distanceM: 1 }] })).toThrow(/same place/);
    expect(() => createFakeProvider({ pairs: [{ from: 'a', to: 'b', durationMin: 2.5, distanceM: 1 }] })).toThrow(/whole number/);
    expect(() => createFakeProvider({ pairs: [{ from: 'a', to: 'b', durationMin: -1, distanceM: 1 }] })).toThrow(/whole number/);
    expect(() => createFakeProvider({ pairs: [{ from: 'a', to: 'b', durationMin: 1, distanceM: Number.NaN }] })).toThrow(/distanceM/);
    expect(() =>
      createFakeProvider({ pairs: [], polylines: [{ from: 'a', to: 'b', encoded: 'x' }, { from: 'a', to: 'b', encoded: 'y' }] }),
    ).toThrow(/polyline a\|b is listed twice/);
  });
});

describe('fakeProviderFromCoords', () => {
  const EMPIRE = { lat: 40.7484405, lng: -73.9856644 };
  const DUMBO = { lat: 40.7033, lng: -73.9881 };
  const ASTORIA = { lat: 40.7644, lng: -73.9235 };
  const places = { 'biz-empire': EMPIRE, 'biz-dumbo': DUMBO, 'home-astoria': ASTORIA };

  it('derives distance from the straight line and time from the speed, for every ordered pair', () => {
    const travel = fakeProviderFromCoords(places);
    const meters = Math.round(straightLineM(EMPIRE, DUMBO));
    expect(meters).toBeGreaterThan(4900); // about 5.0 km as the crow flies
    expect(meters).toBeLessThan(5100);
    expect(travel.distanceM('biz-empire', 'biz-dumbo')).toBe(meters);
    expect(travel.distanceM('biz-dumbo', 'biz-empire')).toBe(meters);
    const seconds = Math.round(meters / (FAKE_DEFAULT_SPEED_KMH / 3.6));
    expect(travel.durationMin('biz-empire', 'biz-dumbo')).toBe(Math.ceil(seconds / 60));
    expect(travel.durationMin('biz-empire', 'biz-dumbo')).toBe(11); // about 5 km at 30 km/h, rounded up

    expect(Object.keys(travel.files.matrix.pairs)).toHaveLength(6);
    expect(travel.durationMin('home-astoria', 'home-astoria')).toBe(0);
    expect(travel.place('home-astoria')).toEqual(ASTORIA);
    expect(() => travel.durationMin('biz-empire', 'home-elsewhere')).toThrow(TravelDataMissingError);
  });

  it('is deterministic and accepts a list of things with id, lat and lng', () => {
    const list = [
      { id: 'biz-empire', name: 'Empire', ...EMPIRE },
      { id: 'biz-dumbo', neighborhood: 'DUMBO', ...DUMBO },
      { id: 'home-astoria', neighborhood: 'Astoria', ...ASTORIA },
    ];
    const a = fakeProviderFromCoords(places);
    const b = fakeProviderFromCoords(list);
    expect(b.files).toEqual(a.files);
    expect(fakeProviderFromCoords(places).files).toEqual(a.files);
    expect(Object.keys(b.files.matrix.places['biz-empire'])).toEqual(['lat', 'lng']);
  });

  it('a higher speed gives shorter times and the same distances', () => {
    const slow = fakeProviderFromCoords(places, { speedKmh: 15 });
    const fast = fakeProviderFromCoords(places, { speedKmh: 60 });
    expect(slow.durationMin('biz-empire', 'home-astoria')).toBeGreaterThan(fast.durationMin('biz-empire', 'home-astoria'));
    expect(slow.distanceM('biz-empire', 'home-astoria')).toBe(fast.distanceM('biz-empire', 'home-astoria'));
    expect(() => fakeProviderFromCoords(places, { speedKmh: 0 })).toThrow(/speedKmh/);
  });

  it('has no polylines unless asked; then each is the straight line between the two places', () => {
    expect(fakeProviderFromCoords(places).polyline('biz-empire', 'biz-dumbo')).toBeNull();
    const travel = fakeProviderFromCoords(places, { polylines: true });
    expect(polyline.decode(travel.polyline('biz-dumbo', 'home-astoria')!)).toEqual([
      [40.7033, -73.9881],
      [40.7644, -73.9235],
    ]);
  });

  it('rejects the same place ID twice', () => {
    expect(() => fakeProviderFromCoords([{ id: 'a', lat: 1, lng: 1 }, { id: 'a', lat: 2, lng: 2 }])).toThrow(/listed twice/);
  });
});

describe('app code never invents travel times', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const FAKE_FILE = path.join('server', 'geo', 'fakeProvider.ts');
  // `from '…/fakeProvider'`, `import '…/fakeProvider'`, `import('…/fakeProvider')`, `require('…/fakeProvider')`, with or without an extension.
  const IMPORTS_FAKE = /(?:from|import|require)\s*\(?\s*['"`][^'"`\n]*fakeProvider(?:\.[cm]?[jt]sx?)?['"`]/i;
  const importsFake = (file: string) => IMPORTS_FAKE.test(fs.readFileSync(path.join(repoRoot, file), 'utf8'));

  function sourceFiles(relative: string): string[] {
    const absolute = path.join(repoRoot, relative);
    if (!fs.existsSync(absolute)) return [];
    if (fs.statSync(absolute).isFile()) return /\.(ts|tsx|mts|cts|js|mjs)$/.test(relative) ? [relative] : [];
    return fs
      .readdirSync(absolute)
      .filter((name) => name !== 'node_modules')
      .flatMap((name) => sourceFiles(path.join(relative, name)));
  }

  it('the check itself catches every way of importing the file, and ignores a mention in a comment', () => {
    for (const line of [
      "import { createFakeProvider } from '../geo/fakeProvider';",
      'import { fakeProviderFromCoords } from "../geo/fakeProvider.ts";',
      "export * from './fakeProvider.js';",
      "import '../geo/fakeProvider';",
      "const fake = await import('../geo/fakeProvider');",
      "const fake = require('../geo/fakeProvider');",
    ]) {
      expect(IMPORTS_FAKE.test(line)).toBe(true);
    }
    expect(IMPORTS_FAKE.test('// tests use the FakeProvider (server/geo/fakeProvider.ts) instead')).toBe(false);
    expect(IMPORTS_FAKE.test("import { createCachedProvider } from '../geo/providers';")).toBe(false);
  });

  it('no file under server/api/, server/domain/ or server/index.ts imports fakeProvider', () => {
    const appFiles = [...sourceFiles(path.join('server', 'api')), ...sourceFiles(path.join('server', 'domain')), ...sourceFiles(path.join('server', 'index.ts'))];
    expect(appFiles).toContain(path.join('server', 'index.ts'));
    expect(appFiles.length).toBeGreaterThan(10); // the walk really found the app
    const offenders = appFiles.filter(importsFake);
    expect(offenders).toEqual([]);
  });

  it('nothing else that ships does either: the rest of server/, scripts/ and the client', () => {
    const shipped = [...sourceFiles('server'), ...sourceFiles('scripts'), ...sourceFiles(path.join('client', 'src'))].filter((file) => file !== FAKE_FILE);
    expect(sourceFiles('server')).toContain(FAKE_FILE);
    const offenders = shipped.filter(importsFake);
    expect(offenders).toEqual([]);
  });
});
