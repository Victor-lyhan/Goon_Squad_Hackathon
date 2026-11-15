// Legend of package journey mode: which carrier is A and which is B, in the colour of their line and
// vehicle, with the letter their vehicle carries on the map (docs/mvp3.md P4: never colour alone). The
// carrier is the big moving marker and the package rides on it as a small orange badge (docs/mvp4.md F2),
// so each carrier row shows that marker with the badge. Then the key of the map's own marks (docs/mvp3.md
// P1, #699): the package ring where it waits and the symbols ■ sender,
// ◆ overnight, ⇄ handoff, ⚑ delivered. Colours and glyphs come from the map's layer palette
// (map/layers.ts, through legendModel), so the legend always matches what the map draws. A direct
// journey has one carrier, so it lists only A, and no overnight or handoff symbol.
import { PACKAGE_FILL, toneLabelColor } from '../../../map/layers';
import { cssColor } from '../legend/legendModel';
import { journeySymbolRows, type JourneySymbolRow } from '../legend/legendModel';
import type { JourneyCarrier } from './journeyModel';
import './journey.css';

export type JourneyLegendProps = { carriers: JourneyCarrier[] };

/** What a carrier row says about its marker on the map. */
export const CARRIER_MARKER_TEXT = 'carrier, the package rides on it';

/** The package as the map draws it: an orange ring with a white halo, on the map's light ground. */
function PackageSwatch({ color, halo }: { color: string; halo: string }) {
  return (
    <svg className="jl__pkg" width="20" height="20" viewBox="0 0 20 20" focusable="false">
      <circle cx="10" cy="10" r="6" fill="none" stroke={halo} strokeWidth="6" />
      <circle cx="10" cy="10" r="6" fill="none" stroke={color} strokeWidth="3" />
    </svg>
  );
}

function SymbolItem({ row }: { row: JourneySymbolRow }) {
  return (
    <li className={`jl__item jl__item--symbol jl__item--${row.key}`} data-symbol={row.key}>
      <span className="jl__glyph" aria-hidden="true" style={{ color: row.color }}>
        {'glyph' in row ? row.glyph : <PackageSwatch color={row.color} halo={row.halo} />}
      </span>
      <span className="jl__text">
        <span className="jl__label">{row.label}</span>
      </span>
    </li>
  );
}

export function JourneyLegend({ carriers }: JourneyLegendProps) {
  const symbols = journeySymbolRows(carriers.length > 1);
  return (
    <section className="jl" aria-label="Journey legend">
      <ul className="jl__list">
        {carriers.map((c) => (
          <li key={c.legIndex} className="jl__item">
            {/* The carrier's marker: its letter in its colour (as the map draws it), with the package badge. */}
            <span className="jl__marker" aria-hidden="true">
              <span className={`jl__badge jl__badge--${c.tone}`} aria-hidden="true" style={{ background: toneLabelColor(c.tone) }}>
                {c.letter}
              </span>
              <span className="jl__rider" style={{ background: cssColor(PACKAGE_FILL) }} />
            </span>
            <span className="jl__text">
              <span className="jl__name">
                {c.letter} · {c.name}
              </span>
              <span className="jl__sub">
                {c.letter} {CARRIER_MARKER_TEXT} · from {c.homeNeighborhood}
              </span>
            </span>
          </li>
        ))}
        <li className="jl__item jl__item--key">
          <span className="jl__swatches" aria-hidden="true">
            <span className="jl__swatch jl__swatch--thick" />
            <span className="jl__swatch jl__swatch--thin" />
          </span>
          <span className="jl__text">
            <span className="jl__sub">Thick: carrying the package · thin: rest of the commute</span>
          </span>
        </li>
      </ul>
      <ul className="jl__list jl__symbols" aria-label="Map symbols">
        {symbols.map((row) => (
          <SymbolItem key={row.key} row={row} />
        ))}
      </ul>
    </section>
  );
}
