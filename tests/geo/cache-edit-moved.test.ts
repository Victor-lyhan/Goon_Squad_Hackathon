// movedHomes (server/geo/cacheEdit.ts): which cached homes are no longer where the fixtures put them. No network, no key, no files.
import { describe, expect, it } from 'vitest';
import { dropPlaces, movedHomes } from '../../server/geo/cacheEdit';
import { HOMES, completeFiles, deepFreeze } from './cache-edit-helpers';

/** One degree of latitude in meters on the sphere `straightLineM` uses. */
const M_PER_DEG_LAT = (6_371_008.8 * Math.PI) / 180;
/** The same home, `meters` further north. */
const north = <T extends { lat: number }>(home: T, meters: number): T => ({ ...home, lat: home.lat + meters / M_PER_DEG_LAT });
/** The same home, `meters` further east. */
const east = <T extends { lat: number; lng: number }>(home: T, meters: number): T => ({
  ...home,
  lng: home.lng + meters / (M_PER_DEG_LAT * Math.cos((home.lat * Math.PI) / 180)),
});

const [home1, home10, harlem] = HOMES;

describe('movedHomes', () => {
  it('lists nothing when every home is where it was cached', () => {
    expect(movedHomes({ files: completeFiles(), homes: HOMES })).toEqual([]);
  });

  it('does not list a home moved by 0.5 m at the default tolerance of 1 m', () => {
    expect(movedHomes({ files: completeFiles(), homes: [home1, north(home10, 0.5), harlem] })).toEqual([]);
  });

  it('lists a home moved by 0.5 m when the tolerance is smaller', () => {
    const moved = movedHomes({ files: completeFiles(), homes: [home1, north(home10, 0.5), harlem], toleranceM: 0.25 });
    expect(moved.map((home) => home.id)).toEqual(['home-10']);
    expect(moved[0].movedM).toBeCloseTo(0.5, 2);
  });

  it('lists a home moved by 50 m with the cached point, the current point and the distance', () => {
    const current = north(harlem, 50);
    const moved = movedHomes({ files: completeFiles(), homes: [home1, home10, current] });

    expect(moved).toHaveLength(1);
    expect(moved[0].id).toBe('home-story-harlem-2');
    expect(moved[0].cached).toEqual({ lat: harlem.lat, lng: harlem.lng });
    expect(moved[0].current).toEqual({ lat: current.lat, lng: current.lng });
    expect(moved[0].movedM).toBeCloseTo(50, 2);
  });

  it('measures a move along the longitude too', () => {
    const moved = movedHomes({ files: completeFiles(), homes: [east(home1, 50)] });
    expect(moved.map((home) => home.id)).toEqual(['home-1']);
    expect(moved[0].movedM).toBeCloseTo(50, 1);
  });

  it('uses "more than": a move of exactly the tolerance is not listed', () => {
    const files = completeFiles();
    const current = north(home1, 20);
    const [{ movedM }] = movedHomes({ files, homes: [current] });
    expect(movedHomes({ files, homes: [current], toleranceM: movedM })).toEqual([]);
    expect(movedHomes({ files, homes: [current], toleranceM: movedM - 0.001 })).toHaveLength(1);
  });

  it('does not list a home that is missing from the cache, wherever it is', () => {
    const files = completeFiles();
    const newHome = { id: 'home-777', lat: 40.7, lng: -73.9 };
    expect(movedHomes({ files, homes: [...HOMES, newHome] })).toEqual([]);

    // A dropped home is missing, not moved: the fetch plan lists it.
    const dropped = dropPlaces(files, ['home-1']).files;
    expect(movedHomes({ files: dropped, homes: [north(home1, 500), home10, harlem] })).toEqual([]);
  });

  it('sorts the result by ID, whatever the order of the homes', () => {
    const homes = [north(harlem, 50), east(home10, 80), north(home1, 120)];
    const moved = movedHomes({ files: completeFiles(), homes });
    expect(moved.map((home) => home.id)).toEqual(['home-1', 'home-10', 'home-story-harlem-2']);
    expect(moved.map((home) => Math.round(home.movedM))).toEqual([120, 80, 50]);
  });

  it('ignores extra fields on a home and a second entry with the same ID', () => {
    const homes = [{ ...north(home1, 50), neighborhood: 'Astoria' }, home1];
    const moved = movedHomes({ files: completeFiles(), homes });
    expect(moved).toHaveLength(1);
    expect(Object.keys(moved[0]).sort()).toEqual(['cached', 'current', 'id', 'movedM']);
    expect(Object.keys(moved[0].current).sort()).toEqual(['lat', 'lng']);
  });

  it('reads only `matrix.places`, and only for the homes it is given', () => {
    const files = completeFiles();
    files.matrix.pairs = {};
    expect(movedHomes({ files, homes: [north(home1, 50)] }).map((home) => home.id)).toEqual(['home-1']);
    expect(movedHomes({ files: { matrix: files.matrix }, homes: [] })).toEqual([]);
  });

  it('does not mutate its input, and the result shares no object with it', () => {
    const files = deepFreeze(completeFiles());
    const homes = deepFreeze([north(home1, 50)]);
    const moved = movedHomes({ files, homes });
    expect(moved[0].cached).not.toBe(files.matrix.places['home-1']);
    expect(moved[0].current).not.toBe(homes[0]);
  });

  it('refuses a tolerance that is not a non-negative number', () => {
    const files = completeFiles();
    expect(() => movedHomes({ files, homes: HOMES, toleranceM: -1 })).toThrow(RangeError);
    expect(() => movedHomes({ files, homes: HOMES, toleranceM: Number.NaN })).toThrow(RangeError);
    expect(movedHomes({ files, homes: HOMES, toleranceM: 0 })).toEqual([]);
  });

  it('throws, without printing a coordinate, when a cached home has no usable current point', () => {
    const broken = { id: 'home-1', lat: Number.NaN, lng: -73.919 };
    expect(() => movedHomes({ files: completeFiles(), homes: [broken] })).toThrow('Home home-1 has no usable coordinates');
  });
});
