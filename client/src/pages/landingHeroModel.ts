// The geometry of the homepage's hero illustration (#833): a drawing, not data. Two made-up commute lines
// on a stylized NYC map and the route the package rides along them. Nothing here comes from a run or is
// shown as a fact about one. Plain TS so Node tests can check it.

export type Pt = readonly [number, number];

/** The SVG's view box. The page crops it to its box (`slice`), so the route stays inside `HERO_SAFE_BOX`. */
export const HERO_VIEWBOX = { width: 800, height: 600 } as const;
/**
 * The part of the view box that stays visible in every box the hero gives the map: a box 2.3 times as wide
 * as tall crops the top and bottom to this, a box 0.57 times as wide as tall crops the sides to it.
 */
export const HERO_SAFE_BOX = { x0: 230, y0: 150, x1: 570, y1: 450 } as const;
/**
 * How the drawing (the shapes and the points below) is placed in the view box: scaled, then moved, so the
 * route sits in the middle. A point p of the drawing is at `placed(p)` in the view box.
 */
export const HERO_MAP_PLACEMENT = { scale: 1.2, dx: -104, dy: -88 } as const;
export function placed([x, y]: Pt): Pt {
  const { scale, dx, dy } = HERO_MAP_PLACEMENT;
  return [x * scale + dx, y * scale + dy];
}

/** Commuter A: from the sender (Lower Manhattan) over the river to the relay point. Transit-map angles only. */
export const LINE_A: readonly Pt[] = [[300, 420], [340, 420], [400, 360], [468, 360]];
/** Commuter B: from the relay point on to the recipient (Queens). Starts where A ends. */
export const LINE_B: readonly Pt[] = [[468, 360], [540, 288], [540, 236]];

export const SENDER: Pt = LINE_A[0]!;
export const RELAY_POINT: Pt = LINE_A[LINE_A.length - 1]!;
export const RECIPIENT: Pt = LINE_B[LINE_B.length - 1]!;

/** An SVG path through the points, straight segments: "M300 420L340 420…". */
export function pathD(points: readonly Pt[]): string {
  return `M${points.map(([x, y]) => `${x} ${y}`).join('L')}`;
}

export function lengthOf(points: readonly Pt[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return sum;
}

/** The middle of segment `i` of a line (where its letter badge sits). */
export function segmentMidpoint(points: readonly Pt[], i: number): Pt {
  const a = points[i]!;
  const b = points[i + 1]!;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** The package's whole route: line A, then line B. */
export const PACKAGE_ROUTE: readonly Pt[] = [...LINE_A, ...LINE_B.slice(1)];

/**
 * How far along the package's route the relay point is, in percent with one decimal. The animation moves
 * the package from 0 to this on line A, waits (the handoff), then moves it on to 100 on line B.
 */
export const RELAY_SPLIT_PERCENT: number =
  Math.round((1000 * lengthOf(LINE_A)) / (lengthOf(LINE_A) + lengthOf(LINE_B))) / 10;
