export type Rng = {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: T[]): T;
  shuffle<T>(items: T[]): T[];
};

/** A deterministic mulberry32 pseudo-random number generator. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  return {
    next,
    int(min: number, max: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
        throw new RangeError('int requires integer bounds where min is at most max');
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    pick<T>(items: T[]): T {
      if (items.length === 0) throw new RangeError('pick requires a non-empty array');
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle<T>(items: T[]): T[] {
      const shuffled = [...items];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(next() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
      }
      return shuffled;
    },
  };
}
