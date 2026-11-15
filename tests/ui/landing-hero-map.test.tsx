// #833: the homepage's hero map. A stylized dark NYC drawn in inline SVG (no map service, no tiles, no
// request), two commute lines in the carrier colors, the orange package riding the first, changing hands at
// the relay point's diamond and riding the second, in a loop; under prefers-reduced-motion the last frame.
// Checked in headless Chrome at 1440 and 390 px; this file keeps what a later edit could undo.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing from '../../client/src/pages/Landing';
import LandingHeroMap, { HERO_MAP_LABEL } from '../../client/src/pages/LandingHeroMap';
import {
  HERO_MAP_PLACEMENT, HERO_SAFE_BOX, HERO_VIEWBOX, LINE_A, LINE_B, PACKAGE_ROUTE, RECIPIENT, RELAY_POINT,
  RELAY_SPLIT_PERCENT, SENDER, lengthOf, pathD, placed, segmentMidpoint, type Pt,
} from '../../client/src/pages/landingHeroModel';

const svg = renderToStaticMarkup(<LandingHeroMap />);
const css = readFileSync('client/src/styles/landing.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the route of the drawing (landingHeroModel)', () => {
  it('is two lines that meet at the relay point: A from the sender, B on to the recipient', () => {
    expect(LINE_A[0]).toEqual(SENDER);
    expect(LINE_A[LINE_A.length - 1]).toEqual(RELAY_POINT);
    expect(LINE_B[0]).toEqual(RELAY_POINT);
    expect(LINE_B[LINE_B.length - 1]).toEqual(RECIPIENT);
    expect(PACKAGE_ROUTE).toEqual([...LINE_A, ...LINE_B.slice(1)]);
    expect(PACKAGE_ROUTE[0]).toEqual(SENDER);
    expect(PACKAGE_ROUTE[PACKAGE_ROUTE.length - 1]).toEqual(RECIPIENT);
  });

  it('puts the handoff where line A ends on the whole route, in percent', () => {
    const a = lengthOf(LINE_A);
    const whole = lengthOf(PACKAGE_ROUTE);
    expect(whole).toBeCloseTo(a + lengthOf(LINE_B), 9);
    expect(RELAY_SPLIT_PERCENT).toBeCloseTo((100 * a) / whole, 1);
    expect(RELAY_SPLIT_PERCENT).toBeGreaterThan(30);
    expect(RELAY_SPLIT_PERCENT).toBeLessThan(70); // both rides are long enough to see
    expect(lengthOf([[0, 0], [3, 4], [3, 10]])).toBe(11);
    expect(pathD([[1, 2], [3, 4], [5, 4]])).toBe('M1 2L3 4L5 4');
    expect(segmentMidpoint([[0, 0], [10, 20], [30, 20]], 1)).toEqual([20, 20]);
  });

  it('draws both lines at transit-map angles: flat, upright or 45°', () => {
    for (const line of [LINE_A, LINE_B]) {
      for (let i = 1; i < line.length; i++) {
        const dx = Math.abs(line[i][0] - line[i - 1][0]);
        const dy = Math.abs(line[i][1] - line[i - 1][1]);
        expect(dx === 0 || dy === 0 || dx === dy, `${line[i - 1]} to ${line[i]}`).toBe(true);
        expect(dx + dy).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the route, with its marks, in the part of the view box that is never cropped', () => {
    const margin = 12 * HERO_MAP_PLACEMENT.scale; // the largest mark on the route (a letter badge, r 11 + its edge)
    for (const p of PACKAGE_ROUTE) {
      const [x, y] = placed(p);
      expect(x - margin, `${p}`).toBeGreaterThanOrEqual(HERO_SAFE_BOX.x0);
      expect(x + margin, `${p}`).toBeLessThanOrEqual(HERO_SAFE_BOX.x1);
      expect(y - margin, `${p}`).toBeGreaterThanOrEqual(HERO_SAFE_BOX.y0);
      expect(y + margin, `${p}`).toBeLessThanOrEqual(HERO_SAFE_BOX.y1);
    }
    expect(placed([100, 100])).toEqual([100 * HERO_MAP_PLACEMENT.scale + HERO_MAP_PLACEMENT.dx, 100 * HERO_MAP_PLACEMENT.scale + HERO_MAP_PLACEMENT.dy]);
    // The safe box is centered in the view box, so a centered crop keeps it.
    expect(HERO_SAFE_BOX.x0 + HERO_SAFE_BOX.x1).toBe(HERO_VIEWBOX.width);
    expect(HERO_SAFE_BOX.y0 + HERO_SAFE_BOX.y1).toBe(HERO_VIEWBOX.height);
  });
});

describe('the drawing (LandingHeroMap)', () => {
  const at = ([x, y]: Pt) => `translate(${x} ${y})`;

  it('is one inline SVG image with a label, filling its box', () => {
    expect(svg.match(/<svg /g)).toHaveLength(1 + 4); // the map, and the four marks of the key
    const map = /<svg class="hero-map"[^>]*>/.exec(svg)![0];
    expect(map).toContain(`viewBox="0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}"`);
    expect(map).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(map).toContain('role="img"');
    expect(map).toContain(`aria-label="${HERO_MAP_LABEL}"`);
    expect(HERO_MAP_LABEL).toMatch(/relay point/);
    const g = `<g transform="translate(${HERO_MAP_PLACEMENT.dx} ${HERO_MAP_PLACEMENT.dy}) scale(${HERO_MAP_PLACEMENT.scale})">`;
    expect(svg.split(g)).toHaveLength(2);
  });

  it('asks nothing of the network: no Google map, no image, no frame, no link, only its own patterns', () => {
    expect(svg).not.toMatch(/<(img|image|iframe|script|use|a|link|object|embed|foreignObject)[\s>]/);
    expect(svg).not.toMatch(/https?:|\/\/|href=|src=|google|gstatic|mapbox|tile/i);
    const urls = [...svg.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]);
    expect(urls).toEqual(['#relay-hero-grid-m', '#relay-hero-grid-bx', '#relay-hero-grid-li']);
    for (const id of urls) expect(svg).toContain(`<pattern id="${id.slice(1)}"`);
    for (const file of ['client/src/pages/LandingHeroMap.tsx', 'client/src/pages/landingHeroModel.ts', 'client/src/pages/Landing.tsx']) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/components\/map|googlemaps|deck\.gl|fetch\(|XMLHttpRequest|https?:\/\//);
    }
    expect(css).not.toMatch(/url\(|@import|https?:/);
  });

  it('draws the boroughs as land shapes with a street grid', () => {
    const land = /<g class="hero-land">([\s\S]*?)<\/g>/.exec(svg)![1];
    expect(land.match(/<path /g)!.length).toBeGreaterThanOrEqual(3); // Manhattan, the Bronx, Brooklyn and Queens
    expect(svg.match(/class="hero-street"/g)).toHaveLength(3);
    expect(svg).toContain('class="hero-park"');
  });

  it('draws the two commute lines from the model, A then B, each with its letter badge', () => {
    expect(svg).toContain(`<path class="hero-line hero-line-a" d="${pathD(LINE_A)}"></path>`);
    expect(svg).toContain(`<path class="hero-line hero-line-b" d="${pathD(LINE_B)}"></path>`);
    expect(svg.match(/class="hero-line hero-line-[ab]"/g)).toHaveLength(2);
    const badge = (line: 'a' | 'b', letter: string, p: Pt) =>
      `<g transform="${at(p)}"><circle class="hero-badge hero-badge-${line}" r="11"></circle><text class="hero-badge-letter" y="4.5" text-anchor="middle">${letter}</text></g>`;
    expect(svg).toContain(badge('a', 'A', segmentMidpoint(LINE_A, 1)));
    expect(svg).toContain(badge('b', 'B', segmentMidpoint(LINE_B, 0)));
  });

  it('marks the sender and the recipient, and the relay point as a diamond', () => {
    expect(svg).toContain(`<circle class="hero-stop" r="6" transform="${at(SENDER)}"></circle>`);
    expect(svg).toContain(`<circle class="hero-stop" r="6" transform="${at(RECIPIENT)}"></circle>`);
    const diamond = `<g transform="${at(RELAY_POINT)} rotate(45)"><rect class="hero-relay-ring" x="-9" y="-9" width="18" height="18"></rect><rect class="hero-relay" x="-9" y="-9" width="18" height="18"></rect></g>`;
    expect(svg).toContain(diamond);
  });

  it('gives the package its route and the handoff place, and rests it at the recipient (the last frame)', () => {
    const pkg = /<rect class="hero-package"[^>]*>/.exec(svg)![0];
    expect(svg.match(/class="hero-package"/g)).toHaveLength(1);
    expect(pkg).toContain(`transform="${at(RECIPIENT)}"`);
    expect(pkg).toContain(`offset-path:path(&#x27;${pathD(PACKAGE_ROUTE)}&#x27;)`);
    expect(pkg).toContain(`--relay-split:${RELAY_SPLIT_PERCENT}%`);
    // drawn last, so it rides over the lines, the badges and the diamond
    const map = svg.slice(0, svg.indexOf('<ul class="hero-legend">'));
    expect(map.indexOf('class="hero-package"')).toBeGreaterThan(map.lastIndexOf('class="hero-relay"'));
    expect(map.indexOf('class="hero-package"')).toBeGreaterThan(map.lastIndexOf('class="hero-badge-letter"'));
  });

  it('has a key in words under the map: letters and shapes, not color alone', () => {
    const key = /<ul class="hero-legend">([\s\S]*?)<\/ul>/.exec(svg)![1];
    expect(key.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '|')).toBe('|Commuter A||Commuter B||Relay point||Package|');
    expect(key.match(/<svg class="hero-key"[^>]*aria-hidden="true"/g)).toHaveLength(4);
    expect(key).toMatch(/<circle class="hero-badge-a"[^>]*><\/circle><text[^>]*>A<\/text>/);
    expect(key).toMatch(/<circle class="hero-badge-b"[^>]*><\/circle><text[^>]*>B<\/text>/);
    expect(key).toMatch(/<rect class="hero-relay"[^>]*transform="rotate\(45\)"/);
    expect(key).toContain('class="hero-key-package"');
  });

  it('is in the hero of the page, after the text', () => {
    const page = renderToStaticMarkup(<MemoryRouter><Landing initialSummary={{ status: 'loading' }} /></MemoryRouter>);
    const hero = /<section class="landing-hero"[^>]*>([\s\S]*?)<\/section>/.exec(page)![1];
    expect(hero).toContain(svg);
    expect(hero.indexOf('class="landing-hero-copy"')).toBeLessThan(hero.indexOf('class="landing-hero-map"'));
  });
});

describe('the colors and the motion (landing.css)', () => {
  const rule = (selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const keyframes = (name: string) => new RegExp(`@keyframes ${name} \\{((?:[^{}]*\\{[^{}]*\\})*)\\s*\\}`).exec(css)![1];

  it('uses the carrier colors, blue for A and green for B, and the package orange of docs/mvp3.md', () => {
    const hero = rule('.landing-hero');
    expect(hero).toMatch(/--hero-carrier-a: #4C9BD6;/); // the doc's blue, lightened for the dark ground
    expect(hero).toMatch(/--hero-carrier-b: #2DBE85;/); // the doc's green, lightened
    expect(hero).toMatch(/--hero-package: #E8590C;/);
    expect(rule('.hero-line-a')).toMatch(/stroke: var\(--hero-carrier-a, #4C9BD6\)/);
    expect(rule('.hero-line-b')).toMatch(/stroke: var\(--hero-carrier-b, #2DBE85\)/);
    expect(rule('.hero-package')).toMatch(/fill: var\(--hero-package, #E8590C\)/);
  });

  it('the package rides line A to the relay point, waits there, rides line B, rests, and loops', () => {
    const frames = [...keyframes('hero-package-ride').matchAll(/(\d+)% \{([^}]*)\}/g)]
      .map((m) => ({ at: Number(m[1]), distance: /offset-distance: ([^;]+);/.exec(m[2])?.[1] }));
    expect(frames.map((f) => f.at)).toEqual([...frames.map((f) => f.at)].sort((a, b) => a - b));
    const distances = frames.map((f) => f.distance);
    expect(distances[0]).toBe('0%');
    expect(distances[distances.length - 1]).toBe('100%');
    const relay = 'var(--relay-split, 55%)';
    // 0 … 0, then the relay point twice (the wait), then 100 … 100
    const collapsed = distances.filter((d, i) => i === 0 || d !== distances[i - 1]);
    expect(collapsed).toEqual(['0%', relay, '100%']);
    const waits = frames.filter((f) => f.distance === relay).map((f) => f.at);
    expect(waits).toHaveLength(2);
    expect(waits[1] - waits[0]).toBeGreaterThanOrEqual(10); // a handoff one can see
    expect(css).toMatch(/\.hero-package \{ animation: hero-package-ride \d+s ease-in-out infinite; \}/);
    expect(css).toMatch(/\.hero-relay-ring \{ animation: hero-relay-handoff \d+s ease-out infinite; \}/);
    const durations = [...css.matchAll(/animation: hero-[a-z-]+ (\d+)s/g)].map((m) => m[1]);
    expect(new Set(durations).size).toBe(1); // the ring grows at the package's handoff: one clock
  });

  it('respects prefers-reduced-motion: nothing moves, and the package rests at the recipient', () => {
    // Every animation of the page is declared for no-preference only …
    const moving = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n  \}/.exec(css)![1];
    const outside = css.replace(moving, '').replace(/@keyframes [\s\S]*?\n\}/g, '');
    expect(outside).not.toMatch(/animation: (?!none)/);
    // … and switched off again under reduce.
    const reduce = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(reduce).toMatch(/\.hero-package, \.hero-relay-ring \{ animation: none; \}/);
    // Without the animation the package is at the end of its route (and the ring is not shown).
    const supports = /@supports \(offset-path: path\('M0 0'\)\) \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(supports).toMatch(/\.hero-package \{ transform: none; offset-rotate: 0deg; offset-distance: 100%; \}/);
    expect(rule('.hero-relay-ring')).toMatch(/opacity: 0/);
  });
});
