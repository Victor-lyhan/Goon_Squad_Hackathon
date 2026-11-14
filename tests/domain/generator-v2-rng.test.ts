import { describe, expect, it } from 'vitest';
import { createRng, type Rng } from '../../server/domain/v2/rng';

const take = (rng: Rng, count: number) => Array.from({ length: count }, () => rng.next());

describe('createRng (v2)', () => {
  // These numbers were read from the generator before it moved here. If one changes,
  // every seeded scenario, name and ID changes with it.
  it.each([
    [0, [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111, 0.46732782293111086]],
    [1, [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849]],
    [42, [0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693, 0.17481389874592423]],
    [20_261_114, [0.12950722174718976, 0.38213343149982393, 0.757204532623291, 0.19665818405337632, 0.23901733267121017]],
    [-1, [0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677, 0.8452364315744489]],
  ])('pins the first five numbers of seed %i', (seed, expected) => {
    expect(take(createRng(seed), 5)).toEqual(expected);
  });

  it('pins int, pick and shuffle on one generator, in draw order', () => {
    const rng = createRng(42);

    expect(Array.from({ length: 10 }, () => rng.int(-3, 5))).toEqual([2, 1, 4, 3, -2, 1, -1, 2, 4, 1]);
    expect(Array.from({ length: 6 }, () => rng.pick(['a', 'b', 'c', 'd']))).toEqual(['a', 'd', 'c', 'b', 'a', 'c']);
    expect(rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([7, 2, 8, 4, 3, 1, 5, 6]);
    // 10 + 6 + 7 draws so far: the next number shows no helper drew more or fewer.
    expect(rng.next()).toBe(0.03153795562684536);
  });

  it('is deterministic for a seed and varies for a different seed', () => {
    const firstValues = take(createRng(42), 100);

    expect(firstValues).toEqual(take(createRng(42), 100));
    expect(firstValues).not.toEqual(take(createRng(43), 100));
    expect(firstValues.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('keeps two generators with the same seed independent of each other', () => {
    const first = createRng(7);
    const second = createRng(7);
    const fromFirst = take(first, 20);
    first.shuffle([1, 2, 3, 4]);

    expect(take(second, 20)).toEqual(fromFirst);
  });

  it('reads the seed as an unsigned 32-bit integer', () => {
    expect(take(createRng(4_294_967_296 + 42), 5)).toEqual(take(createRng(42), 5));
    expect(take(createRng(1.5), 5)).toEqual(take(createRng(1), 5));
  });

  it('keeps inclusive integers within the requested range', () => {
    const rng = createRng(42);
    const values = Array.from({ length: 1_000 }, () => rng.int(-3, 5));

    expect(values.every((value) => value >= -3 && value <= 5)).toBe(true);
    expect(new Set(values).size).toBe(9);
  });

  it('rejects bad bounds and an empty pick, and does not change the shuffled array', () => {
    const rng = createRng(42);
    const items = [1, 2, 3, 4, 5];

    expect(() => rng.int(5, -3)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
    expect([...rng.shuffle(items)].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});
