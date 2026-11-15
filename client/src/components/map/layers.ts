// Pure layer builder: plain descriptors only, no deck.gl import, so it tests in Node without
// WebGL. GoogleBaseMap.tsx turns each descriptor into a PathLayer / ScatterplotLayer / TextLayer.
import polyline from '@mapbox/polyline';
import { NYC_ZOOM } from './mapStyle';
import type { LayerVisibility, MapItem, MapMover, MapPlace, MapRoute, MapStop, RouteTone, StopSymbol } from './types';

export type RGBA = [number, number, number, number];

export type PathDatum = { id: string; path: [number, number][]; color: RGBA; width: number; item: MapItem };
export type ScatterDatum = {
  id: string;
  position: [number, number];
  fillColor: RGBA;
  lineColor: RGBA;
  radius: number;
  lineWidth: number;
  item: MapItem;
};
/**
 * `offset`: pixel offset from `position` (x right, y down); none = centred on it. `item`: what a pickable
 * text layer (the journey symbols) reports on hover and click.
 */
export type TextDatum = {
  id: string;
  position: [number, number];
  text: string;
  color: RGBA;
  offset?: [number, number];
  item?: MapItem;
};

export type PathSpec = { type: 'path'; id: string; data: PathDatum[]; props: Record<string, unknown> };
export type ScatterSpec = { type: 'scatter'; id: string; data: ScatterDatum[]; props: Record<string, unknown> };
export type TextSpec = { type: 'text'; id: string; data: TextDatum[]; props: Record<string, unknown> };
export type LayerSpec = PathSpec | ScatterSpec | TextSpec;

export type BuildLayerInput = {
  places: MapPlace[];
  routes: MapRoute[];
  movers: MapMover[];
  visible: LayerVisibility;
  selectedIds?: readonly string[];
  hoveredId?: string | null;
  /**
   * Journey stops: drawn above everything, never dimmed, ignore the layer toggles. With stops, the
   * package marker is drawn after them as a ring, so a package waiting at a stop stays visible.
   */
  stops?: MapStop[];
  /** Name the businesses that are not dimmed, as many as fit without overlapping (`placeNames`). */
  labelBusinesses?: boolean;
  /** Places that are always named, whatever the room, the toggles or the selection (journey places). */
  alwaysLabelIds?: readonly string[];
  /** The map's current zoom, used to keep names apart. Defaults to NYC_ZOOM (before the map is ready, in tests). */
  zoom?: number;
};

// Palette (docs/mvp3.md P4): carriers blue and green, the package orange, relay points ink, background
// items grey. Chosen to stay apart for colour-blind viewers too; shapes and letter badges back them up.
/** The MVP III primary (`--accent` in tokens.css, #1D5075). */
export const ACCENT: RGBA = [29, 80, 117, 235]; // #1D5075
/** Carrier A (leg 1) and every untoned delivery route, also in the Business and Employee previews. */
export const LEG1: RGBA = [29, 80, 117, 235]; // #1D5075
/** Carrier B (leg 2). */
export const LEG2: RGBA = [15, 138, 95, 235]; // #0F8A5F
/** Faded / background items: homes and normal commutes. */
export const FADED: RGBA = [168, 171, 178, 255]; // #A8ABB2
/** Normal commute: thinner, fainter and drawn below the legs, so it reads as background. Not drawn in a journey. */
export const BASELINE: RGBA = [FADED[0], FADED[1], FADED[2], 170];
export const BASELINE_WIDTH = 2;
export const LEG_WIDTH = 4;
/** Journey: a carrier's whole commute of that trip, thin, in the carrier's colour. */
export const COMMUTE_WIDTH = 3;
/** Journey: the part of the commute where the carrier has the package, thick. */
export const CARRIED_WIDTH = 7;
export const STOP_RADIUS = 10;
/** Extra radius per additional stop sharing one place (relay drop and next-morning pickup). */
export const STOP_SHARED_GROWTH = 5;
/** Horizontal distance between two stop numbers drawn in one shared circle. */
export const STOP_NUMBER_SPACING = 12;
/** Ink of the relay diamond and of every journey symbol (sender square, swap, flag). */
export const RELAY_INK: RGBA = [23, 28, 36, 255]; // #171C24
/** Font size in pixels of a journey symbol glyph. */
export const SYMBOL_SIZE = 26;
/** The glyph drawn for each journey symbol: shapes differ, so colour is never the only cue. */
export const SYMBOL_GLYPH: Record<StopSymbol, string> = { sender: '\u25A0', relay: '\u25C6', swap: '\u21C4', recipient: '\u2691' };
/** Tooltip role of a journey symbol without a `detail`. */
const SYMBOL_ROLE: Record<StopSymbol, string> = { sender: 'Sender', relay: 'Relay point', swap: 'Handoff', recipient: 'Recipient' };
/** The journey package: a thick ring with a white halo, about twice the size of the old ring. */
export const PACKAGE_RING_WIDTH = 6;
/** Ring radius of a journey package that is not at a stop and has no carrier on the map. */
export const PACKAGE_RING_ALONE = 18;
/** The ring this far outside a numbered stop circle it surrounds. */
export const PACKAGE_RING_GAP = 8;
/** Ring radius around a journey symbol (outside the glyph). */
export const PACKAGE_RING_AT_SYMBOL = 22;
/** The soft white halo: this many pixels on each side of the ring. */
export const PACKAGE_HALO_WIDTH = 4;
export const PACKAGE_HALO: RGBA = [255, 255, 255, 200];
/** The swap symbol sits this far right of the relay diamond (outside the package ring and its halo). */
export const SWAP_DX = 42;
/** Pixels between a symbol's centre and the near edge of its label: outside the package ring and halo. */
export const SYMBOL_LABEL_GAP = PACKAGE_RING_AT_SYMBOL + PACKAGE_RING_WIDTH / 2 + PACKAGE_HALO_WIDTH + 2;
/** Network businesses: ink (`--text` in tokens.css, #171C24). */
export const BUSINESS_FILL: RGBA = [23, 28, 36, 235]; // #171C24
export const HOME_FILL: RGBA = [FADED[0], FADED[1], FADED[2], 230];
/** Network vehicles: the MVP III primary (#1D5075). */
export const VEHICLE_FILL: RGBA = [29, 80, 117, 255]; // #1D5075
/**
 * Every vehicle (the employee, the main moving object, docs/mvp4.md F2): the largest marker on the map,
 * in its carrier colour with a white outline and a white letter.
 */
