// Pure layer builder: plain descriptors only, no deck.gl import, so it tests in Node without
// WebGL. GoogleBaseMap.tsx turns each descriptor into a PathLayer / ScatterplotLayer / TextLayer.
import polyline from '@mapbox/polyline';
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
export type TextDatum = { id: string; position: [number, number]; text: string; color: RGBA };

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
  /** Journey stops: drawn above everything, never dimmed, ignore the layer toggles. */
  stops?: MapStop[];
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
export const BUSINESS_FILL: RGBA = [21, 27, 38, 235]; // #151B26
export const HOME_FILL: RGBA = [146, 155, 168, 210];
export const VEHICLE_FILL: RGBA = [40, 97, 138, 255];
export const PACKAGE_FILL: RGBA = [196, 122, 26, 255];
export const OUTLINE: RGBA = [255, 255, 255, 255];
export const LABEL: RGBA = [21, 27, 38, 255];
/** Alpha for items outside the current selection. */
export const DIM_ALPHA = 40;

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
  const [r, g, b] = toneColor(tone);
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
 * Journey stops (`stops`, `stops-number`) always come last, are never dimmed and ignore `visible`.
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
    fill: RGBA,
    radius: number,
  ) => (sel: boolean): LayerSpec | null => {
    if (!shown) return null;
    const data: ScatterDatum[] = items
      .filter((p) => inPass(sel, p.id))
      .map((p) => {
        const dimmed = hasSelection && !sel;
        const hovered = p.id === hoveredId;
        const sublabel = (p as MapPlace).sublabel;
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
    { key: 'vehicles', build: scatterSpec('movers-vehicle', movers.filter((m) => m.kind === 'vehicle'), true, VEHICLE_FILL, 6) },
    {
      key: 'packages',
      build: scatterSpec('movers-package', movers.filter((m) => m.kind === 'package'), visible.packages, PACKAGE_FILL, 5),
    },
  ];

  const nonEmpty = (s: LayerSpec | null): s is LayerSpec => s !== null && s.data.length > 0;
  const base = groups.map((g) => g.build(false)).filter(nonEmpty);
  const stops = stopSpecs(input.stops ?? [], hoveredId);
  if (!hasSelection) return [...base, ...stops];

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
          props: {
            sizeUnits: 'pixels',
            getSize: 12,
            getPixelOffset: [0, -16],
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'bottom',
            fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
            outlineWidth: 4,
            outlineColor: [255, 255, 255, 230],
            fontSettings: { sdf: true },
            pickable: false,
          },
        },
      ]
    : [];

  return [...base, ...top, ...labelSpec, ...stops];
}

/** Numbered stop circles plus their numbers, in stop order. Empty when there are no stops. */
function stopSpecs(stops: MapStop[], hoveredId: string | null): LayerSpec[] {
  const ok = stops
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .slice()
    .sort((a, b) => a.n - b.n);
  if (ok.length === 0) return [];
  const circles: ScatterDatum[] = ok.map((s) => ({
    id: s.id,
    position: [s.lng, s.lat],
    fillColor: STOP_FILL,
    lineColor: OUTLINE,
    radius: s.id === hoveredId ? STOP_RADIUS + 2 : STOP_RADIUS,
    lineWidth: 2,
    item: { id: s.id, kind: 'stop', label: s.label, role: `Stop ${s.n}` },
  }));
  const numbers: TextDatum[] = ok.map((s) => ({ id: s.id, position: [s.lng, s.lat], text: String(s.n), color: STOP_TEXT }));
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
