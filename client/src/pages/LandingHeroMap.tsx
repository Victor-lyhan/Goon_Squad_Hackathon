import type { CSSProperties } from 'react';

import {
  HERO_MAP_PLACEMENT, HERO_VIEWBOX, LINE_A, LINE_B, PACKAGE_ROUTE, RECIPIENT, RELAY_POINT, RELAY_SPLIT_PERCENT, SENDER,
  pathD, segmentMidpoint, type Pt,
} from './landingHeroModel';

/** What the drawing shows, for a screen reader (the drawing itself is one image). */
export const HERO_MAP_LABEL =
  'Illustration: on a map of New York City, a package rides one commuter’s route, changes hands at a relay point, and rides a second commuter’s route to its recipient.';

/** The key under the map. Shapes and letters, so no item is told apart by color alone (docs/mvp3.md P4). */
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
 * point's diamond and riding the second, in a loop. The motion is CSS (landing.css): without it, and under
 * prefers-reduced-motion, the package rests at the recipient, which is the last frame.
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
          {/* Street grids: avenues along Manhattan's axis, another angle on each side of the river. */}
          <pattern id="relay-hero-grid-m" width="16" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(20.3)">
            <path className="hero-street" d="M0 0H16M0 0V9" />
          </pattern>
          <pattern id="relay-hero-grid-li" width="22" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)">
            <path className="hero-street" d="M0 0H22M0 0V14" />
          </pattern>
          <pattern id="relay-hero-grid-bx" width="20" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
            <path className="hero-street" d="M0 0H20M0 0V13" />
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

        {/* The two commutes: a dark casing under each line keeps it clear of the street grid. */}
        <path className="hero-line-casing" d={pathD(LINE_A)} />
        <path className="hero-line-casing" d={pathD(LINE_B)} />
        <path className="hero-line hero-line-a" d={pathD(LINE_A)} />
        <path className="hero-line hero-line-b" d={pathD(LINE_B)} />
        <Badge point={segmentMidpoint(LINE_A, 1)} letter="A" line="a" />
        <Badge point={segmentMidpoint(LINE_B, 0)} letter="B" line="b" />

        <circle className="hero-stop" r="6" transform={at(SENDER)} />
        <circle className="hero-stop" r="6" transform={at(RECIPIENT)} />

        {/* The relay point: a diamond, as on the simulator's map. The ring grows once at each handoff. */}
        <g transform={`${at(RELAY_POINT)} rotate(45)`}>
          <rect className="hero-relay-ring" x="-9" y="-9" width="18" height="18" />
          <rect className="hero-relay" x="-9" y="-9" width="18" height="18" />
        </g>

        {/* The package. The transform is its resting place (the recipient) where CSS motion paths are missing. */}
        <rect
          className="hero-package" x="-9" y="-9" width="18" height="18" rx="3"
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