export const VEHICLE_RADIUS = 15;
/** The vehicle's white outline, in pixels. */
export const VEHICLE_OUTLINE_WIDTH = 2.5;
/** Kept for older callers: every vehicle now has its letter, so all are this size. */
export const BADGED_VEHICLE_RADIUS = VEHICLE_RADIUS;
/** Font size in pixels of the letter on a vehicle. */
export const VEHICLE_LETTER_SIZE = 15;
export const BADGE_TEXT: RGBA = [255, 255, 255, 255];
export const PACKAGE_FILL: RGBA = [232, 89, 12, 255]; // #E8590C
/** A carried package: a small orange dot with a white outline riding on its carrier's marker. */
export const PACKAGE_BADGE_RADIUS = 6;
export const PACKAGE_BADGE_OUTLINE_WIDTH = 2;
/**
 * Where the carried package sits on its carrier, in pixels from the carrier's centre (x right, y up the
 * screen is negative): on the marker's upper-right rim, so the carrier's letter stays readable.
 */
export const PACKAGE_BADGE_OFFSET: [number, number] = [11, -11];
/** Network view (#780): the glyph where a package waits overnight (relay diamond) or was delivered (flag). */
export const WAITING_GLYPH: Record<NonNullable<MapMover['waiting']>, string> = { overnight: '\u25C6', delivered: '\u2691' };
/** Font size in pixels of a network waiting glyph: smaller than a journey symbol, larger than a business dot. */
export const WAITING_SYMBOL_SIZE = 20;
/** The label next to the relay diamond while packages wait there for the night (network view). */
export const OVERNIGHT_TEXT = 'Overnight';
/** "Overnight" for one package, "Overnight · 3 packages" when several wait at one relay point. */
export function overnightLabel(count: number): string {
  return count > 1 ? `${OVERNIGHT_TEXT} · ${count} packages` : OVERNIGHT_TEXT;
}
/** A straight line for an uncached place pair: dashes this long (metres) ... */
export const DASH_M = 120;
/** ... with gaps this long between them. */
export const DASH_GAP_M = 90;
/** At most this many dashes per line (a very long line gets longer dashes instead). */
export const MAX_DASHES = 300;
export const OUTLINE: RGBA = [255, 255, 255, 255];
/** Names on the map: ink (#171C24). */
export const LABEL: RGBA = [23, 28, 36, 255]; // #171C24
/** Alpha for items outside the current selection. */
export const DIM_ALPHA = 40;

// ---------- Names on the map ----------
/** Font size of every name on the map (selected labels and business names alike). */
export const NAME_SIZE = 12;
/** Height of a name's box in pixels: one 12 px line plus its white outline. */
export const NAME_BOX_HEIGHT = 16;
/** Pixels between a network marker's centre and the near edge of its name's box. */
export const NAME_GAP = 14;

/**
 * The face of every text layer: Inter, the UI font the page loads (fonts.css: 400, 500, 600). deck.gl
 * draws its glyph atlas from this family, so a family or weight the page does not load would be faked by
 * the browser. Bold text uses 600, the heaviest loaded face (DECISIONS pass 77: no 700 face).
 */
export const MAP_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/** The weight of every bold map text (stop numbers, carrier letters, symbol labels). */
export const MAP_BOLD_WEIGHT = 600;

/** One text style for every name, so business names read like the selected labels. */
const NAME_TEXT_PROPS = {
  sizeUnits: 'pixels',
  getSize: NAME_SIZE,
  getTextAnchor: 'middle',
  fontFamily: MAP_FONT_FAMILY,
  outlineWidth: 4,
  outlineColor: [255, 255, 255, 230],
  fontSettings: { sdf: true },
  pickable: false,
} as const;

const NARROW = new Set([...'iljtfrI.,:;\'!|() -']);
const WIDE = new Set([...'mwMW@&']);

/**
 * Estimated width in pixels of a name drawn at NAME_SIZE in Inter, plus its outline. It errs on
 * the wide side, so names that fit by this estimate do not touch on screen.
 */
export function nameWidthPx(text: string): number {
  let em = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.32;
    else if (WIDE.has(ch)) em += 0.88;
    else if (ch >= 'A' && ch <= 'Z') em += 0.68;
    else em += 0.58;
  }
  return Math.ceil(em * NAME_SIZE) + 4;
}

