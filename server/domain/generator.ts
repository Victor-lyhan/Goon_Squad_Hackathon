import type { Graph, Node } from '../../shared/types.js';

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

const streetNames = [
  'Maple', 'Oak', 'Cedar', 'Elm', 'Pine', 'Willow',
  'Birch', 'Ash', 'Cherry', 'Walnut', 'Spruce', 'Juniper',
];

const avenueNames = [
  '1st', '2nd', '3rd', '4th', '5th', '6th',
  '7th', '8th', '9th', '10th', '11th', '12th',
];

function friendlyLabel(row: number, col: number): string {
  const street = streetNames[row] ?? `Street ${row + 1}`;
  const avenue = avenueNames[col] ?? `${col + 1}th`;
  return `${street} St & ${avenue} Ave`;
}

function districtFor(row: number, col: number, rows: number, cols: number): string {
  const centralRow = row >= Math.floor(rows / 3) && row < Math.ceil((rows * 2) / 3);
  const centralCol = col >= Math.floor(cols / 3) && col < Math.ceil((cols * 2) / 3);
  if (centralRow && centralCol) return 'Downtown';
  if (row < Math.floor(rows / 3)) return 'Northside';
  if (row >= Math.ceil((rows * 2) / 3)) return 'Southside';
  if (col < Math.floor(cols / 3)) return 'Westside';
  return 'Eastside';
}

/** Builds a two-way rectangular road grid with friendly location metadata. */
export function gridGraph(rows = 12, cols = 12): Graph {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new RangeError('gridGraph requires positive integer dimensions');
  }

  const nodes: Node[] = [];
  const edges: Graph['edges'] = [];
  const nodeId = (row: number, col: number) => `n-${row}-${col}`;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      nodes.push({
        id: nodeId(row, col), x: col, y: row,
        label: friendlyLabel(row, col), district: districtFor(row, col, rows, cols),
      });

      for (const [nextRow, nextCol] of [[row, col + 1], [row + 1, col]]) {
        if (nextRow >= rows || nextCol >= cols) continue;
        const from = nodeId(row, col);
        const to = nodeId(nextRow, nextCol);
        edges.push(
          { from, to, distanceM: 500, durationMin: 2 },
          { from: to, to: from, distanceM: 500, durationMin: 2 },
        );
      }
    }
  }

  return { nodes, edges };
}
