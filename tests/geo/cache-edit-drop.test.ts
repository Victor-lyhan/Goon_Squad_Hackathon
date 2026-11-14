// dropPlaces and formatCacheEdit (server/geo/cacheEdit.ts): pure functions over plain cache objects. No network, no key, no files.
import { describe, expect, it } from 'vitest';
import { emptyTravelFiles, serializeTravelFiles } from '../../server/geo/cache';
import { dropPlaces, formatCacheEdit } from '../../server/geo/cacheEdit';
import { completeFiles, deepFreeze, withoutPlaces } from './cache-edit-helpers';

describe('dropPlaces', () => {
  it('starts from the fixture the counts below assume: 6 places, 24 pairs, 9 route lines', () => {
    const files = completeFiles();
    expect(Object.keys(files.matrix.places)).toHaveLength(6);
    expect(Object.keys(files.matrix.pairs)).toHaveLength(24);
    expect(Object.keys(files.polylines.polylines)).toHaveLength(9);
  });

  it('drops a home with its pairs and route lines, and leaves every other entry as it was', () => {
    const files = completeFiles();
    const result = dropPlaces(files, ['home-story-harlem-2']);

    expect(result.dropped).toEqual(['home-story-harlem-2']);
    expect(result.unknown).toEqual([]);
    // 3 businesses x 2 directions; two employees live there, so 4 commute lines.
    expect(result.removed).toEqual({ places: 1, pairs: 6, polylines: 4 });
    expect(result.files).toEqual(withoutPlaces(files, ['home-story-harlem-2']));
    expect(JSON.stringify(result.files)).not.toContain('home-story-harlem-2');
    expect(result.files.matrix.schemaVersion).toBe(1);
    expect(result.files.polylines.schemaVersion).toBe(1);
  });

  it('drops a business with its pairs to businesses and homes, in both directions', () => {
    const files = completeFiles();
    const result = dropPlaces(files, ['biz-a']);

    expect(result.dropped).toEqual(['biz-a']);
    // 2 other businesses x 2 + 3 homes x 2; the commutes of emp 1 and emp 4 (4 lines) + biz-a → biz-b.
    expect(result.removed).toEqual({ places: 1, pairs: 10, polylines: 5 });
    expect(result.files).toEqual(withoutPlaces(files, ['biz-a']));
    expect(result.files.matrix.places['biz-b']).toEqual(files.matrix.places['biz-b']); // formattedAddress kept
    expect(Object.keys(result.files.matrix.pairs)).toContain('biz-b|biz-c');
  });

  it('drops two IDs at once and counts a pair between them once', () => {
    const files = completeFiles();
    const result = dropPlaces(files, ['home-1', 'biz-a']);

    expect(result.dropped).toEqual(['biz-a', 'home-1']);
    expect(result.unknown).toEqual([]);
    // 6 + 10 pairs minus the 2 they share; 2 + 5 lines minus the 2 they share.
    expect(result.removed).toEqual({ places: 2, pairs: 14, polylines: 5 });
    expect(result.files).toEqual(withoutPlaces(files, ['home-1', 'biz-a']));
  });

  it('gives the same result for a repeated ID and for any order', () => {
    const files = completeFiles();
    const once = dropPlaces(files, ['biz-a', 'home-1']);
    expect(dropPlaces(files, ['home-1', 'biz-a', 'home-1'])).toEqual(once);
  });

  it('puts an ID that is not in the cache in `unknown` and changes nothing', () => {
    const files = completeFiles();
    const result = dropPlaces(files, ['home-999']);

    expect(result.unknown).toEqual(['home-999']);
    expect(result.dropped).toEqual([]);
    expect(result.removed).toEqual({ places: 0, pairs: 0, polylines: 0 });
    expect(result.files).toEqual(files);
  });

  it('drops the known IDs and reports the unknown ones in one call', () => {
    const files = completeFiles();
    const result = dropPlaces(files, ['home-zzz', 'home-10', 'biz-nope']);

    expect(result.dropped).toEqual(['home-10']);
    expect(result.unknown).toEqual(['biz-nope', 'home-zzz']);
    expect(result.removed).toEqual({ places: 1, pairs: 6, polylines: 2 });
    expect(result.files).toEqual(withoutPlaces(files, ['home-10']));
  });

  it('does not match an ID that is a prefix of another ID: dropping home-1 keeps home-10', () => {
    const files = completeFiles();
    const result = dropPlaces(files, ['home-1']);

    expect(result.removed).toEqual({ places: 1, pairs: 6, polylines: 2 });
    expect(result.files.matrix.places['home-10']).toEqual(files.matrix.places['home-10']);
    const home10Pairs = Object.keys(result.files.matrix.pairs).filter((key) => key.includes('home-10'));
    expect(home10Pairs.sort()).toEqual(['biz-a|home-10', 'biz-b|home-10', 'biz-c|home-10', 'home-10|biz-a', 'home-10|biz-b', 'home-10|biz-c']);
    expect(Object.keys(result.files.polylines.polylines).filter((key) => key.includes('home-10')).sort()).toEqual(['biz-b|home-10', 'home-10|biz-b']);
    expect(result.files).toEqual(withoutPlaces(files, ['home-1']));
  });

  it('treats a part of an ID (a prefix, a suffix, the empty string) as unknown', () => {
    const files = completeFiles();
    const result = dropPlaces(files, ['home', 'home-', 'biz', 'a', '0', '2', '']);

    expect(result.dropped).toEqual([]);
    expect(result.unknown).toEqual(['', '0', '2', 'a', 'biz', 'home', 'home-']);
    expect(result.files).toEqual(files);
  });

  it('never mutates its input and shares no object with it', () => {
    const files = deepFreeze(completeFiles()); // a write to the input would throw
    const before = structuredClone(files);

    const result = dropPlaces(files, ['home-1', 'home-999']);
    expect(files).toEqual(before);

    expect(result.files).not.toBe(files);
    expect(result.files.matrix).not.toBe(files.matrix);
    expect(result.files.polylines).not.toBe(files.polylines);
    // Changing the result must not reach the input either.
    result.files.matrix.places['biz-a'].lat = 0;
    result.files.matrix.pairs['biz-a|biz-b'].durationS = 1;
    result.files.polylines.polylines['biz-a|biz-b'] = 'changed';
    expect(files).toEqual(before);
  });

  it('returns new files even when nothing is dropped', () => {
    const files = completeFiles();
    const result = dropPlaces(files, []);
    expect(result).toEqual({ files, dropped: [], removed: { places: 0, pairs: 0, polylines: 0 }, unknown: [] });
    expect(result.files).not.toBe(files);
    expect(result.files.matrix.places).not.toBe(files.matrix.places);
  });

  it('removes the leftover pairs and lines of a place whose `places` entry is already gone', () => {
    const files = completeFiles();
    delete files.matrix.places['home-1'];
    const result = dropPlaces(files, ['home-1']);

    expect(result.dropped).toEqual(['home-1']);
    expect(result.unknown).toEqual([]);
    expect(result.removed).toEqual({ places: 0, pairs: 6, polylines: 2 });
    expect(JSON.stringify(result.files)).not.toContain('"home-1"');
    expect(JSON.stringify(result.files)).not.toContain('home-1|');
    expect(JSON.stringify(result.files)).not.toContain('|home-1"');
  });

  it('gives files the cache writer accepts, with the remaining entries byte for byte', () => {
    const files = completeFiles();
    const result = dropPlaces(files, ['biz-c']);
    expect(serializeTravelFiles(result.files)).toEqual(serializeTravelFiles(withoutPlaces(files, ['biz-c'])));
  });

  it('works on an empty cache', () => {
    const result = dropPlaces(emptyTravelFiles(), ['home-1']);
    expect(result).toEqual({ files: emptyTravelFiles(), dropped: [], removed: { places: 0, pairs: 0, polylines: 0 }, unknown: ['home-1'] });
  });
});

