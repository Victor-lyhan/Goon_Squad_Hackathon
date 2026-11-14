// enteredHomes, dropEnteredHomes, formatEnteredDrop and hideEnteredIds (server/geo/cacheEdit.ts): the homes typed
// into the commute editor (`home-c-<lat>_<lng>`) are found and dropped with all their pairs and route lines, and
// nothing printed about them holds an ID, because the ID is the coordinates (SPEC "MVP II" rule 6, issue #515).
// Pure functions over plain cache objects. No network, no key, no files.
import { describe, expect, it, vi } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { emptyTravelFiles, serializeTravelFiles } from '../../server/geo/cache';
import {
  ENTERED_HOME_PREFIX,
  dropEnteredHomes,
  dropPlaces,
  enteredHomes,
  formatEnteredDrop,
  hideEnteredIds,
  isEnteredHomeId,
} from '../../server/geo/cacheEdit';
import { BUSINESS_IDS, ENTERED_HOMES, ENTERED_HOME_IDS, ENTERED_ID_PATTERN, completeFiles, deepFreeze, withEnteredHomes } from './cache-edit-helpers';

// Everything here is in memory on a 6-place cache: well under 1 ms per test locally.
vi.setConfig({ testTimeout: 10_000 });

const [FIRST, SECOND] = ENTERED_HOME_IDS;

describe('isEnteredHomeId', () => {
  it('is the home-c- prefix of shared/v2/types.ts and nothing else', () => {
    expect(ENTERED_HOME_PREFIX).toBe('home-c-');
    expect(isEnteredHomeId('home-c-40.76420_-73.92350')).toBe(true);
    for (const id of ['home-001', 'home-story-harlem-2', 'home-c', 'home-chelsea-1', 'home-story-c-1', 'biz-home-c-1', '']) {
      expect(isEnteredHomeId(id), id).toBe(false);
    }
  });
});

describe('enteredHomes', () => {
  it('finds none in a cache that only holds fixture places, and none in an empty one', () => {
    expect(enteredHomes(completeFiles())).toEqual([]);
    expect(enteredHomes(emptyTravelFiles())).toEqual([]);
  });

  it('lists each entered home once, sorted, whatever order the cache holds them in', () => {
    const files = withEnteredHomes(completeFiles(), BUSINESS_IDS, 'biz-b', [...ENTERED_HOMES].reverse());
    expect(enteredHomes(files)).toEqual([FIRST, SECOND]);
    expect(FIRST < SECOND).toBe(true);
  });

  it('still finds a home whose places entry is gone but that a pair or a route line names, at either end', () => {
    const files = completeFiles();
    files.matrix.pairs[pairKey(FIRST, 'biz-a')] = { durationS: 700, distanceM: 5000 };
    files.polylines.polylines[pairKey('biz-c', SECOND)] = 'line:leftover';
    expect(enteredHomes(files)).toEqual([FIRST, SECOND]);

    const onlyDestination = completeFiles();
    onlyDestination.matrix.pairs[pairKey('biz-a', SECOND)] = { durationS: 700, distanceM: 5000 };
    expect(enteredHomes(onlyDestination)).toEqual([SECOND]);

    const onlyLineOrigin = completeFiles();
    onlyLineOrigin.polylines.polylines[pairKey(FIRST, 'biz-a')] = 'line:leftover';
    expect(enteredHomes(onlyLineOrigin)).toEqual([FIRST]);
  });

  it('does not change the cache it reads', () => {
    const files = deepFreeze(withEnteredHomes(completeFiles(), BUSINESS_IDS));
    expect(() => enteredHomes(files)).not.toThrow();
  });
});

