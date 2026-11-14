// Pure layer builder: plain descriptors only, no deck.gl import, so it tests in Node without
// WebGL. GoogleBaseMap.tsx turns each descriptor into a PathLayer / ScatterplotLayer / TextLayer.
import polyline from '@mapbox/polyline';
import { NYC_ZOOM } from './mapStyle';
import type { LayerVisibility, MapItem, MapMover, MapPlace, MapRoute, MapStop, RouteTone } from './types';

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
/** `offset`: pixel offset from `position` (x right, y down); none = centred on it. */
export type TextDatum = { id: string; position: [number, number]; text: string; color: RGBA; offset?: [number, number] };

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

// Palette: accent for routes, everything else quiet (docs/mvp2-ui-redesign.md §1).
export const ACCENT: RGBA = [40, 97, 138, 235]; // #28618A
/** Journey leg colors: leg 1 is the accent, leg 2 a raspberry far from it in hue (both ≥ 3:1 on white). */
export const LEG1: RGBA = ACCENT; // #28618A
export const LEG2: RGBA = [192, 58, 100, 235]; // #C03A64
/** Normal commute: thinner, fainter and drawn below the legs, so it reads as background. */
export const BASELINE: RGBA = [138, 148, 160, 120];
export const BASELINE_WIDTH = 2;
export const LEG_WIDTH = 4;
export const STOP_FILL: RGBA = [21, 27, 38, 255]; // #151B26
export const STOP_TEXT: RGBA = [255, 255, 255, 255];
export const STOP_RADIUS = 10;
/** Extra radius per additional stop sharing one place (relay drop and next-morning pickup). */
export const STOP_SHARED_GROWTH = 5;
/** Horizontal distance between two stop numbers drawn in one shared circle. */
export const STOP_NUMBER_SPACING = 12;
/** The journey package ring: this far outside the stop circle it surrounds, and its line width. */
export const PACKAGE_RING_GAP = 6;
export const PACKAGE_RING_WIDTH = 3;
/** Ring radius of a journey package that is not at a stop (it surrounds its carrier's dot). */
export const PACKAGE_RING_ALONE = 10;
export const BUSINESS_FILL: RGBA = [21, 27, 38, 235]; // #151B26
export const HOME_FILL: RGBA = [146, 155, 168, 210];
export const VEHICLE_FILL: RGBA = [40, 97, 138, 255];
export const PACKAGE_FILL: RGBA = [196, 122, 26, 255];
export const OUTLINE: RGBA = [255, 255, 255, 255];
export const LABEL: RGBA = [21, 27, 38, 255];
/** Alpha for items outside the current selection. */
export const DIM_ALPHA = 40;

// ---------- Names on the map ----------
/** Font size of every name on the map (selected labels and business names alike). */
export const NAME_SIZE = 12;
/** Height of a name's box in pixels: one 12 px line plus its white outline. */
export const NAME_BOX_HEIGHT = 16;
/** Pixels between a network marker's centre and the near edge of its name's box. */
export const NAME_GAP = 14;

/** One text style for every name, so business names read like the selected labels. */
const NAME_TEXT_PROPS = {
  sizeUnits: 'pixels',
  getSize: NAME_SIZE,
  getTextAnchor: 'middle',
  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
  outlineWidth: 4,
  outlineColor: [255, 255, 255, 230],
  fontSettings: { sdf: true },
  pickable: false,
} as const;

const NARROW = new Set([...'iljtfrI.,:;\'!|() -']);
const WIDE = new Set([...'mwMW@&']);

/**
 * Estimated width in pixels of a name drawn at NAME_SIZE in IBM Plex Sans, plus its outline. It errs on
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
  /** Drawn even when there is no free spot (then above the marker). */
  always?: boolean;
};
export type PlacedName = { id: string; text: string; position: [number, number]; offset: [number, number]; box: NameBox };

