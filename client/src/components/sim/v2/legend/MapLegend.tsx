// Collapsible map legend for the simulator's map corner: what each marker and line means in the network
// view. In journey mode it renders nothing: JourneyLegend explains the journey map (issue 699). Props only. The open state is either passed in (`open` + `onOpenChange`) or held locally; it is
// never persisted in browser storage. Rows come from legendModel, so swatches match the map's layer colors.
import { useId, useState, type CSSProperties } from 'react';
import type { Focus } from '../workspaceModel';
import { legendRows, type LegendMode, type LegendRow } from './legendModel';
import './legend.css';

export type MapLegendProps = {
  mode: LegendMode;
  hasSelection?: boolean;
  focus?: Focus;
  /** Controlled open state. Leave undefined to let the legend hold it (open by default). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function swatchStyle(row: LegendRow): CSSProperties {
  if (row.shape === 'line') return { background: row.color, height: `${row.width ?? 2}px` };
  if (row.shape === 'ring') return { borderColor: row.color };
  return { background: row.color };
}

function Swatch({ row }: { row: LegendRow }) {
  if (row.shape === 'glyph') {
    return (
      <span className="ml__swatch-box" aria-hidden="true">
        <span className="ml__swatch ml__swatch--glyph" style={{ color: row.color }}>{row.glyph}</span>
      </span>
    );
  }
  return (
    <span className="ml__swatch-box" aria-hidden="true">
      <span className={`ml__swatch ml__swatch--${row.shape}`} style={swatchStyle(row)} />
    </span>
  );
}

/** The toggle's name (issue 889). Shown in capitals by legend.css, so it is also its aria-label: Chrome reads
 *  `text-transform: uppercase` into the accessible name ("LEGEND"), which a screen reader may spell out. */
export const LEGEND_LABEL = 'Legend';
/** The name of the legend's region. */
export const LEGEND_REGION_LABEL = 'Map legend';

export function MapLegend({ mode, hasSelection = false, focus, open, onOpenChange }: MapLegendProps) {
  const [localOpen, setLocalOpen] = useState(true);
  const isOpen = open ?? localOpen;
  const bodyId = useId();
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  };

  const rows = legendRows({ mode, hasSelection, focus });
  // Journey mode has no rows of its own: no empty box in the map corner.
  if (rows.length === 0) return null;

  return (
    <section className="ml" aria-label={LEGEND_REGION_LABEL}>
      <button type="button" className="ml__toggle" aria-label={LEGEND_LABEL} aria-expanded={isOpen} aria-controls={bodyId} onClick={toggle}>
        <span>{LEGEND_LABEL}</span>
        {/* The + / − takes the toggle's white; it needs no rule, so it has no class (issue 874). */}
        <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
      </button>
      <div id={bodyId} className="ml__body" hidden={!isOpen}>
        <ul className="ml__list">
          {rows.map((row) => (
            <li key={row.key} className={`ml__row ml__row--${row.key}`}>
              <Swatch row={row} />
              <span className="ml__label">{row.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