describe('dropEnteredHomes', () => {
  it('round trip: two entered homes with pairs and lines are added, dropped, and the files equal the original', () => {
    const original = completeFiles();
    const withEntered = deepFreeze(withEnteredHomes(original, BUSINESS_IDS));
    // The sample really holds them: 2 places, 2 x 3 businesses x 2 directions, 2 x 2 commute lines.
    expect(Object.keys(withEntered.matrix.places)).toHaveLength(6 + 2);
    expect(Object.keys(withEntered.matrix.pairs)).toHaveLength(24 + 12);
    expect(Object.keys(withEntered.polylines.polylines)).toHaveLength(9 + 4);

    const result = dropEnteredHomes(withEntered);

    expect(result.files).toEqual(original);
    expect(serializeTravelFiles(result.files)).toEqual(serializeTravelFiles(original));
    expect(result.dropped).toEqual([FIRST, SECOND]);
    expect(result.unknown).toEqual([]);
    expect(result.removed).toEqual({ places: 2, pairs: 12, polylines: 4 });
    expect(JSON.stringify(result.files)).not.toContain(ENTERED_HOME_PREFIX);
    expect(enteredHomes(result.files)).toEqual([]);
  });

  it('is dropPlaces on the entered homes: the same result as naming them by hand', () => {
    const files = withEnteredHomes(completeFiles(), BUSINESS_IDS);
    expect(dropEnteredHomes(files)).toEqual(dropPlaces(files, ENTERED_HOME_IDS));
  });

  it('a cache with none comes back unchanged: equal files, nothing dropped, nothing counted', () => {
    const files = deepFreeze(completeFiles());
    const result = dropEnteredHomes(files);

    expect(result.files).toEqual(files);
    expect(serializeTravelFiles(result.files)).toEqual(serializeTravelFiles(files));
    expect(result.dropped).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.removed).toEqual({ places: 0, pairs: 0, polylines: 0 });

    const empty = dropEnteredHomes(emptyTravelFiles());
    expect(empty.files).toEqual(emptyTravelFiles());
    expect(empty.removed).toEqual({ places: 0, pairs: 0, polylines: 0 });
  });

  it('removes leftovers too: a pair and a line of an entered home that has no places entry', () => {
    const original = completeFiles();
    const files = structuredClone(original);
    files.matrix.pairs[pairKey(FIRST, 'biz-a')] = { durationS: 700, distanceM: 5000 };
    files.polylines.polylines[pairKey('biz-c', SECOND)] = 'line:leftover';

    const result = dropEnteredHomes(files);

    expect(result.files).toEqual(original);
    expect(result.removed).toEqual({ places: 0, pairs: 1, polylines: 1 });
  });

  it('leaves every fixture home alone, also one whose ID an entered home starts with', () => {
    // `home-c-4` + `0.70000_…`: a prefix match on IDs instead of on whole key ends would take this home's pairs too.
    const original = completeFiles();
    original.matrix.places['home-c'] = { lat: 40.71, lng: -73.99 };
    original.matrix.pairs[pairKey('home-c', 'biz-a')] = { durationS: 650, distanceM: 4100 };
    original.matrix.pairs[pairKey('biz-a', 'home-c')] = { durationS: 655, distanceM: 4150 };

    const result = dropEnteredHomes(withEnteredHomes(original, BUSINESS_IDS));

    expect(result.files).toEqual(original);
    expect(result.dropped).toEqual([FIRST, SECOND]);
  });
});

describe('formatEnteredDrop', () => {
  it('prints the number of homes, places, pairs and route lines, and never an ID or a coordinate', () => {
    const line = formatEnteredDrop(dropEnteredHomes(withEnteredHomes(completeFiles(), BUSINESS_IDS)));
    expect(line).toBe('Dropped 2 entered homes (addresses typed into the commute editor): 2 places, 12 pairs, 4 route lines.');
    expect(line).not.toMatch(ENTERED_ID_PATTERN);
  });

  it('uses the singular for one of each, and "Would drop" for a dry run', () => {
    const one = formatEnteredDrop({ dropped: [FIRST], removed: { places: 1, pairs: 1, polylines: 1 } }, 'Would drop');
    expect(one).toBe('Would drop 1 entered home (addresses typed into the commute editor): 1 place, 1 pair, 1 route line.');
  });

  it('says there is nothing to drop when there is no entered home', () => {
    expect(formatEnteredDrop(dropEnteredHomes(completeFiles()))).toBe('Entered homes: none in the travel cache. Nothing to drop.');
  });
});

describe('hideEnteredIds', () => {
  it('takes an entered-home ID out of a message that quotes a place or a pair key', () => {
    const place = hideEnteredIds(`Travel cache matrix.json: place "${FIRST}" needs a numeric lat and lng`);
    const pair = hideEnteredIds(`pair "${FIRST}|biz-a" and line "biz-b|${SECOND}", then ${SECOND}.`);

    expect(place).toBe('Travel cache matrix.json: place "home-c (entered address)" needs a numeric lat and lng');
    expect(pair).toBe('pair "home-c (entered address)|biz-a" and line "biz-b|home-c (entered address)", then home-c (entered address)');
    for (const text of [place, pair]) expect(text).not.toMatch(ENTERED_ID_PATTERN);
  });

  it('leaves every other text and ID as it is', () => {
    const text = 'Dropped biz-etsy, home-007, home-story-harlem-2: 3 places. See fixtures/nyc/matrix.json.';
    expect(hideEnteredIds(text)).toBe(text);
  });
});
