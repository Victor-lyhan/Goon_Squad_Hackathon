// Map legend rows for the simulator (docs/mvp2-ui-redesign.md §1, docs/mvp3.md P1/P4). Pure: no React,
// no DOM. Every color and line width comes from the map's own layer constants, converted by `cssColor`,
// so the legend cannot drift from what the map draws. The legend describes layers only; it computes
// nothing about the run.
//
// Network mode: MapLegend shows `legendRows`. Journey mode: MapLegend shows nothing; JourneyLegend lists
// the carriers and the `journeySymbolRows` (the map's symbols and the package, issue 699).
import {
  BASELINE,
  BASELINE_WIDTH,
  BUSINESS_FILL,
  DIM_ALPHA,
  HOME_FILL,
  LEG1,
  LEG_WIDTH,
  PACKAGE_FILL,
  PACKAGE_HALO,
  RELAY_INK,
  SYMBOL_GLYPH,
  VEHICLE_FILL,
  type RGBA,
} from '../../../map/layers';
import type { StopSymbol } from '../../../map/types';
import type { Focus } from '../workspaceModel';

export type LegendMode = 'network' | 'journey';
export type LegendShape = 'dot' | 'ring' | 'line';

export type LegendRow = {
  key: string;
  label: string;
  shape: LegendShape;
  /** CSS color string, from `cssColor` of a map layer constant. */
  color: string;
  /** Line rows: the stroke width the map uses, in px. */
  width?: number;
};

export type LegendInput = {
  mode: LegendMode;
  hasSelection?: boolean;
  focus?: Focus;
};

/** The one conversion from a deck.gl RGBA (0–255 alpha) to a CSS color string. */
export function cssColor([r, g, b, a]: RGBA): string {
  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}

/** The same color as the map draws it for an item outside the selection. */
export function dimmed(c: RGBA): RGBA {
  return [c[0], c[1], c[2], Math.min(c[3], DIM_ALPHA)];
}

const dot = (key: string, label: string, c: RGBA): LegendRow => ({ key, label, shape: 'dot', color: cssColor(c) });
const line = (key: string, label: string, c: RGBA, width: number): LegendRow => ({
  key,
  label,
  shape: 'line',
  color: cssColor(c),
  width,
});

function networkRows({ hasSelection, focus }: LegendInput): LegendRow[] {
  const rows: LegendRow[] = [
    dot('business', 'Network business · every one is a relay point', BUSINESS_FILL),
    dot('home', 'Home neighborhood', HOME_FILL),
    dot('vehicle', 'Carrier · letter = first name', VEHICLE_FILL),
    dot('package', 'Package · rides on its carrier, or waits at a business', PACKAGE_FILL),
    line('baseline', 'Normal commute', BASELINE, BASELINE_WIDTH),
    line('route', 'Delivery route', LEG1, LEG_WIDTH),
  ];
  const focused = focus !== undefined && focus.kind !== 'none';
  if (hasSelection || focused) {
    const what = hasSelection ? 'the selection' : 'this focus';
    rows.push(dot('dimmed', `Dimmed: not part of ${what}`, dimmed(BUSINESS_FILL)));
  }
  return rows;
}

/**
 * The legend rows for what the map shows now, in a fixed order. Network mode has its six rows and adds
 * a "Dimmed" row with a selection or a focus. Journey mode has none: JourneyLegend explains the journey
 * map (carriers, symbols, package), so MapLegend renders nothing there.
 */
export function legendRows(input: LegendInput): LegendRow[] {
  return input.mode === 'journey' ? [] : networkRows(input);
}

// ---------- Journey symbol key (JourneyLegend) ----------

export type JourneySymbolRow =
  | { key: 'package'; label: string; color: string; halo: string }
  | { key: StopSymbol; label: string; glyph: string; color: string };

const SYMBOL_LABEL: Record<StopSymbol, string> = {
  sender: 'Sender',
  relay: 'Overnight at the relay point',
  swap: 'Handoff',
  recipient: 'Delivered',
};

/**
 * The key of the journey map's own marks, in journey order: the package waiting at a business (an
 * orange ring with a white halo; on the way it rides on its carrier, as the carrier rows show), then the symbols the map draws (`SYMBOL_GLYPH`, in RELAY_INK). A direct journey (one carrier)
 * has no overnight stop and no handoff, so it lists neither.
 */
export function journeySymbolRows(relay: boolean): JourneySymbolRow[] {
  const ink = cssColor(RELAY_INK);
  const symbols: StopSymbol[] = relay ? ['sender', 'relay', 'swap', 'recipient'] : ['sender', 'recipient'];
  return [
    { key: 'package', label: 'Package waiting at a business', color: cssColor(PACKAGE_FILL), halo: cssColor(PACKAGE_HALO) },
    ...symbols.map((s) => ({ key: s, label: SYMBOL_LABEL[s], glyph: SYMBOL_GLYPH[s], color: ink })),
  ];
}
