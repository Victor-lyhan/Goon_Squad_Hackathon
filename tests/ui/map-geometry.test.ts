import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { Graph } from '../../shared/types';
import { computeViewBox, projectNodes, roadSegments, routePoints } from '../../client/src/components/sim/mapGeometry';

const graph = fixture.graph as Graph;

describe('mapGeometry', () => {
  it('viewBox contains all nodes with padding', () => {
    const pad = 50;
    const vb = computeViewBox(graph.nodes, pad);
    for (const p of projectNodes(graph.nodes).values()) {
      expect(p.x - pad).toBeGreaterThanOrEqual(vb.x - 1e-9);
      expect(p.y - pad).toBeGreaterThanOrEqual(vb.y - 1e-9);
      expect(p.x + pad).toBeLessThanOrEqual(vb.x + vb.width + 1e-9);
      expect(p.y + pad).toBeLessThanOrEqual(vb.y + vb.height + 1e-9);
    }
  });

  it('scales tiny and large coordinate ranges to the same size', () => {
    const big = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: i, y: i }));
    const a = computeViewBox(graph.nodes, 0);
    const b = computeViewBox(big, 0);
    expect(a.width).toBeCloseTo(b.width);
  });

  it('fixture has 6 segments; two-way pair dedupes to 1', () => {
    expect(roadSegments(graph)).toHaveLength(6);
    const two: Graph = {
      nodes: [{ id: 'P', x: 0, y: 0 }, { id: 'Q', x: 1, y: 0 }],
      edges: [
        { from: 'P', to: 'Q', distanceM: 1, durationMin: 1 },
        { from: 'Q', to: 'P', distanceM: 1, durationMin: 1 },
      ],
    };
    expect(roadSegments(two)).toHaveLength(1);
  });

  it('routePoints returns a polyline and throws on unknown node', () => {
    expect(routePoints(graph, ['A', 'H', 'X'])).toHaveLength(3);
    expect(() => routePoints(graph, ['A', 'nope'])).toThrow(/nope/);
  });
});
