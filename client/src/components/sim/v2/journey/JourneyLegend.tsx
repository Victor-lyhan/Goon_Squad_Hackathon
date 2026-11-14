// Legend of package journey mode: which line color is which carrier, plus the faint normal commute.
// Colors come from the map's layer palette, so the legend always matches what the map draws.
import { BASELINE, toneLabelColor } from '../../../map/layers';
import type { RouteTone } from '../../../map/types';
import type { JourneyCarrier } from './journeyModel';
import './journey.css';

export type JourneyLegendProps = { carriers: JourneyCarrier[] };

type Entry = { employeeId: string; name: string; homeNeighborhood: string; legs: number[]; tones: RouteTone[] };

/** One entry per carrier, even if the same person carries both legs. */
function entries(carriers: JourneyCarrier[]): Entry[] {
  const out: Entry[] = [];
  for (const c of carriers) {
    const hit = out.find((e) => e.employeeId === c.employeeId);
    if (hit) {
      hit.legs.push(c.legIndex + 1);
      hit.tones.push(c.tone);
    } else {
      out.push({ employeeId: c.employeeId, name: c.name, homeNeighborhood: c.homeNeighborhood, legs: [c.legIndex + 1], tones: [c.tone] });
    }
  }
  return out;
}

const BASELINE_CSS = `rgba(${BASELINE[0]}, ${BASELINE[1]}, ${BASELINE[2]}, ${(BASELINE[3] / 255).toFixed(2)})`;

export function JourneyLegend({ carriers }: JourneyLegendProps) {
  return (
    <section className="jl" aria-label="Journey legend">
      <ul className="jl__list">
        {entries(carriers).map((e) => (
          <li key={e.employeeId} className="jl__item">
            <span className="jl__swatches" aria-hidden="true">
              {e.tones.map((t) => (
                <span key={t} className={`jl__swatch jl__swatch--${t}`} style={{ background: toneLabelColor(t) }} />
              ))}
            </span>
            <span className="jl__text">
              <span className="jl__leg">{e.legs.length > 1 ? `Legs ${e.legs.join(' and ')}` : `Leg ${e.legs[0]}`}</span>
              <span className="jl__name">{e.name}</span>
              <span className="jl__sub">from {e.homeNeighborhood}</span>
            </span>
          </li>
        ))}
        <li className="jl__item jl__item--baseline">
          <span className="jl__swatches" aria-hidden="true">
            <span className="jl__swatch jl__swatch--baseline" style={{ background: BASELINE_CSS }} />
          </span>
          <span className="jl__text">
            <span className="jl__name">Normal commute</span>
          </span>
        </li>
      </ul>
    </section>
  );
}
