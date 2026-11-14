// Legend of package journey mode: which carrier is A and which is B, in the colour of their line and
// vehicle, with the letter their vehicle carries on the map (docs/mvp3.md P4: never colour alone).
// Colors come from the map's layer palette, so the legend always matches what the map draws. A direct
// journey has one carrier, so it lists only A.
import { toneLabelColor } from '../../../map/layers';
import type { JourneyCarrier } from './journeyModel';
import './journey.css';

export type JourneyLegendProps = { carriers: JourneyCarrier[] };

export function JourneyLegend({ carriers }: JourneyLegendProps) {
  return (
    <section className="jl" aria-label="Journey legend">
      <ul className="jl__list">
        {carriers.map((c) => (
          <li key={c.legIndex} className="jl__item">
            {/* The vehicle's letter badge, in the carrier's colour (the map draws the same letter). */}
            <span className={`jl__badge jl__badge--${c.tone}`} aria-hidden="true" style={{ background: toneLabelColor(c.tone) }}>
              {c.letter}
            </span>
            <span className="jl__text">
              <span className="jl__name">
                {c.letter} · {c.name}
              </span>
              <span className="jl__sub">from {c.homeNeighborhood}</span>
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
    </section>
  );
}
