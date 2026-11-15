// #833: the homepage's hero map. A stylized dark NYC drawn in inline SVG (no map service, no tiles, no
// request), two commute lines in the carrier colors, the orange package riding the first, changing hands at
// the relay point's diamond and riding the second, in a loop; under prefers-reduced-motion the last frame.
// Since #869 it has no frame and covers the hero's right half (the box's rules: landing-nyc-css.test.ts).
// Checked in headless Chrome at 1440 and 390 px; this file keeps what a later edit could undo.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing from '../../client/src/pages/Landing';
import LandingHeroMap, { HERO_MAP_LABEL } from '../../client/src/pages/LandingHeroMap';
import {
  HERO_MAP_PLACEMENT, HERO_SAFE_BOX, HERO_VIEWBOX, LINE_A, LINE_B, NETWORK_NODES, PACKAGE_ROUTE, RECIPIENT, RELAY_POINT,
  RELAY_SPLIT_PERCENT, SENDER, distanceToLine, lengthOf, pathD, placed, segmentMidpoint, streetGrid, type Pt,
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
    // The delivered flag stands 27 above the recipient: still inside the safe box.
    expect(placed([RECIPIENT[0], RECIPIENT[1] - 27])[1]).toBeGreaterThanOrEqual(HERO_SAFE_BOX.y0);
  });

  it('scatters the network businesses clear of the route, each one once (#939)', () => {
    expect(NETWORK_NODES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(NETWORK_NODES.map((p) => p.join(','))).size).toBe(NETWORK_NODES.length);
    for (const p of NETWORK_NODES) expect(distanceToLine(p, PACKAGE_ROUTE), `${p}`).toBeGreaterThan(24);
    expect(distanceToLine([5, 5], [[0, 0], [10, 0]])).toBe(5);
    expect(distanceToLine([13, 4], [[0, 0], [10, 0]])).toBe(5);
  });

  it('builds a street grid tile with one brighter avenue and cross street, no line on the tile\'s edge (#939)', () => {
    const grid = streetGrid(10, 4, 3, 2);
    expect(grid).toEqual({ width: 30, height: 8, fine: 'M0 6H30M15 0V8M25 0V8', major: 'M0 2H30M5 0V8' });
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
    expect(urls).toEqual(['#relay-hero-grid-m', '#relay-hero-grid-bx', '#relay-hero-grid-li', '#relay-hero-scan']);
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
    expect(svg.match(/class="hero-avenue"/g)).toHaveLength(3); // a few brighter avenues in each grid (#939)
    expect(svg).toContain('class="hero-park"');
  });

  it('reads as an operations screen: faint scan lines, and each network business a dot with a carrier-color halo (#939)', () => {
    expect(svg).toContain('<pattern id="relay-hero-scan" width="8" height="5" patternUnits="userSpaceOnUse"><path class="hero-scan" d="M0 2.5H8"></path></pattern>');
    expect(svg.match(/fill="url\(#relay-hero-scan\)"/g)).toHaveLength(1);
    expect(svg.match(/class="hero-node"/g)).toHaveLength(NETWORK_NODES.length);
    const halos = [...svg.matchAll(/<circle class="hero-node-halo hero-node-halo-([ab])" r="8" style="animation-delay:(-?[\d.]+)s"/g)];
    expect(halos).toHaveLength(NETWORK_NODES.length);
    expect(new Set(halos.map((m) => m[1]))).toEqual(new Set(['a', 'b'])); // blue and green only
    expect(new Set(halos.map((m) => m[2])).size).toBeGreaterThan(NETWORK_NODES.length / 2); // not all on one beat
    for (const m of halos) expect(Number(m[2])).toBeLessThanOrEqual(0); // already mid-pulse when the page opens
    for (const p of NETWORK_NODES) expect(svg).toContain(`<g transform="${at(p)}"><circle class="hero-node-halo`);
    // No filter anywhere: the glow is flat, faint shapes.
    expect(svg).not.toMatch(/<filter|filter=|feGaussianBlur/);
    expect(css).not.toMatch(/filter:|blur\(/);
  });

  it('draws the two commute lines from the model, A then B, each with its letter badge', () => {
    // A dim track that stays, and over it the bright line and its glow, which draw on (pathLength 1: the
    // dash offset runs from 1 to 0 whatever the line's length).
    for (const [line, points] of [['a', LINE_A], ['b', LINE_B]] as const) {
      expect(svg).toContain(`<path class="hero-track hero-line-${line}" d="${pathD(points)}"></path>`);
      expect(svg).toContain(`<path class="hero-glow hero-draw-${line} hero-line-${line}" d="${pathD(points)}" pathLength="1"></path>`);
      expect(svg).toContain(`<path class="hero-line hero-draw-${line} hero-line-${line}" d="${pathD(points)}" pathLength="1"></path>`);
    }
    expect(svg.match(/class="hero-line hero-draw-[ab] hero-line-[ab]"/g)).toHaveLength(2);
    const live = /<g class="hero-live">([\s\S]*?)<\/g>/.exec(svg)![1];
    expect(live.match(/<path /g)).toHaveLength(4); // the part of the run that fades before the loop starts again
    expect(live.indexOf('hero-glow hero-draw-b')).toBeLessThan(live.indexOf('hero-line hero-draw-a')); // glow under line
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
    // The delivered flag stands on the recipient (#939).
    expect(svg).toContain(`<g transform="${at(RECIPIENT)}"><g class="hero-flag"><path class="hero-flag-pole" d="M0 0V-27"></path><path class="hero-flag-cloth" d="M0 -27L15 -21.5L0 -16Z"></path></g></g>`);
  });

  it('gives the package its route and the handoff place, and rests it at the recipient (the last frame)', () => {
    const pkg = /<rect class="hero-package hero-package-ride"[^>]*>/.exec(svg)![0];
    expect(svg.match(/class="hero-package hero-package-ride"/g)).toHaveLength(1);
    expect(pkg).toContain(`transform="${at(RECIPIENT)}"`);
    expect(pkg).toContain(`offset-path:path(&#x27;${pathD(PACKAGE_ROUTE)}&#x27;)`);
    expect(pkg).toContain(`--relay-split:${RELAY_SPLIT_PERCENT}%`);
    // drawn last, so it rides over the lines, the badges and the diamond
    const map = svg.slice(0, svg.indexOf('<ul class="hero-legend">'));
    expect(map.indexOf('class="hero-package ')).toBeGreaterThan(map.lastIndexOf('class="hero-relay"'));
    expect(map.indexOf('class="hero-package ')).toBeGreaterThan(map.lastIndexOf('class="hero-badge-letter"'));
    expect(map.indexOf('class="hero-package ')).toBeGreaterThan(map.lastIndexOf('class="hero-flag-cloth"'));
  });

  it('gives the package a glow and a soft trail on the same route: smaller dots, each a little later (#939)', () => {
    const trail = /<g class="hero-trail">([\s\S]*?)<\/g>/.exec(svg)![1];
    const dots = [...trail.matchAll(/<circle class="hero-package-ride" r="([\d.]+)" transform="([^"]*)" style="([^"]*)"/g)];
    expect(dots).toHaveLength(4); // the glow under the package, then three trail dots
    for (const dot of dots) {
      expect(dot[2]).toBe(at(RECIPIENT)); // at rest under the package
      expect(dot[3]).toContain(`offset-path:path(&#x27;${pathD(PACKAGE_ROUTE)}&#x27;)`);
      expect(dot[3]).toContain(`--relay-split:${RELAY_SPLIT_PERCENT}%`);
    }
    expect(dots[0][3]).not.toContain('--trail-lag');
    const lags = dots.slice(1).map((dot) => Number(/--trail-lag:([\d.]+)s/.exec(dot[3])![1]));
    const sizes = dots.slice(1).map((dot) => Number(dot[1]));
    expect(lags).toEqual([...lags].sort((a, b) => a - b));
    expect(lags[0]).toBeGreaterThan(0);
    expect(lags[lags.length - 1]).toBeLessThan(0.5);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(sizes[0]).toBeLessThan(9); // no trail dot shows around the resting package (18 wide)
    expect(svg.indexOf('<g class="hero-trail">')).toBeLessThan(svg.indexOf('class="hero-package hero-package-ride"'));
  });

  it('has a key in words at the bottom of the map: letters and shapes, not color alone', () => {
    const key = /<ul class="hero-legend">([\s\S]*?)<\/ul>/.exec(svg)![1];
    expect(key.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '|')).toBe('|Commuter A||Commuter B||Relay point||Package|');
    expect(key.match(/<svg class="hero-key"[^>]*aria-hidden="true"/g)).toHaveLength(4);
    expect(key).toMatch(/<circle class="hero-badge-a"[^>]*><\/circle><text[^>]*>A<\/text>/);
    expect(key).toMatch(/<circle class="hero-badge-b"[^>]*><\/circle><text[^>]*>B<\/text>/);
    expect(key).toMatch(/<rect class="hero-relay"[^>]*transform="rotate\(45\)"/);
    expect(key).toContain('class="hero-key-package"');
  });

  it('is in the hero of the page, after the text and outside the text\'s column (#869)', () => {
    const page = renderToStaticMarkup(<MemoryRouter><Landing initialSummary={{ status: 'loading' }} /></MemoryRouter>);
    const hero = /<section class="landing-hero"[^>]*>([\s\S]*?)<\/section>/.exec(page)![1];
    expect(hero).toContain(svg);
    expect(hero.indexOf('class="landing-hero-copy"')).toBeLessThan(hero.indexOf('class="landing-hero-map"'));
    // The last thing in the hero and a child of the hero itself: the column's width and padding do not hold
    // it, so it reaches the hero's top, bottom and right edge.
    expect(hero.endsWith(svg)).toBe(true);
    expect(hero.slice(0, hero.length - svg.length).endsWith('</div></div>')).toBe(true); // the text, the column
    // No wrapper of its own around the drawing and its key: nothing that could be a frame.
    expect(svg.startsWith('<div class="landing-hero-map"><svg class="hero-map" ')).toBe(true);
    expect(svg.match(/<div/g)).toHaveLength(1);
  });
});

