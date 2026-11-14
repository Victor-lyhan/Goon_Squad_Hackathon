// Map legend rows for the MVP II simulator (docs/mvp2-ui-redesign.md §1). Pure: no React, no DOM.
// Every color and line width comes from the map's own layer constants, converted by `cssColor`, so
// the legend cannot drift from what the map draws. The legend describes layers only; it computes
// nothing about the run.
import {
  BASELINE,
  BASELINE_WIDTH,
  BUSINESS_FILL,
  DIM_ALPHA,
  HOME_FILL,
  LEG1,
  LEG2,
  LEG_WIDTH,
  PACKAGE_FILL,
  STOP_FILL,
  STOP_TEXT,
  VEHICLE_FILL,
  type RGBA,
} from '../../../map/layers';
import type { Focus, LayerVisibility } from '../workspaceModel';

export type LegendMode = 'network' | 'journey';
export type LegendShape = 'dot' | 'ring' | 'line' | 'numbered';

export type LegendRow = {
  key: string;
  label: string;
  shape: LegendShape;
  /** CSS color string, from `cssColor` of a map layer constant. */
  color: string;
  /** Line rows: the stroke width the map uses, in px. */
  width?: number;
  /** Numbered rows: the color of the number. */
  textColor?: string;
};

export type LegendInput = {
  mode: LegendMode;
  layers: LayerVisibility;
  hasSelection?: boolean;
  focus?: Focus;
};

export const ALL_HIDDEN_MESSAGE = 'All map layers are hidden. Turn a layer on in the left panel.';

/** The one conversion from a deck.gl RGBA (0–255 alpha) to a CSS color string. */
export function cssColor([r, g, b, a]: RGBA): string {
  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}

/** The same color as the map draws it for an item outside the selection. */
export function dimmed(c: RGBA): RGBA {
  return [c[0], c[1], c[2], Math.min(c[3], DIM_ALPHA)];
}

export function allLayersHidden(layers: LayerVisibility): boolean {
  return !layers.routes && !layers.businesses && !layers.homes && !layers.packages;
}

/** True when the legend should show only the "all layers hidden" line instead of rows. */
export function showsHiddenMessage(input: Pick<LegendInput, 'mode' | 'layers'>): boolean {
  return input.mode === 'network' && allLayersHidden(input.layers);
}

const dot = (key: string, label: string, c: RGBA): LegendRow => ({ key, label, shape: 'dot', color: cssColor(c) });
const line = (key: string, label: string, c: RGBA, width: number): LegendRow => ({
  key,
  label,
  shape: 'line',
  color: cssColor(c),
  width,
});

function networkRows({ layers, hasSelection, focus }: LegendInput): LegendRow[] {
  if (allLayersHidden(layers)) return [];
  const rows: LegendRow[] = [];
  if (layers.businesses) rows.push(dot('business', 'Network business · every one is a relay point', BUSINESS_FILL));
  if (layers.homes) rows.push(dot('home', 'Home neighborhood', HOME_FILL));
  // Vehicles have no toggle of their own: the map always draws them while anything is shown.
  rows.push(dot('vehicle', 'Commuter vehicle', VEHICLE_FILL));
  if (layers.packages) rows.push(dot('package', 'Package', PACKAGE_FILL));
  if (layers.routes) {
    rows.push(line('baseline', 'Normal commute', BASELINE, BASELINE_WIDTH));
    rows.push(line('route', 'Delivery route', LEG1, LEG_WIDTH));
  }
  const focused = focus !== undefined && focus.kind !== 'none';
  if (hasSelection || focused) {
    const what = hasSelection ? 'the selection' : 'this focus';
    rows.push(dot('dimmed', `Dimmed: not part of ${what}`, dimmed(BUSINESS_FILL)));
  }
  return rows;
}

function journeyRows(): LegendRow[] {
  return [
    { key: 'stop', label: 'Numbered stop, in journey order', shape: 'numbered', color: cssColor(STOP_FILL), textColor: cssColor(STOP_TEXT) },
    dot('package', 'Package', PACKAGE_FILL),
    dot('vehicle', 'Commuter vehicle', VEHICLE_FILL),
    line('baseline', 'Normal commute (faint)', BASELINE, BASELINE_WIDTH),
    line('leg1', 'Leg 1 route', LEG1, LEG_WIDTH),
    line('leg2', 'Leg 2 route', LEG2, LEG_WIDTH),
  ];
}

/**
 * The legend rows for what the map can show now, in a fixed order. Network mode follows the layer
 * toggles (no rows when every layer is off; see `showsHiddenMessage`) and adds a "Dimmed" row with a
 * selection or a focus. Journey mode always shows its six rows; the carrier names live in JourneyLegend.
 */
export function legendRows(input: LegendInput): LegendRow[] {
  return input.mode === 'journey' ? journeyRows() : networkRows(input);
}