export function boxesOverlap(a: NameBox, b: NameBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * Which names are drawn, and where, at this zoom. Each name tries above its marker, then below; it is
 * drawn at the first spot whose box overlaps no name already placed, so no two drawn boxes overlap.
 * `always` names go first and are drawn even without a free spot. The rest follow in input order and
 * are dropped when both spots are taken. Zooming in spreads the markers apart while the boxes keep
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
    const spots = [-1, 1].map((side) => {
      const dy = side * (c.gap + h / 2);
      return { offset: [0, dy] as [number, number], box: { x0: x - w / 2, x1: x + w / 2, y0: y + dy - h / 2, y1: y + dy + h / 2 } };
    });
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

/** Decode a Google encoded polyline into deck.gl order ([lng, lat]). */
export function decodePath(encoded: string): [number, number][] {
  return polyline.decode(encoded).map(([lat, lng]) => [lng, lat] as [number, number]);
}

/** Map color for a route tone (no tone = leg 1 = accent). */
export function toneColor(tone: RouteTone | undefined): RGBA {
  return tone === 'leg2' ? LEG2 : LEG1;
}

/** CSS color for a tone, so the journey legend shows exactly the map's colors. */
export function toneLabelColor(tone: RouteTone | undefined): string {
  return hexOf(toneColor(tone));
}

/**
 * Vehicle fill for a tone: `leg2` = LEG2, so a journey's second carrier has its leg's colour;
 * `leg1` or no tone = VEHICLE_FILL (the network view is unchanged).
 */
export function vehicleColor(tone: RouteTone | undefined): RGBA {
  return tone === 'leg2' ? LEG2 : VEHICLE_FILL;
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
  key: 'routes-baseline' | 'routes-leg' | 'businesses' | 'homes' | 'vehicles' | 'packages';
  build(selected: boolean): LayerSpec | null;
};

/**
 * Layer specs in draw order: baseline routes, leg routes, businesses, homes, vehicles, packages.
 * With a non-empty selection, items that are not selected (and, for routes, not owned by a selected
 * ID) are dimmed, and the selected items are drawn again as `<id>-selected` layers on top, followed
 * by a text layer labelling the selected places and movers. Hidden layers and empty layers are omitted.
 * Then `labels-places`: the `alwaysLabelIds` places, and with `labelBusinesses` the businesses that are
 * not dimmed, as many as `placeNames` fits at `zoom` (homes, vehicles and packages get no name).
 * Journey stops (`stops`, `stops-number`) come next, are never dimmed and ignore `visible`. With stops,
 * the package layer (`movers-package`) is drawn after them as a ring around the stop it waits at.
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

  const pathSpec = (kind: MapRoute['kind'], colorOf: (r: MapRoute) => RGBA, width: number) => (
    sel: boolean,
  ): LayerSpec | null => {
    if (!visible.routes) return null;
    const data: PathDatum[] = routes
      .filter((r) => r.kind === kind && r.path.length >= 2 && inPass(sel, r.id, r.ownerIds))
      .map((r) => ({
        id: r.id,
        path: r.path,
        color: hasSelection && !sel ? dim(colorOf(r)) : colorOf(r),
        width: r.id === hoveredId ? width + 2 : width,
        item: { id: r.id, kind: r.kind, label: kind === 'leg' ? 'Delivery route' : 'Commute', role: roleOf(r.kind) },
      }));
    return {
      type: 'path',
      id: `routes-${kind}`,
      data,
      props: { widthUnits: 'pixels', capRounded: true, jointRounded: true, pickable: true },
    };
  };

  const scatterSpec = <T extends MapPlace | MapMover>(
    id: string,
    items: T[],
    shown: boolean,
    fillOf: RGBA | ((item: T) => RGBA),
    radius: number,
  ) => (sel: boolean): LayerSpec | null => {
    if (!shown) return null;
    const data: ScatterDatum[] = items
      .filter((p) => inPass(sel, p.id))
      .map((p) => {
        const dimmed = hasSelection && !sel;
        const hovered = p.id === hoveredId;
        const sublabel = (p as MapPlace).sublabel;
        const fill = typeof fillOf === 'function' ? fillOf(p) : fillOf;
        return {
          id: p.id,
          position: [p.lng, p.lat],
          fillColor: dimmed ? dim(fill) : fill,
          lineColor: dimmed ? dim(OUTLINE) : OUTLINE,
          radius: hovered || (hasSelection && sel) ? radius + 2 : radius,
          lineWidth: 1.5,
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

  const groups: Group[] = [
    { key: 'routes-baseline', build: pathSpec('baseline', () => BASELINE, BASELINE_WIDTH) },
    { key: 'routes-leg', build: pathSpec('leg', (r) => toneColor(r.tone), LEG_WIDTH) },
    {
      key: 'businesses',
      build: scatterSpec('places-business', places.filter((p) => p.kind === 'business'), visible.businesses, BUSINESS_FILL, 6),
    },
    {
      key: 'homes',
      build: scatterSpec('places-home', places.filter((p) => p.kind === 'home'), visible.homes, HOME_FILL, 4),
    },
    { key: 'vehicles', build: scatterSpec('movers-vehicle', movers.filter((m) => m.kind === 'vehicle'), true, (m: MapMover) => vehicleColor(m.tone), 6) },
  ];
  const packages = movers.filter((m) => m.kind === 'package');
  const groupsOfStops = stopGroups(input.stops ?? []);
  // With journey stops the package is drawn after them (a ring), so it never hides under a stop.
  if (groupsOfStops.length === 0) {
    groups.push({ key: 'packages', build: scatterSpec('movers-package', packages, visible.packages, PACKAGE_FILL, 5) });
  }

  const nonEmpty = (s: LayerSpec | null): s is LayerSpec => s !== null && s.data.length > 0;
  const base = groups.map((g) => g.build(false)).filter(nonEmpty);
  const stops = stopSpecs(groupsOfStops, hoveredId);
  const ring = groupsOfStops.length && visible.packages ? packageRingSpec(packages, groupsOfStops, hoveredId) : [];
  const names = (alreadyNamed: ReadonlySet<string>): LayerSpec[] =>
    nameSpecs(input, groupsOfStops, alreadyNamed, (id) => !hasSelection || selected.has(id));
  if (!hasSelection) return [...base, ...names(new Set()), ...stops, ...ring];

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

  return [...base, ...top, ...labelSpec, ...names(new Set(labels.map((l) => l.id))), ...stops, ...ring];
}

/**
 * The `labels-places` layer: the `alwaysLabelIds` places, then (with `labelBusinesses`) the visible
 * businesses for which `keep` holds, minus those `alreadyNamed`, placed by `placeNames` at the zoom.
 * A name at a journey stop sits outside the stop circle and the package ring around it.
 */
function nameSpecs(
  input: BuildLayerInput,
  groups: StopGroup[],
  alreadyNamed: ReadonlySet<string>,
  keep: (id: string) => boolean,
): TextSpec[] {
  const always = new Set(input.alwaysLabelIds ?? []);
  const gapAt = (p: MapPlace) => {
    const g = groupAt([p.lng, p.lat], groups);
    return g ? g.radius + PACKAGE_RING_GAP + PACKAGE_RING_WIDTH + 2 : NAME_GAP;
  };
  const candidates: NameCandidate[] = input.places
    .filter((p) => !alreadyNamed.has(p.id))
    .filter((p) => always.has(p.id) || (input.labelBusinesses && input.visible.businesses && p.kind === 'business' && keep(p.id)))
    .map((p) => ({ id: p.id, text: p.label, lng: p.lng, lat: p.lat, gap: gapAt(p), always: always.has(p.id) }));
  if (candidates.length === 0) return [];
  const placed = placeNames(candidates, input.zoom ?? NYC_ZOOM);
  if (placed.length === 0) return [];
  return [
    {
      type: 'text',
      id: 'labels-places',
      data: placed.map((n) => ({ id: n.id, position: n.position, text: n.text, color: LABEL, offset: n.offset })),
      props: { ...NAME_TEXT_PROPS, getAlignmentBaseline: 'center' },
    },
  ];
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
 * Numbered stop circles plus their numbers, in stop order. Empty when there are no stops. Stops that
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
        fillColor: STOP_FILL,
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
      numbers.push({ id: s.id, position: g.position, text: String(s.n), color: STOP_TEXT, offset: [dx, 0] });
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
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        fontWeight: 600,
        // The circle underneath is pickable; the number must not steal its hover/click.
        pickable: false,
      },
    },
  ];
}