describe('the colors and the motion (landing.css)', () => {
  const rule = (selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const keyframes = (name: string) => new RegExp(`@keyframes ${name} \\{((?:[^{}]*\\{[^{}]*\\})*)\\s*\\}`).exec(css)![1];

  it('uses the carrier colors, blue for A and green for B, and the package orange of the #955 direction', () => {
    const hero = rule('.landing-hero');
    // The direction's own tokens (styles/tokens.css), retinted to the ink ground; each fallback is the token's value.
    expect(hero).toMatch(/--hero-ground: var\(--ink, #0B0F17\);/);
    expect(hero).toMatch(/--hero-carrier-a: var\(--carrier-a, #3D8BFF\);/);
    expect(hero).toMatch(/--hero-carrier-b: var\(--carrier-b, #22C08A\);/);
    expect(hero).toMatch(/--hero-package: var\(--signal, #FF6A1A\);/);
    const tokens = readFileSync('client/src/styles/tokens.css', 'utf8');
    for (const pair of ['--ink: #0B0F17;', '--carrier-a: #3D8BFF;', '--carrier-b: #22C08A;', '--signal: #FF6A1A;']) expect(tokens).toContain(pair);
    expect(rule('.hero-line-a')).toMatch(/stroke: var\(--hero-carrier-a, #3D8BFF\)/);
    expect(rule('.hero-line-b')).toMatch(/stroke: var\(--hero-carrier-b, #22C08A\)/);
    expect(rule('.hero-package')).toMatch(/fill: var\(--hero-package, #FF6A1A\)/);
    // The land, its streets and the park are dark steps of the ink: none is lighter than the lines on them.
    const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    for (const name of ['land', 'shore', 'street', 'avenue', 'park']) {
      const hex = new RegExp(`--hero-${name}: (#[0-9A-F]{6});`).exec(hero)![1]!;
      expect(lum(hex), name).toBeGreaterThan(lum('#0B0F17'));
      expect(lum(hex), name).toBeLessThan(lum('#3D8BFF') / 3);
    }
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
    // The trail dots run the same animation a little later (--trail-lag); the package has no lag.
    expect(css).toMatch(/\.hero-package-ride \{ animation: hero-package-ride (\d+)s ease-in-out infinite; animation-delay: calc\(var\(--trail-lag, 0s\) - \1s\); \}/);
    expect(css).toMatch(/\.hero-relay-ring \{ animation: hero-relay-handoff \d+s ease-out infinite; \}/);
  });

  it('is one loop of 8 to 10 s on one clock: A draws, the handoff pulses, B draws, the flag goes up, the run fades (#939)', () => {
    const run = [...css.matchAll(/animation: (hero-[a-z-]+) (\d+)s/g)].filter((m) => m[1] !== 'hero-node-pulse');
    expect(run.map((m) => m[1]).sort()).toEqual(['hero-draw-a', 'hero-draw-b', 'hero-flag-up', 'hero-package-ride', 'hero-relay-handoff', 'hero-run-fade']);
    expect(new Set(run.map((m) => m[2])).size).toBe(1);
    expect(Number(run[0][2])).toBeGreaterThanOrEqual(8);
    expect(Number(run[0][2])).toBeLessThanOrEqual(10);

    /** The percents of a keyframes rule at which `property` first has and last has each value. */
    const stops = (name: string, property: string) => [...keyframes(name).matchAll(/([\d%, ]+) \{([^}]*)\}/g)].flatMap((m) => {
      const value = new RegExp(`${property}: ([^;]+);`).exec(m[2])?.[1];
      return value === undefined ? [] : m[1].split(',').map((at) => ({ at: Number(at.trim().replace('%', '')), value }));
    });
    const span = (name: string, property: string, from: string, to: string) => {
      const all = stops(name, property);
      return [Math.max(...all.filter((x) => x.value === from && x.at < 100).map((x) => x.at)), Math.min(...all.filter((x) => x.value === to && x.at > 0).map((x) => x.at))];
    };
    const [aFrom, aTo] = span('hero-draw-a', 'stroke-dashoffset', '1', '0');
    const [bFrom, bTo] = span('hero-draw-b', 'stroke-dashoffset', '1', '0');
    const ride = stops('hero-package-ride', 'offset-distance');
    const relay = ride.filter((x) => x.value === 'var(--relay-split, 55%)').map((x) => x.at);
    const leaves = Math.max(...ride.filter((x) => x.value === '0%').map((x) => x.at));
    const arrives = Math.min(...ride.filter((x) => x.value === '100%').map((x) => x.at));
    // Each line sets off just before the package does and takes exactly as long, so its head leads the package.
    expect(aFrom).toBeLessThan(leaves);
    expect(aTo - aFrom).toBe(relay[0] - leaves);
    expect(aTo).toBeLessThanOrEqual(relay[0]);
    expect(bFrom).toBeGreaterThan(relay[0]); // B's line starts during the handoff, not before it
    expect(bFrom).toBeLessThan(relay[1]);
    expect(bTo - bFrom).toBe(arrives - relay[1]);
    // The ring pulses while the package waits at the diamond.
    const ring = stops('hero-relay-handoff', 'opacity').filter((x) => x.value !== '0').map((x) => x.at);
    expect(Math.min(...ring)).toBeGreaterThanOrEqual(relay[0]);
    expect(Math.max(...ring)).toBeLessThanOrEqual(relay[1]);
    // The flag goes up as the package arrives; then the lines, the flag and the package fade together.
    const flagUp = Math.min(...stops('hero-flag-up', 'opacity').filter((x) => x.value === '1').map((x) => x.at));
    expect(flagUp).toBeGreaterThanOrEqual(arrives);
    expect(flagUp - arrives).toBeLessThanOrEqual(6);
    for (const name of ['hero-run-fade', 'hero-flag-up', 'hero-package-ride']) {
      const opacity = stops(name, 'opacity');
      expect(opacity[opacity.length - 1], name).toEqual({ at: 100, value: '0' });
      expect(Math.max(...opacity.filter((x) => x.value === '1').map((x) => x.at)), name).toBe(94);
    }
  });

  it('moves only what is cheap to move: offset-distance, stroke-dashoffset, transform and opacity (#939)', () => {
    const moved = new Set<string>();
    for (const m of css.matchAll(/@keyframes hero-[a-z-]+ \{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
      for (const d of m[1].matchAll(/([a-z-]+): [^;]+;/g)) moved.add(d[1]);
    }
    expect([...moved].sort()).toEqual(['offset-distance', 'opacity', 'stroke-dashoffset', 'transform']);
    expect(css.match(/@keyframes /g)).toHaveLength(7);
    // The glow is in the carrier colors and the package orange only.
    expect(rule('.hero-node-halo-a')).toMatch(/fill: var\(--hero-carrier-a, #3D8BFF\)/);
    expect(rule('.hero-node-halo-b')).toMatch(/fill: var\(--hero-carrier-b, #22C08A\)/);
    expect(rule('.hero-trail')).toMatch(/fill: var\(--hero-package, #FF6A1A\)/);
    expect(rule('.hero-relay-ring')).toMatch(/stroke: var\(--hero-package, #FF6A1A\)/);
    expect(rule('.hero-glow')).not.toMatch(/stroke:/); // its color is its line's (.hero-line-a / -b)
  });

  it('respects prefers-reduced-motion: nothing moves, and the package rests at the recipient', () => {
    // Every animation of the page is declared for no-preference only …
    const moving = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n  \}/.exec(css)![1];
    const outside = css.replace(moving, '').replace(/@keyframes [\s\S]*?\n\}/g, '');
    expect(outside).not.toMatch(/animation: (?!none)/);
    // … and switched off again under reduce.
    const reduce = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)![1];
    const animated = [...moving.matchAll(/(\.[a-z-]+) \{[^}]*animation: /g)].map((m) => m[1]);
    expect(animated).toHaveLength(7);
    expect(reduce).toContain(`${animated.join(', ')} { animation: none; }`);
    // Without the animation the package is at the end of its route (and the ring is not shown) …
    const supports = /@supports \(offset-path: path\('M0 0'\)\) \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(supports).toMatch(/\.hero-package-ride \{ transform: none; offset-rotate: 0deg; offset-distance: 100%; \}/);
    expect(rule('.hero-relay-ring')).toMatch(/opacity: 0/);
    // … both lines are whole (the dash that draws them on is set only where they move) and the flag is up.
    expect(css.replace(moving, '')).not.toMatch(/stroke-dasharray: 1;/);
    expect(moving.match(/stroke-dasharray: 1;/g)).toHaveLength(2);
    for (const selector of ['.hero-live', '.hero-flag', '.hero-line', '.hero-flag-cloth']) expect(rule(selector), selector).not.toMatch(/opacity/);
  });
});
