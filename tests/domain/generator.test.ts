import { describe, expect, it } from 'vitest';
import { createRng, gridGraph } from '../../server/domain/generator.js';

describe('createRng', () => {
  it('is deterministic for a seed and varies for a different seed', () => {
    const first = createRng(42);
    const second = createRng(42);
    const other = createRng(43);
    const firstValues = Array.from({ length: 100 }, () => first.next());

    expect(firstValues).toEqual(Array.from({ length: 100 }, () => second.next()));
    expect(firstValues).not.toEqual(Array.from({ length: 100 }, () => other.next()));
    expect(firstValues.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('keeps inclusive integers within the requested range', () => {
    const rng = createRng(42);
    const values = Array.from({ length: 1_000 }, () => rng.int(-3, 5));

    expect(values.every((value) => value >= -3 && value <= 5)).toBe(true);
  });
});

describe('gridGraph', () => {
  it('creates a reachable labelled two-way 12 by 12 city grid', () => {
    const graph = gridGraph();
    expect(graph.nodes).toHaveLength(144);
    expect(graph.edges).toHaveLength(528);
    expect(new Set(graph.nodes.map((node) => node.label)).size).toBe(graph.nodes.length);
    expect(graph.nodes.every((node) => node.label !== node.id)).toBe(true);

    const adjacent = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const neighbours = adjacent.get(edge.from) ?? [];
      neighbours.push(edge.to);
      adjacent.set(edge.from, neighbours);
      expect(edge.distanceM).toBe(500);
      expect(edge.durationMin).toBe(2);
    }

    const visited = new Set(['n-0-0']);
    const queue = ['n-0-0'];
    for (let index = 0; index < queue.length; index += 1) {
      for (const neighbour of adjacent.get(queue[index]!) ?? []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    expect(visited.size).toBe(graph.nodes.length);
  });
});