/** Google's world pixel coordinates (256 px tiles, Web Mercator) of a point at a zoom. */
export function projectPx(lng: number, lat: number, zoom: number): [number, number] {
  const world = 256 * 2 ** zoom;
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return [((lng + 180) / 360) * world, (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * world];
}

export type NameBox = { x0: number; y0: number; x1: number; y1: number };
export type NameCandidate = {
  id: string;
  text: string;
  lng: number;
  lat: number;
  /** Pixels between the marker's centre and the near edge of the box. */
  gap: number;
  /** Drawn even when there is no free spot (then at its first side). */
  always?: boolean;
  /** Horizontal pixel offset of the box's centre from the marker (the swap symbol's label). Default 0. */
  dx?: number;
  /** Sides to try, in order: -1 above, 1 below. Default above, then below. */
  sides?: readonly (-1 | 1)[];
};
export type PlacedName = { id: string; text: string; position: [number, number]; offset: [number, number]; box: NameBox };

export function boxesOverlap(a: NameBox, b: NameBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Rows an `always` name may try on each side: next to its marker, then one and two box heights out. */
export const ALWAYS_ROWS = 3;

/**
 * Which names are drawn, and where, at this zoom. Each name tries above its marker, then below; it is
 * drawn at the first spot whose box overlaps no name already placed, so no two drawn boxes overlap.
 * `always` names go first, may also try ALWAYS_ROWS - 1 rows further out, and are drawn even without a
 * free spot (then at the first spot). The rest follow in input order and are dropped when both spots are taken. Zooming in spreads the markers apart while the boxes keep
 * their size, so a dropped name comes back. Pure: boxes are in world pixels at `zoom`.
 */
export function placeNames(candidates: readonly NameCandidate[], zoom: number): PlacedName[] {
  const placed: PlacedName[] = [];
  const seen = new Set<string>();
  const ordered = [...candidates.filter((c) => c.always), ...candidates.filter((c) => !c.always)];
  for (const c of ordered) {
    const text = c.text.trim();
    if (seen.has(c.id) || !text || !Number.isFinite(c.lng) || !Number.isFinite(c.lat)) continue;
    const [x, y] = projectPx(c.lng, c.lat, zoom);
    const w = nameWidthPx(text);
    const h = NAME_BOX_HEIGHT;
    const dx = c.dx ?? 0;
    // An `always` name may also move one or two rows further out before it gives up on a free spot.
    const rows = c.always ? ALWAYS_ROWS : 1;
    const spots = Array.from({ length: rows }, (_, row) => row).flatMap((row) =>
      (c.sides ?? [-1, 1]).map((side) => {
        const dy = side * (c.gap + h / 2 + row * h);
        return {
          offset: [dx, dy] as [number, number],
          box: { x0: x + dx - w / 2, x1: x + dx + w / 2, y0: y + dy - h / 2, y1: y + dy + h / 2 },
        };
      }),
    );
    const spot = spots.find((s) => !placed.some((p) => boxesOverlap(p.box, s.box))) ?? (c.always ? spots[0] : null);
    if (!spot) continue;
    seen.add(c.id);
    placed.push({ id: c.id, text, position: [c.lng, c.lat], offset: spot.offset, box: spot.box });
  }
  return placed;
}

const ROLE: Record<MapItem['kind'], string> = {
  business: 'Network business',
  home: 'Home',
  baseline: 'Normal commute',
  leg: 'Delivery route',
  vehicle: 'Carrier',
  package: 'Package',
  stop: 'Stop',
};

export function roleOf(kind: MapItem['kind']): string {
  return ROLE[kind];
}

/** The inverse of `projectPx`: the [lng, lat] of a world pixel at a zoom. */
export function unprojectPx(x: number, y: number, zoom: number): [number, number] {
  const world = 256 * 2 ** zoom;
  const lng = (x / world) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI;
  return [lng, lat];
}

/** The point `dx`, `dy` screen pixels away from [lng, lat] at a zoom (x right, y down). */
export function offsetByPx(position: [number, number], dx: number, dy: number, zoom: number): [number, number] {
  const [x, y] = projectPx(position[0], position[1], zoom);
  return unprojectPx(x + dx, y + dy, zoom);
}

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG_EQ = 111_320;

/**
 * A line cut into dashes (pieces of DASH_M metres with DASH_GAP_M gaps), so a plain path layer draws it
 * dashed. Never more than MAX_DASHES pieces: a longer line gets longer dashes. A line too short for one
 * gap stays one piece. Points that are not finite are dropped; fewer than two points give no dash.
 */
export function dashPieces(path: [number, number][]): [number, number][][] {
  const pts = path.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (pts.length < 2) return [];
  const kx = M_PER_DEG_LNG_EQ * Math.cos((pts[0][1] * Math.PI) / 180);
  const seg = pts.slice(1).map((p, i) => Math.hypot((p[0] - pts[i][0]) * kx, (p[1] - pts[i][1]) * M_PER_DEG_LAT));
  const total = seg.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [];
  const scale = Math.max(1, total / ((DASH_M + DASH_GAP_M) * MAX_DASHES));
  const dash = DASH_M * scale;
  const period = (DASH_M + DASH_GAP_M) * scale;
  if (total <= period) return [pts];
  // The point at distance `d` along the line.
  const at = (d: number): [number, number] => {
    let left = d;
    for (let i = 0; i < seg.length; i += 1) {
      if (left <= seg[i] || i === seg.length - 1) {
        const t = seg[i] > 0 ? Math.min(1, left / seg[i]) : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      }
      left -= seg[i];
    }
    return pts[pts.length - 1];
  };
  // The inner points of the line between distances `from` and `to`, so a dash follows a bend.
  const between = (from: number, to: number): [number, number][] => {
    const out: [number, number][] = [];
    let d = 0;
    for (let i = 0; i < seg.length - 1; i += 1) {
      d += seg[i];
      if (d > from && d < to) out.push(pts[i + 1]);
    }
    return out;
  };
  const count = Math.min(MAX_DASHES, Math.ceil(total / period - 1e-9));
  const pieces: [number, number][][] = [];
  for (let k = 0; k < count; k += 1) {
    const start = k * period;
    const end = Math.min(total, start + dash);
    pieces.push([at(start), ...between(start, end), at(end)]);
  }
  return pieces;
}

/** Decode a Google encoded polyline into deck.gl order ([lng, lat]). */
export function decodePath(encoded: string): [number, number][] {
  return polyline.decode(encoded).map(([lat, lng]) => [lng, lat] as [number, number]);
}

/** Map color for a route tone (no tone = leg 1 = carrier A's blue). */
export function toneColor(tone: RouteTone | undefined): RGBA {
  return tone === 'leg2' ? LEG2 : LEG1;
}

/** The carrier letter of a tone: A for leg 1, B for leg 2. */
export function toneLetter(tone: RouteTone): 'A' | 'B' {
  return tone === 'leg2' ? 'B' : 'A';
}

/** CSS color for a tone, so the journey legend shows exactly the map's colors. */
export function toneLabelColor(tone: RouteTone | undefined): string {
  return hexOf(toneColor(tone));
}

/**
 * Vehicle fill for a tone: `leg1` = LEG1 and `leg2` = LEG2, so a journey's carriers have their routes'
 * colours; no tone = VEHICLE_FILL (the network view).
 */
export function vehicleColor(tone: RouteTone | undefined): RGBA {
  return tone === 'leg2' ? LEG2 : tone === 'leg1' ? LEG1 : VEHICLE_FILL;
}

/** CSS color of a vehicle with this tone (the journey legend's vehicle dot). */
export function vehicleLabelColor(tone: RouteTone | undefined): string {
  return hexOf(vehicleColor(tone));
}

function hexOf([r, g, b]: RGBA): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function dim(c: RGBA): RGBA {
  return [c[0], c[1], c[2], Math.min(c[3], DIM_ALPHA)];
}

type Group = {
  key: 'routes-baseline' | 'routes-commute' | 'routes-leg' | 'businesses' | 'homes' | 'vehicles' | 'packages';
  build(selected: boolean): LayerSpec | null;
};

/**
 * Layer specs in draw order: baseline routes, journey commutes (thin), leg routes (thick), businesses,
 * homes, vehicles, packages. With a non-empty selection, items that are not selected (and, for routes,
 * not owned by a selected ID) are dimmed, and the selected items are drawn again as `<id>-selected`
 * layers on top, followed by a text layer labelling the selected places and movers. Hidden layers and
 * empty layers are omitted. Then `movers-vehicle-badge`: the letter on each badged vehicle, and (network
 * view) `movers-package-badge`: each carried package as a small orange badge on its carrier's marker.
 * A `dashed` route (an uncached place pair) is drawn as dash pieces in its usual layer.
 * Network view (no stops, #780): a package with `waiting` gets `movers-package-waiting` (the relay diamond
 * where packages wait overnight, the flag where they were delivered; one per business and reason), its dot
 * on the glyph's rim, and `movers-package-label` ("Overnight", placed with the names).
 * Then `labels-places`: the `alwaysLabelIds` places, and with `labelBusinesses` the businesses that are
 * not dimmed, as many as `placeNames` fits at `zoom` (homes, vehicles and packages get no name).
 * Journey stops come next, are never dimmed and ignore `visible`: numbered stops (`stops`,
 * `stops-number`), then symbols (`stops-symbol`) and their short labels (`stops-label`). With stops,
 * a package waiting at a business (`movers-package-halo`, `movers-package`) is drawn as a ring around its
 * stop or symbol, and a carried package (`carrierId`) as `movers-package-badge` on its carrier's marker,
 * last, so it is on top of everything.
 */
export function buildLayerSpecs(input: BuildLayerInput): LayerSpec[] {
  const { places, routes, movers, visible } = input;
  const selected = new Set(input.selectedIds ?? []);
  const hasSelection = selected.size > 0;
  const hoveredId = input.hoveredId ?? null;

  const isSelected = (id: string, ownerIds: string[] = []) =>
    selected.has(id) || ownerIds.some((o) => selected.has(o));
  // Which half of the split an item belongs to: without a selection everything is "base".
  const inPass = (sel: boolean, id: string, ownerIds?: string[]) =>
    hasSelection ? isSelected(id, ownerIds) === sel : !sel;

  const pathSpec = (
    id: string,
    which: (r: MapRoute) => boolean,
    colorOf: (r: MapRoute) => RGBA,
    widthOf: (r: MapRoute) => number,
    roleOfRoute: (r: MapRoute) => string,
  ) => (sel: boolean): LayerSpec | null => {
    if (!visible.routes) return null;
    const data: PathDatum[] = routes
      .filter((r) => which(r) && r.path.length >= 2 && inPass(sel, r.id, r.ownerIds))
      .flatMap((r) => {
        const width = widthOf(r);
        const datum = {
          id: r.id,
          color: hasSelection && !sel ? dim(colorOf(r)) : colorOf(r),
          width: r.id === hoveredId ? width + 2 : width,
          // Tooltip: the route's own label (package and carrier names) when its builder knows them.
          item: {
            id: r.id,
            kind: r.kind,
            label: r.label?.trim() || (r.kind === 'leg' && r.carried !== false ? 'Delivery route' : 'Commute'),
            role: r.dashed ? `${roleOfRoute(r)} · no street route cached` : roleOfRoute(r),
          },
        };
        // An uncached pair: the straight line as dashes, each piece reporting the same route.
        return r.dashed ? dashPieces(r.path).map((path) => ({ ...datum, path })) : [{ ...datum, path: r.path }];
      });
    return {
      type: 'path',
      id,
      data,
      props: { widthUnits: 'pixels', capRounded: true, jointRounded: true, pickable: true },
    };
  };

  const scatterSpec = <T extends MapPlace | MapMover>(
    id: string,
    items: T[],
    shown: boolean,
    fillOf: RGBA | ((item: T) => RGBA),
    radiusOf: number | ((item: T) => number),
    lineWidth = 1.5,
  ) => (sel: boolean): LayerSpec | null => {
    if (!shown) return null;
    const data: ScatterDatum[] = items
      .filter((p) => inPass(sel, p.id))
      .map((p) => {
        const dimmed = hasSelection && !sel;
        const hovered = p.id === hoveredId;
        const sublabel = (p as MapPlace).sublabel;
        const fill = typeof fillOf === 'function' ? fillOf(p) : fillOf;
        const radius = typeof radiusOf === 'function' ? radiusOf(p) : radiusOf;
        return {
          id: p.id,
          position: [p.lng, p.lat],
          fillColor: dimmed ? dim(fill) : fill,
          lineColor: dimmed ? dim(OUTLINE) : OUTLINE,
          radius: hovered || (hasSelection && sel) ? radius + 2 : radius,
          lineWidth,
          item: {
            id: p.id,
            kind: p.kind,
            label: p.label,
            role: sublabel ? `${roleOf(p.kind)} · ${sublabel}` : roleOf(p.kind),
          },
        };
      });
    return {
      type: 'scatter',
      id,
      data,
      props: { radiusUnits: 'pixels', lineWidthUnits: 'pixels', stroked: true, filled: true, pickable: true },
    };
  };

  const isCommute = (r: MapRoute) => r.kind === 'leg' && r.carried === false;
  const vehicles = movers.filter((m) => m.kind === 'vehicle');
  const groups: Group[] = [
    { key: 'routes-baseline', build: pathSpec('routes-baseline', (r) => r.kind === 'baseline', () => BASELINE, () => BASELINE_WIDTH, () => roleOf('baseline')) },
    // A journey carrier's whole commute: thin, in its colour, below the thick carried part.
    { key: 'routes-commute', build: pathSpec('routes-commute', isCommute, (r) => toneColor(r.tone), () => COMMUTE_WIDTH, () => 'Whole commute') },
    {
      key: 'routes-leg',
      build: pathSpec(
        'routes-leg',
        (r) => r.kind === 'leg' && !isCommute(r),
        (r) => toneColor(r.tone),
        (r) => (r.carried ? CARRIED_WIDTH : LEG_WIDTH),
        () => roleOf('leg'),
      ),
    },
    {
      key: 'businesses',
      build: scatterSpec('places-business', places.filter((p) => p.kind === 'business'), visible.businesses, BUSINESS_FILL, 6),
    },
    {
      key: 'homes',
      build: scatterSpec('places-home', places.filter((p) => p.kind === 'home'), visible.homes, HOME_FILL, 4),
    },
    {
      key: 'vehicles',
      build: scatterSpec('movers-vehicle', vehicles, true, (m: MapMover) => vehicleColor(m.tone), VEHICLE_RADIUS, VEHICLE_OUTLINE_WIDTH),
    },
  ];
  // A carried package rides on its carrier's marker as a badge (when that vehicle is on the map);
  // every other package is drawn at its own position, as before.
  const vehicleById = new Map(vehicles.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng)).map((v) => [v.id, v]));
  const allPackages = movers.filter((m) => m.kind === 'package');
  const riding = allPackages.filter((m) => m.carrierId && vehicleById.has(m.carrierId));
  const packages = allPackages.filter((m) => !riding.includes(m));
  const allStops = (input.stops ?? []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const groupsOfStops = stopGroups(allStops.filter((s) => !s.symbol));
  const symbols = allStops.filter((s) => s.symbol).sort((a, b) => a.n - b.n);
  const journey = allStops.length > 0;
  const zoom = input.zoom ?? NYC_ZOOM;
  // Network view (#780): a package waiting overnight at its relay point or delivered at its recipient
  // gets the diamond or the flag at that business, with the package dot on the glyph's rim.
  const waiting = journey || !visible.packages ? [] : waitingGroups(packages);
  // With journey stops the package is drawn after them (a ring), so it never hides under a stop.
  if (!journey) {
    const drawn = packages.map((m) => {
      if (!m.waiting || !Number.isFinite(m.lat) || !Number.isFinite(m.lng)) return m;
      const [lng, lat] = offsetByPx([m.lng, m.lat], PACKAGE_BADGE_OFFSET[0], PACKAGE_BADGE_OFFSET[1], zoom);
      return { ...m, lng, lat };
    });
    groups.push({ key: 'packages', build: scatterSpec('movers-package', drawn, visible.packages, PACKAGE_FILL, 5) });
  }

  const nonEmpty = (s: LayerSpec | null): s is LayerSpec => s !== null && s.data.length > 0;
  const base = groups.map((g) => g.build(false)).filter(nonEmpty);
  const badges = badgeSpecs(vehicles, (id) => hasSelection && !selected.has(id));
  const stops = [...stopSpecs(groupsOfStops, hoveredId), ...symbolSpecs(symbols)];
  const ring = journey && visible.packages ? packageRingSpecs(packages, groupsOfStops, symbols, hoveredId) : [];
  const riders = visible.packages
    ? packageBadgeSpecs(riding, vehicleById, zoom, hoveredId, (m) =>
        !journey && hasSelection && !selected.has(m.id) && !selected.has(m.carrierId!))
    : [];
  // A waiting group is dimmed with a selection that holds none of its packages nor its business.
  const groupDimmed = (g: WaitingGroup) =>
    hasSelection && !g.packageIds.some((id) => selected.has(id)) && !places.some((p) => selected.has(p.id) && samePlace([p.lng, p.lat], g.position));
  const waitGlyphs = waitingSymbolSpecs(waiting, groupDimmed);
  const waitLabels: NameCandidate[] = waiting
    .filter((g) => g.kind === 'overnight' && !groupDimmed(g))
    .map((g) => ({ id: `waiting-${g.packageIds[0]}`, text: overnightLabel(g.packageIds.length), lng: g.position[0], lat: g.position[1], gap: WAITING_SYMBOL_SIZE / 2 + 4, always: true }));
  const names = (alreadyNamed: ReadonlySet<string>) =>
    nameSpecs(input, groupsOfStops, symbols, alreadyNamed, (id) => !hasSelection || selected.has(id), waitLabels);
  if (!hasSelection) {
    const n = names(new Set());
    return journey
      ? [...base, ...badges, ...n.places, ...stops, ...n.symbols, ...ring, ...riders]
      : [...base, ...waitGlyphs, ...badges, ...riders, ...n.places, ...n.waiting, ...stops, ...n.symbols, ...ring];
  }

  const top = groups
    .map((g) => g.build(true))
    .filter(nonEmpty)
    .map((s) => ({ ...s, id: `${s.id}-selected` }) as LayerSpec);

  const labels: TextDatum[] = top.flatMap((s) =>
    s.type === 'scatter' ? s.data.map((d) => ({ id: d.id, position: d.position, text: d.item.label, color: LABEL })) : [],
  );
  const labelSpec: TextSpec[] = labels.length
    ? [
        {
          type: 'text',
          id: 'labels-selected',
          data: labels,
          props: { ...NAME_TEXT_PROPS, getPixelOffset: [0, -16], getAlignmentBaseline: 'bottom' },
        },
      ]
    : [];

  const n = names(new Set(labels.map((l) => l.id)));
  return journey
    ? [...base, ...top, ...badges, ...labelSpec, ...n.places, ...stops, ...n.symbols, ...ring, ...riders]
    : [...base, ...top, ...waitGlyphs, ...badges, ...riders, ...labelSpec, ...n.places, ...n.waiting, ...stops, ...n.symbols, ...ring];
}

/** Network packages waiting at one business for one reason (overnight or delivered), in package ID order. */
type WaitingGroup = { kind: NonNullable<MapMover['waiting']>; position: [number, number]; packageIds: string[] };

function waitingGroups(packages: MapMover[]): WaitingGroup[] {
  const groups: WaitingGroup[] = [];
  for (const m of packages) {
    if (!m.waiting || !Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
    const position: [number, number] = [m.lng, m.lat];
    const g = groups.find((x) => x.kind === m.waiting && samePlace(x.position, position));
    if (g) g.packageIds.push(m.id);
    else groups.push({ kind: m.waiting, position, packageIds: [m.id] });
  }
  for (const g of groups) g.packageIds.sort();
  return groups;
}

/**
 * Network view (#780): `movers-package-waiting`, the relay diamond where packages wait overnight and
 * the flag where they were delivered, one glyph per business and reason, in ink with a white outline.
 * Not pickable: the business underneath and the package dot keep their tooltips.
 */
function waitingSymbolSpecs(groups: WaitingGroup[], dimmed: (g: WaitingGroup) => boolean): TextSpec[] {
  if (groups.length === 0) return [];
  const data: TextDatum[] = groups.map((g) => ({
    id: `waiting-${g.packageIds[0]}`,
    position: g.position,
    text: WAITING_GLYPH[g.kind],
    color: dimmed(g) ? dim(RELAY_INK) : RELAY_INK,
  }));
  return [
    {
      type: 'text',
      id: 'movers-package-waiting',
      data,
      props: {
        sizeUnits: 'pixels',
        getSize: WAITING_SYMBOL_SIZE,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: MAP_FONT_FAMILY,
        characterSet: Object.values(WAITING_GLYPH),
        outlineWidth: 3,
        outlineColor: [255, 255, 255, 255],
        fontSettings: { sdf: true },
        pickable: false,
      },
    },
  ];
}

/**
 * The letter on each vehicle that has a `badge` (journey carriers: A, B; network carriers: the first
 * letter of the first name), white and centred on the marker. Dimmed with its vehicle. Empty without badges.
 */
function badgeSpecs(vehicles: MapMover[], dimmed: (id: string) => boolean): TextSpec[] {
  const data: TextDatum[] = vehicles
    .filter((m) => m.badge?.trim() && Number.isFinite(m.lat) && Number.isFinite(m.lng))
    .map((m) => ({ id: m.id, position: [m.lng, m.lat], text: m.badge!.trim(), color: dimmed(m.id) ? dim(BADGE_TEXT) : BADGE_TEXT }));
  if (data.length === 0) return [];
  return [
    {
      type: 'text',
      id: 'movers-vehicle-badge',
      data,
      props: {
        sizeUnits: 'pixels',
        getSize: VEHICLE_LETTER_SIZE,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: MAP_FONT_FAMILY,
        fontWeight: MAP_BOLD_WEIGHT,
        // The vehicle underneath is pickable; the letter must not steal its hover/click.
        pickable: false,
      },
    },
  ];
}

/**
 * The `labels-places` layer (names) and the `stops-label` layer (the journey symbols' short labels),
 * placed together by `placeNames` so they never overlap. Names: the `alwaysLabelIds` places, then (with
 * `labelBusinesses`) the visible businesses for which `keep` holds, minus those `alreadyNamed`. A place
 * whose symbol label already carries its name ("Overnight · Roastery") is not named again. A name or
 * label at a journey stop sits outside the stop and the package ring around it. The swap label goes
 * below the swap symbol, the other symbol labels above their symbol when there is room.
 */
function nameSpecs(
  input: BuildLayerInput,
  groups: StopGroup[],
  symbols: MapStop[],
  alreadyNamed: ReadonlySet<string>,
  keep: (id: string) => boolean,
  waitLabels: NameCandidate[] = [],
): { places: TextSpec[]; symbols: TextSpec[]; waiting: TextSpec[] } {
  const always = new Set(input.alwaysLabelIds ?? []);
  const symbolsAt = (pos: [number, number]) => symbols.filter((s) => samePlace([s.lng, s.lat], pos));
  const gapAt = (pos: [number, number]) => {
    if (symbolsAt(pos).length) return SYMBOL_LABEL_GAP;
    const g = groupAt(pos, groups);
    return g ? g.radius + PACKAGE_RING_GAP + PACKAGE_RING_WIDTH / 2 + PACKAGE_HALO_WIDTH + 2 : NAME_GAP;
  };
  const symbolCandidates: NameCandidate[] = symbols.map((s) => {
    const pos: [number, number] = [s.lng, s.lat];
    const shared = symbolsAt(pos).length > 1;
    return s.symbol === 'swap'
      ? { id: s.id, text: s.label, lng: s.lng, lat: s.lat, gap: SYMBOL_LABEL_GAP, always: true, dx: shared ? SWAP_DX : 0, sides: [1, -1] }
      : { id: s.id, text: s.label, lng: s.lng, lat: s.lat, gap: SYMBOL_LABEL_GAP, always: true };
  });
  // The swap labels first, so they claim the spot below the relay before the relay's own label looks.
  symbolCandidates.sort((a, b) => Number(b.dx !== undefined) - Number(a.dx !== undefined));
  const namedBySymbol = (p: MapPlace) => symbolsAt([p.lng, p.lat]).some((s) => p.label.trim() && s.label.includes(p.label.trim()));
  const placeCandidates: NameCandidate[] = input.places
    .filter((p) => !alreadyNamed.has(p.id) && !namedBySymbol(p))
    .filter((p) => always.has(p.id) || (input.labelBusinesses && input.visible.businesses && p.kind === 'business' && keep(p.id)))
    .map((p) => ({ id: p.id, text: p.label, lng: p.lng, lat: p.lat, gap: gapAt([p.lng, p.lat]), always: always.has(p.id) }));
  const candidates = [...symbolCandidates, ...waitLabels, ...placeCandidates];
  if (candidates.length === 0) return { places: [], symbols: [], waiting: [] };
  const placed = placeNames(candidates, input.zoom ?? NYC_ZOOM);
  const symbolIds = new Set(symbols.map((s) => s.id));
  const datum = (n: PlacedName): TextDatum => ({ id: n.id, position: n.position, text: n.text, color: LABEL, offset: n.offset });
  const waitIds = new Set(waitLabels.map((c) => c.id));
  const placeData = placed.filter((n) => !symbolIds.has(n.id) && !waitIds.has(n.id)).map(datum);
  const waitData = placed.filter((n) => waitIds.has(n.id)).map(datum);
  // Symbol labels in stop order, whatever order they were placed in.
  const symbolData = symbols.flatMap((s) => placed.filter((n) => n.id === s.id).map(datum));
  return {
    places: placeData.length
      ? [{ type: 'text', id: 'labels-places', data: placeData, props: { ...NAME_TEXT_PROPS, getAlignmentBaseline: 'center' } }]
      : [],
    symbols: symbolData.length
      ? [
          {
            type: 'text',
            id: 'stops-label',
            data: symbolData,
            // `auto`: the labels carry "·" and names with accents, outside deck.gl's default ASCII set.
            props: { ...NAME_TEXT_PROPS, getAlignmentBaseline: 'center', fontWeight: MAP_BOLD_WEIGHT, characterSet: 'auto' },
          },
        ]
      : [],
    // Network view (#780): "Overnight" next to the relay diamond, placed with the names so none overlap.
    waiting: waitData.length
      ? [
          {
            type: 'text',
            id: 'movers-package-label',
            data: waitData,
            props: { ...NAME_TEXT_PROPS, getAlignmentBaseline: 'center', fontWeight: MAP_BOLD_WEIGHT, characterSet: 'auto' },
          },
        ]
      : [],
  };
}

/** Stops sharing one place, in stop order. One circle size per place, larger when stops share it. */
type StopGroup = { position: [number, number]; stops: MapStop[]; radius: number };

/** Two points closer than this (degrees, about 1 m) are one place. */
const SAME_PLACE_DEG = 1e-5;

function samePlace(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < SAME_PLACE_DEG && Math.abs(a[1] - b[1]) < SAME_PLACE_DEG;
}

function groupAt(position: [number, number], groups: StopGroup[]): StopGroup | undefined {
  return groups.find((g) => samePlace(g.position, position));
}

function stopGroups(stops: MapStop[]): StopGroup[] {
  const ok = stops
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .slice()
    .sort((a, b) => a.n - b.n);
  const groups: StopGroup[] = [];
  for (const s of ok) {
    const position: [number, number] = [s.lng, s.lat];
    const g = groupAt(position, groups);
    if (g) g.stops.push(s);
    else groups.push({ position, stops: [s], radius: STOP_RADIUS });
  }
  for (const g of groups) g.radius = STOP_RADIUS + STOP_SHARED_GROWTH * (g.stops.length - 1);
  return groups;
}

/** "Stops 2 and 3" / "Stops 1, 2 and 3" */
function stopsRole(ns: number[]): string {
  return ns.length === 1 ? `Stop ${ns[0]}` : `Stops ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/**
 * Stop circles with their numbers (Business and Employee previews), in stop order. Empty when there are no stops. Stops that
 * share a place (the relay drop and the next-morning pickup) get one larger circle each, drawn on top
 * of each other, with their numbers side by side, and a tooltip naming both.
 */
function stopSpecs(groups: StopGroup[], hoveredId: string | null): LayerSpec[] {
  if (groups.length === 0) return [];
  const circles: ScatterDatum[] = [];
  const numbers: TextDatum[] = [];
  for (const g of groups) {
    const shared = g.stops.length > 1;
    const hovered = g.stops.some((s) => s.id === hoveredId);
    g.stops.forEach((s, i) => {
      circles.push({
        id: s.id,
        position: g.position,
        fillColor: RELAY_INK,
        lineColor: OUTLINE,
        radius: hovered ? g.radius + 2 : g.radius,
        lineWidth: 2,
        item: {
          id: s.id,
          kind: 'stop',
          label: shared ? g.stops.map((x) => x.label).join(' · then ') : s.label,
          role: stopsRole(shared ? g.stops.map((x) => x.n) : [s.n]),
        },
      });
      const dx = (i - (g.stops.length - 1) / 2) * STOP_NUMBER_SPACING;
      numbers.push({ id: s.id, position: g.position, text: String(s.n), color: BADGE_TEXT, offset: [dx, 0] });
    });
  }
  return [
    {
      type: 'scatter',
      id: 'stops',
      data: circles,
      props: { radiusUnits: 'pixels', lineWidthUnits: 'pixels', stroked: true, filled: true, pickable: true },
    },
    {
      type: 'text',
      id: 'stops-number',
      data: numbers,
      props: {
        sizeUnits: 'pixels',
        getSize: 12,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: MAP_FONT_FAMILY,
        fontWeight: MAP_BOLD_WEIGHT,
        // The circle underneath is pickable; the number must not steal its hover/click.
        pickable: false,
      },
    },
  ];
}

/**
 * The journey symbols as glyphs (`SYMBOL_GLYPH`) in ink with a white outline, in stop order: sender
 * square, relay diamond, swap, recipient flag. A swap that shares its place with another symbol (the
 * relay diamond) sits SWAP_DX to the right of it, so both stay visible. Pickable: the tooltip is the
 * stop's label and `detail`.
 */
function symbolSpecs(symbols: MapStop[]): TextSpec[] {
  if (symbols.length === 0) return [];
  const data: TextDatum[] = symbols.map((s) => {
    const position: [number, number] = [s.lng, s.lat];
    const shared = symbols.some((o) => o.id !== s.id && samePlace([o.lng, o.lat], position));
    return {
      id: s.id,
      position,
      text: SYMBOL_GLYPH[s.symbol!],
      color: RELAY_INK,
      offset: s.symbol === 'swap' && shared ? [SWAP_DX, 0] : [0, 0],
      item: { id: s.id, kind: 'stop', label: s.label, role: s.detail?.trim() || SYMBOL_ROLE[s.symbol!] },
    };
  });
  return [
    {
      type: 'text',
      id: 'stops-symbol',
      data,
      props: {
        sizeUnits: 'pixels',
        getSize: SYMBOL_SIZE,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        // The glyphs are not in Inter; the browser falls back to a system symbol font.
        fontFamily: MAP_FONT_FAMILY,
        characterSet: Object.values(SYMBOL_GLYPH),
        outlineWidth: 3,
        outlineColor: [255, 255, 255, 255],
        fontSettings: { sdf: true },
        pickable: true,
      },
    },
  ];
}

/**
 * The journey package while it waits (not carried), drawn after everything else and never dimmed: a soft
 * white halo ring (`movers-package-halo`), then a thick orange ring (`movers-package`) around the symbol
 * or numbered stop it waits at (outside the glyph or circle, so it stays readable): the sender square,
 * the Overnight diamond, the delivered flag. A package away from any stop whose carrier is not on the map
 * gets a ring of its own. Hollow, so what is under it stays visible and pickable.
 */
function packageRingSpecs(packages: MapMover[], groups: StopGroup[], symbols: MapStop[], hoveredId: string | null): LayerSpec[] {
  const rings = packages
    .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))
    .map((m) => {
      const position: [number, number] = [m.lng, m.lat];
      const g = groupAt(position, groups);
      const atSymbol = symbols.filter((s) => samePlace([s.lng, s.lat], position));
      const hovered = m.id === hoveredId || !!g?.stops.some((s) => s.id === hoveredId) || atSymbol.some((s) => s.id === hoveredId);
      const radius = (atSymbol.length ? PACKAGE_RING_AT_SYMBOL : g ? g.radius + PACKAGE_RING_GAP : PACKAGE_RING_ALONE) + (hovered ? 2 : 0);
      return { m, position, radius };
    });
  if (rings.length === 0) return [];
  const props = { radiusUnits: 'pixels', lineWidthUnits: 'pixels', stroked: true, filled: false };
  const halo: ScatterDatum[] = rings.map(({ m, position, radius }) => ({
    id: m.id,
    position,
    fillColor: PACKAGE_HALO,
    lineColor: PACKAGE_HALO,
    radius,
    lineWidth: PACKAGE_RING_WIDTH + 2 * PACKAGE_HALO_WIDTH,
    item: { id: m.id, kind: m.kind, label: m.label, role: roleOf(m.kind) },
  }));
  const ring: ScatterDatum[] = rings.map(({ m, position, radius }) => ({
    id: m.id,
    position,
    fillColor: PACKAGE_FILL,
    lineColor: PACKAGE_FILL,
    radius,
    lineWidth: PACKAGE_RING_WIDTH,
    item: { id: m.id, kind: m.kind, label: m.label, role: roleOf(m.kind) },
  }));
  return [
    { type: 'scatter', id: 'movers-package-halo', data: halo, props: { ...props, pickable: false } },
    { type: 'scatter', id: 'movers-package', data: ring, props: { ...props, pickable: true } },
  ];
}

/**
 * Each carried package as a small orange badge (`movers-package-badge`) on its carrier's marker: at the
 * vehicle's position as drawn this frame (tweened or polled), PACKAGE_BADGE_OFFSET pixels up and right
 * at `zoom`, so the package visibly rides with its carrier and never hides the carrier's letter.
 * Pickable: the tooltip is the package. `dimmed`: outside the network selection.
 */
function packageBadgeSpecs(
  riding: MapMover[],
  vehicleById: ReadonlyMap<string, MapMover>,
  zoom: number,
  hoveredId: string | null,
  dimmed: (m: MapMover) => boolean,
): ScatterSpec[] {
  const data: ScatterDatum[] = riding.map((m) => {
    const v = vehicleById.get(m.carrierId!)!;
    const off = dimmed(m);
    return {
      id: m.id,
      position: offsetByPx([v.lng, v.lat], PACKAGE_BADGE_OFFSET[0], PACKAGE_BADGE_OFFSET[1], zoom),
      fillColor: off ? dim(PACKAGE_FILL) : PACKAGE_FILL,
      lineColor: off ? dim(OUTLINE) : OUTLINE,
      radius: m.id === hoveredId ? PACKAGE_BADGE_RADIUS + 2 : PACKAGE_BADGE_RADIUS,
      lineWidth: PACKAGE_BADGE_OUTLINE_WIDTH,
      item: { id: m.id, kind: m.kind, label: m.label, role: `${roleOf(m.kind)} · with ${v.label}` },
    };
  });
  if (data.length === 0) return [];
  return [
    {
      type: 'scatter',
      id: 'movers-package-badge',
      data,
      props: { radiusUnits: 'pixels', lineWidthUnits: 'pixels', stroked: true, filled: true, pickable: true },
    },
  ];
}
