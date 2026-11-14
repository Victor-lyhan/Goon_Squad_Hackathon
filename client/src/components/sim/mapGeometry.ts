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

export type LabelItem = { id: string; x: number; y: number; text: string };
export type PlacedLabel = { id: string; x: number; y: number; anchor: 'start' | 'middle' | 'end'; moved: boolean };

export const LABEL_FONT = 20;
/** Rough text width in viewBox units (system-ui bold averages ~0.58em per character). */
export const estimateTextWidth = (text: string, fontSize = LABEL_FONT): number => text.length * fontSize * 0.58;

type Box = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Pure: choose a text position for each label so labels do not overlap each other or any marker.
 * Items are placed in order (earlier = higher priority). Each tries "below", "above", "right",
 * "left", then farther below/above; the first free spot wins. If none is free the least-bad
 * (first) candidate is used. `moved` is true when the label is not at its default (below) spot.
 */
export function placeLabels(
  items: readonly LabelItem[],
  opts: { fontSize?: number; markerRadius?: number; gap?: number } = {},
): PlacedLabel[] {
  const fs = opts.fontSize ?? LABEL_FONT;
  const r = opts.markerRadius ?? 24;
  const gap = opts.gap ?? 4;
  const markers: Box[] = items.map((i) => ({ x0: i.x - r, y0: i.y - r, x1: i.x + r, y1: i.y + r }));
  const placed: Box[] = [];
  const out: PlacedLabel[] = [];
  for (const it of items) {
    const w = estimateTextWidth(it.text, fs);
    const cands: { x: number; y: number; anchor: PlacedLabel['anchor'] }[] = [
      { x: it.x, y: it.y + r + fs, anchor: 'middle' },
      { x: it.x, y: it.y - r - 4, anchor: 'middle' },
      { x: it.x + r + gap, y: it.y + fs / 3, anchor: 'start' },
      { x: it.x - r - gap, y: it.y + fs / 3, anchor: 'end' },
      { x: it.x, y: it.y + r + 2 * fs + gap, anchor: 'middle' },
      { x: it.x, y: it.y - r - fs - 8, anchor: 'middle' },
    ];
    const boxOf = (c: (typeof cands)[number]): Box => {
      const x0 = c.anchor === 'middle' ? c.x - w / 2 : c.anchor === 'start' ? c.x : c.x - w;
      return { x0, x1: x0 + w, y0: c.y - fs, y1: c.y + fs * 0.25 };
    };
    let pick = 0;
    for (let k = 0; k < cands.length; k++) {
      const b = boxOf(cands[k]);
      if (!placed.some((p) => hit(b, p)) && !markers.some((m) => hit(b, m))) { pick = k; break; }
      if (k === cands.length - 1) pick = 0;
    }
    placed.push(boxOf(cands[pick]));
    out.push({ id: it.id, x: cands[pick].x, y: cands[pick].y, anchor: cands[pick].anchor, moved: pick !== 0 });
  }
  return out;
}