describe('formatCacheEdit', () => {
  it('prints one line for a dropped place, with counts', () => {
    const lines = formatCacheEdit({ dropped: ['home-story-harlem-2'], removed: { places: 1, pairs: 36, polylines: 2 }, unknown: [] });
    expect(lines).toEqual(['Dropped home-story-harlem-2: 1 place, 36 pairs, 2 route lines. Run fetch:routes to refill.']);
  });

  it('uses the singular for one and the plural for none or many', () => {
    expect(formatCacheEdit({ dropped: ['biz-a', 'home-1'], removed: { places: 2, pairs: 1, polylines: 1 }, unknown: [] })).toEqual([
      'Dropped biz-a, home-1: 2 places, 1 pair, 1 route line. Run fetch:routes to refill.',
    ]);
    expect(formatCacheEdit({ dropped: ['home-1'], removed: { places: 0, pairs: 6, polylines: 0 }, unknown: [] })).toEqual([
      'Dropped home-1: 0 places, 6 pairs, 0 route lines. Run fetch:routes to refill.',
    ]);
  });

  it('prints one line per unknown ID, after the dropped line', () => {
    const result = dropPlaces(completeFiles(), ['home-zzz', 'home-10', 'biz-nope']);
    expect(formatCacheEdit(result)).toEqual([
      'Dropped home-10: 1 place, 6 pairs, 2 route lines. Run fetch:routes to refill.',
      'Not in the travel cache: biz-nope. Nothing was dropped for it.',
      'Not in the travel cache: home-zzz. Nothing was dropped for it.',
    ]);
  });

  it('prints no "Dropped" line when every ID is unknown', () => {
    expect(formatCacheEdit(dropPlaces(completeFiles(), ['home-999']))).toEqual(['Not in the travel cache: home-999. Nothing was dropped for it.']);
  });

  it('says so when no ID was given', () => {
    expect(formatCacheEdit(dropPlaces(completeFiles(), []))).toEqual(['Nothing to drop: no place ID was given.']);
  });

  it('prints no coordinates and no addresses', () => {
    const files = completeFiles();
    const text = formatCacheEdit(dropPlaces(files, Object.keys(files.matrix.places))).join('\n');
    expect(text).toContain('6 places, 24 pairs, 9 route lines');
    for (const place of Object.values(files.matrix.places)) {
      expect(text).not.toContain(String(place.lat));
      expect(text).not.toContain(String(place.lng));
      if (place.formattedAddress) expect(text).not.toContain(place.formattedAddress);
    }
    expect(text).not.toMatch(/\d\.\d/); // no decimal number at all
  });
});
