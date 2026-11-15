import type { CSSProperties } from 'react';

import {
  HERO_MAP_PLACEMENT, HERO_VIEWBOX, LINE_A, LINE_B, NETWORK_NODES, PACKAGE_ROUTE, RECIPIENT, RELAY_POINT,
  RELAY_SPLIT_PERCENT, SENDER, pathD, segmentMidpoint, streetGrid, type Pt,
} from './landingHeroModel';

/** What the drawing shows, for a screen reader (the drawing itself is one image). */
export const HERO_MAP_LABEL =
  'Illustration: on a map of New York City, a package rides one commuter’s route, changes hands at a relay point, and rides a second commuter’s route to its recipient.';

/** The key at the bottom of the map. Shapes and letters, so no item is told apart by color alone (docs/mvp3.md P4). */
export const HERO_LEGEND: { key: 'a' | 'b' | 'relay' | 'package'; text: string }[] = [
  { key: 'a', text: 'Commuter A' },
  { key: 'b', text: 'Commuter B' },
  { key: 'relay', text: 'Relay point' },
  { key: 'package', text: 'Package' },
];

// Simplified borough shapes in the 800 x 600 user space. The left edge is open water, so the map runs into
// the hero's dark ground without a cut.
const MANHATTAN = 'M268 520L262 470L282 380L318 280L356 180L392 80L420 -10L500 -10L492 40L470 110L452 170L430 240L402 320L372 390L345 450L318 500L290 528Z';
const BRONX = 'M530 -10L522 50L505 110L520 150L570 165L650 150L720 165L810 150L810 -10Z';
const LONG_ISLAND = 'M560 205L500 215L478 250L462 300L440 350L418 400L392 445L370 480L352 520L330 560L300 590L290 610L810 610L810 200L700 215L620 195Z';
const ROOSEVELT_ISLAND = 'M458 200L466 204L450 266L443 262Z';
const CENTRAL_PARK = 'M417.9 166.6L397.3 159L366.1 243.4L386.7 251Z';
/** Brooklyn | Queens, from Newtown Creek east. */
const BOROUGH_LINE = 'M440 350L560 392L810 470';

const at = ([x, y]: Pt) => `translate(${x} ${y})`;

// Street grids: avenues along Manhattan's axis, another angle on each side of the river. One avenue and
// one cross street in each tile are drawn brighter (#939).
const GRIDS = [
  { id: 'relay-hero-grid-m', rotate: 20.3, ...streetGrid(16, 9, 4, 5) },
  { id: 'relay-hero-grid-li', rotate: -12, ...streetGrid(22, 14, 4, 5) },
  { id: 'relay-hero-grid-bx', rotate: 38, ...streetGrid(20, 13, 4, 5) },
];
/** The soft trail behind the package: dots on the package's route, each a little later and smaller. */
const TRAIL = [{ r: 7, lag: 0.09 }, { r: 5.5, lag: 0.18 }, { r: 4, lag: 0.27 }];

function Badge({ point, letter, line }: { point: Pt; letter: string; line: 'a' | 'b' }) {
  return (
    <g transform={at(point)}>
      <circle className={`hero-badge hero-badge-${line}`} r="11" />
      <text className="hero-badge-letter" y="4.5" textAnchor="middle">{letter}</text>
    </g>
  );
}

/** One mark of the key, drawn like its mark on the map: a lettered circle, the diamond, the package's square. */
function LegendKey({ item }: { item: 'a' | 'b' | 'relay' | 'package' }) {
  return (
    <svg className="hero-key" viewBox="-8 -8 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      {item === 'relay' && <rect className="hero-relay" x="-4.5" y="-4.5" width="9" height="9" transform="rotate(45)" />}
      {item === 'package' && <rect className="hero-key-package" x="-5" y="-5" width="10" height="10" rx="2" />}
      {(item === 'a' || item === 'b') && (
        <>
          <circle className={`hero-badge-${item}`} r="7.5" />
          <text className="hero-badge-letter hero-key-letter" y="3.5" textAnchor="middle">{item.toUpperCase()}</text>
        </>
      )}
    </svg>
  );
}

/**
 * The hero's map (#833): a stylized dark NYC drawn here in SVG, with no map service, no tiles and no request.
 * Two commute lines in the carrier colors, the orange package riding the first, changing hands at the relay
 * point's diamond and riding the second to a delivered flag, in a loop; each line draws on as its commuter
 * sets off (#939). The motion is CSS (landing.css): without it, and under prefers-reduced-motion, both lines
 * are drawn, the flag is up and the package rests at the recipient, which is the last frame. The box has no frame:
 * it is the hero's whole right half, or the band under the text on a phone, and the drawing fills it (#869).
 */
