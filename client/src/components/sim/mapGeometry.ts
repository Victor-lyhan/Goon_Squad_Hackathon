// Pure geometry helpers for CityMap (no JSX/DOM). Node coordinates are scaled so the
// longer side of the node bounding box spans MAP_UNIT units, which makes the tiny
// fixture (0-2) and the 12x12 city both render at a similar size.
import type { Graph, Node } from '../../../../shared/types';

export const MAP_UNIT = 1000;

export type Point = { x: number; y: number };
export type ViewBox = { x: number; y: number; width: number; height: number };
export type Segment = { from: string; to: string; a: Point; b: Point };

type XY = Pick<Node, 'id' | 'x' | 'y'>;

/** Scaled position of every node, keyed by id. */
export function projectNodes(nodes: readonly XY[]): Map<string, Point> {
  const out = new Map<string, Point>();
  if (nodes.length === 0) return out;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const span = Math.max(
    Math.max(...nodes.map((n) => n.x)) - minX,
    Math.max(...nodes.map((n) => n.y)) - minY,
    1e-9,
  );
  const k = MAP_UNIT / span;
  for (const n of nodes) out.set(n.id, { x: (n.x - minX) * k, y: (n.y - minY) * k });
  return out;
}

/** viewBox (in scaled units) containing every node plus `padding` on all sides. */
export function computeViewBox(nodes: readonly XY[], padding: number): ViewBox {
  const pts = [...projectNodes(nodes).values()];
  if (pts.length === 0) return { x: -padding, y: -padding, width: 2 * padding, height: 2 * padding };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) + padding - minX,
    height: Math.max(...ys) + padding - minY,
  };
}

/** One segment per road: A->B and B->A collapse into one. Order = first appearance in graph.edges. */
export function roadSegments(graph: Graph): Segment[] {
  const pos = projectNodes(graph.nodes);
  const seen = new Set<string>();
  const out: Segment[] = [];
  for (const e of graph.edges) {
    const key = e.from < e.to ? `${e.from}\u0000${e.to}` : `${e.to}\u0000${e.from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue; // edge to a missing node: nothing to draw
    out.push({ from: e.from, to: e.to, a, b });
  }
  return out;
}

/** Polyline for a route of node ids. Throws on an unknown node id. */
export function routePoints(graph: Graph, nodeIds: readonly string[]): Point[] {
  const pos = projectNodes(graph.nodes);
  return nodeIds.map((id) => {
    const p = pos.get(id);
    if (!p) throw new Error(`routePoints: unknown node "${id}"`);
    return { ...p };
  });
}

export const pointsAttr = (pts: readonly Point[]): string =>
  pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** Projector for raw graph-unit coordinates (e.g. marker x/y) into the same scaled space as projectNodes. */
export function pointProjector(nodes: readonly XY[]): (p: Point) => Point {
  if (nodes.length === 0) return (p) => p;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const span = Math.max(
    Math.max(...nodes.map((n) => n.x)) - minX,
    Math.max(...nodes.map((n) => n.y)) - minY,
    1e-9,
  );
  const k = MAP_UNIT / span;
  return (p) => ({ x: (p.x - minX) * k, y: (p.y - minY) * k });
}