/**
 * The journey package, drawn after the stops: a ring in the package colour around the stop it waits
 * at (outside the circle, so the numbers stay readable), or around its carrier's dot on the way.
 * Hollow, so the stop under it stays pickable.
 */
function packageRingSpec(packages: MapMover[], groups: StopGroup[], hoveredId: string | null): LayerSpec[] {
  const data: ScatterDatum[] = packages
    .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))
    .map((m) => {
      const position: [number, number] = [m.lng, m.lat];
      const g = groupAt(position, groups);
      const hovered = m.id === hoveredId || !!g?.stops.some((s) => s.id === hoveredId);
      const radius = (g ? g.radius + PACKAGE_RING_GAP : PACKAGE_RING_ALONE) + (hovered ? 2 : 0);
      return {
        id: m.id,
        position,
        fillColor: PACKAGE_FILL,
        lineColor: PACKAGE_FILL,
        radius,
        lineWidth: PACKAGE_RING_WIDTH,
        item: { id: m.id, kind: m.kind, label: m.label, role: roleOf(m.kind) },
      };
    });
  if (data.length === 0) return [];
  return [
    {
      type: 'scatter',
      id: 'movers-package',
      data,
      props: { radiusUnits: 'pixels', lineWidthUnits: 'pixels', stroked: true, filled: false, pickable: true },
    },
  ];
}