export default function LandingHeroMap() {
  // The route and the handoff's place on it go to the CSS animation from the same points the lines are drawn from.
  const packageStyle = {
    offsetPath: `path('${pathD(PACKAGE_ROUTE)}')`,
    '--relay-split': `${RELAY_SPLIT_PERCENT}%`,
  } as CSSProperties;
  return (
    <div className="landing-hero-map">
      <svg
        className="hero-map" viewBox={`0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid slice" role="img" aria-label={HERO_MAP_LABEL} focusable="false"
      >
        <defs>
          {GRIDS.map((grid) => (
            <pattern key={grid.id} id={grid.id} width={grid.width} height={grid.height} patternUnits="userSpaceOnUse" patternTransform={`rotate(${grid.rotate})`}>
              <path className="hero-street" d={grid.fine} />
              <path className="hero-avenue" d={grid.major} />
            </pattern>
          ))}
          {/* Faint scan lines over water and land alike: the map reads as an operations screen. */}
          <pattern id="relay-hero-scan" width="8" height="5" patternUnits="userSpaceOnUse">
            <path className="hero-scan" d="M0 2.5H8" />
          </pattern>
        </defs>

        {/* Everything is drawn in the model's coordinates and placed in the view box as one group. */}
        <g transform={`translate(${HERO_MAP_PLACEMENT.dx} ${HERO_MAP_PLACEMENT.dy}) scale(${HERO_MAP_PLACEMENT.scale})`}>
        <g className="hero-land">
          <path d={MANHATTAN} />
          <path d={BRONX} />
          <path d={LONG_ISLAND} />
          <path d={ROOSEVELT_ISLAND} />
        </g>
        <path d={MANHATTAN} fill="url(#relay-hero-grid-m)" />
        <path d={BRONX} fill="url(#relay-hero-grid-bx)" />
        <path d={LONG_ISLAND} fill="url(#relay-hero-grid-li)" />
        <path className="hero-park" d={CENTRAL_PARK} />
        <path className="hero-borough-line" d={BOROUGH_LINE} />

        <rect className="hero-scan-layer" x="0" y="0" width="900" height="700" fill="url(#relay-hero-scan)" />

        {/* Network businesses: a small dot with a halo in a carrier color, pulsing slowly, each on its own beat. */}
        {NETWORK_NODES.map((point, i) => (
          <g key={i} transform={at(point)}>
            <circle className={`hero-node-halo hero-node-halo-${i % 2 === 0 ? 'a' : 'b'}`} r="8" style={{ animationDelay: `${-((i * 1.3) % 5).toFixed(1)}s` }} />
            <circle className="hero-node" r="2" />
          </g>
        ))}

        {/* The two commutes. A dark casing keeps each clear of the street grid and a dim track shows where it
            runs; the bright line and its glow (a wider, fainter stroke, no filter) draw on over the track. */}
        <path className="hero-line-casing" d={pathD(LINE_A)} />
        <path className="hero-line-casing" d={pathD(LINE_B)} />
        <path className="hero-track hero-line-a" d={pathD(LINE_A)} />
        <path className="hero-track hero-line-b" d={pathD(LINE_B)} />
        <g className="hero-live">
          <path className="hero-glow hero-draw-a hero-line-a" d={pathD(LINE_A)} pathLength={1} />
          <path className="hero-glow hero-draw-b hero-line-b" d={pathD(LINE_B)} pathLength={1} />
          <path className="hero-line hero-draw-a hero-line-a" d={pathD(LINE_A)} pathLength={1} />
          <path className="hero-line hero-draw-b hero-line-b" d={pathD(LINE_B)} pathLength={1} />
        </g>
        <Badge point={segmentMidpoint(LINE_A, 1)} letter="A" line="a" />
        <Badge point={segmentMidpoint(LINE_B, 0)} letter="B" line="b" />

        <circle className="hero-stop" r="6" transform={at(SENDER)} />
        <circle className="hero-stop" r="6" transform={at(RECIPIENT)} />

        {/* Delivered: a flag goes up at the recipient when the package arrives. */}
        <g transform={at(RECIPIENT)}>
          <g className="hero-flag">
            <path className="hero-flag-pole" d="M0 0V-27" />
            <path className="hero-flag-cloth" d="M0 -27L15 -21.5L0 -16Z" />
          </g>
        </g>

        {/* The relay point: a diamond, as on the simulator's map. The ring grows once at each handoff. */}
        <g transform={`${at(RELAY_POINT)} rotate(45)`}>
          <rect className="hero-relay-ring" x="-9" y="-9" width="18" height="18" />
          <rect className="hero-relay" x="-9" y="-9" width="18" height="18" />
        </g>

        {/* The package's glow and trail, then the package. The transform is the resting place (the recipient)
            where CSS motion paths are missing; at rest the trail is under the package. */}
        <g className="hero-trail">
          <circle className="hero-package-ride" r="15" transform={at(RECIPIENT)} style={packageStyle} />
          {TRAIL.map(({ r, lag }) => (
            <circle
              key={lag} className="hero-package-ride" r={r} transform={at(RECIPIENT)}
              style={{ ...packageStyle, '--trail-lag': `${lag}s` } as CSSProperties}
            />
          ))}
        </g>
        <rect
          className="hero-package hero-package-ride" x="-9" y="-9" width="18" height="18" rx="3"
          transform={at(RECIPIENT)} style={packageStyle}
        />
        </g>
      </svg>
      <ul className="hero-legend">
        {HERO_LEGEND.map((item) => (
          <li key={item.key}>
            <LegendKey item={item.key} />
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
