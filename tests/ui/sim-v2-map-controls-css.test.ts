// #864 (QUESTIONS 22:25, DECISIONS pass 100): every control that sits on the simulator map has the look
// of the Play / Back to start pill (#852, `.spc-playbar`): the --text ink at 72% over a blur of the map,
// white text and icons, no white panel, no light border. The controls are the "Reconnecting" and
// map-pending banners, the overnight card, the legend (toggle and open panel) and the day/night badge
// (by day and at night). This file reads the CSS and pins that look, its contrast over the lightest and
// the darkest map, and that nothing moved. The pill itself is pinned in sim-v2-playbar-css.test.ts.
// The map's full-area states (key missing, error, loading) and the hover tooltip are not controls and
// keep their look.
import { describe, expect, it } from 'vitest';
import { PILL_BACKGROUND, PILL_BLUR, PILL_RADII, TOKENS, parseCss, read, type Rule } from './sim-v2-qa-css-rules';

const COMPOSE = 'client/src/components/sim/v2/compose/compose.css';
const LEGEND = 'client/src/components/sim/v2/legend/legend.css';
const MAP = 'client/src/components/map/map.css';
const RULES: Rule[] = [COMPOSE, LEGEND, MAP].flatMap((f) => parseCss(read(f), f));
/** The declarations of the plain (no @media) rules for exactly this selector, later ones winning. */
const decls = (selector: string) =>
  new Map(RULES.filter((r) => !r.media && r.selectors.includes(selector)).flatMap((r) => r.decls));
/** legend.css writes `var(--token)` with no fallback (sim-v2-legend-css.test.ts); the other two files write the fallback. */
const noFallback = (value: string) => value.replace(/var\((--[\w-]+), [^)]+\)/g, 'var($1)');
const WHITE = 'var(--panel, #FFFFFF)';

/** The controls on the map: the rule that paints each one, and whether its file writes fallbacks. */
const CONTROLS: Array<[name: string, selector: string, fallbacks: boolean]> = [
  ['the "Reconnecting" and map-pending banners', '.spc-banner', true],
  ['the overnight card', '.spc-overnight', true],
  ['the legend (toggle and open panel)', '.ml', false],
  ['the day/night badge (day and night)', '.map-v2__daynight', true],
];

// ---------- Colour maths: a translucent token over a backdrop ----------
type RGB = [number, number, number];
type Paint = { rgb: RGB; alpha: number };
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
/** `var(--token[, #hex])` or `color-mix(in srgb, var(--token[, #hex]) N%, transparent)`: the token's colour and its opacity. */
function paint(value: string | undefined): Paint {
  const m = /^(?:color-mix\(in srgb, )?var\((--[\w-]+)(?:, (#[0-9A-Fa-f]{6}))?\)(?: (\d+)%, transparent\))?$/.exec(value ?? '');
  if (!m) throw new Error(`not a token colour: ${value}`);
  const token = TOKENS.get(m[1]);
  if (!token || !/^#[0-9A-Fa-f]{6}$/.test(token)) throw new Error(`${m[1]} is not a colour token`);
  if (m[2]) expect(m[2].toLowerCase(), m[1]).toBe(token.toLowerCase());
  return { rgb: hex(token), alpha: m[3] === undefined ? 1 : Number(m[3]) / 100 };
}
const over = (top: Paint, under: RGB): RGB => top.rgb.map((c, i) => top.alpha * c + (1 - top.alpha) * under[i]) as RGB;
const luminance = (rgb: RGB) => {
  const [r, g, b] = rgb.map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** The lightest and the darkest thing the map can show behind a control: a white day map, a black night map. */
const BACKDROPS: Array<[name: string, rgb: RGB]> = [['white (the day map at its lightest)', [255, 255, 255]], ['black (the night map at its darkest)', [0, 0, 0]]];
const PILL = paint(PILL_BACKGROUND);

describe('every control on the simulator map is the dark translucent pill of Play (#864)', () => {
  const bar = decls('.spc-playbar');

  it('the reference is the Play pill: the --text ink at 72% over an 8px blur', () => {
    expect(bar.get('background')).toBe(PILL_BACKGROUND);
    expect(PILL_BACKGROUND).toBe('color-mix(in srgb, var(--text, #171C24) 72%, transparent)');
    expect(PILL).toEqual({ rgb: [23, 28, 36], alpha: 0.72 });
    expect([bar.get('backdrop-filter'), bar.get('-webkit-backdrop-filter')]).toEqual([PILL_BLUR, PILL_BLUR]);
    expect(PILL_BLUR).toBe('blur(8px)');
  });

  describe.each(CONTROLS)('%s: %s', (_name, selector, fallbacks) => {
    const rule = decls(selector);
    const written = (value: string) => (fallbacks ? value : noFallback(value));

    it('has the pill background: the same ink at 72%, not a second dark', () => {
      expect(rule.get('background')).toBe(written(bar.get('background')!));
      expect(paint(rule.get('background'))).toEqual(PILL);
      expect(rule.has('background-color')).toBe(false);
    });

    it('blurs the map behind it, with the -webkit- prefix', () => {
      expect(rule.get('backdrop-filter')).toBe(bar.get('backdrop-filter'));
      expect(rule.get('-webkit-backdrop-filter')).toBe(bar.get('-webkit-backdrop-filter'));
    });

    it('has white text', () => {
      expect(rule.get('color')).toBe(written(WHITE));
      expect(paint(rule.get('color'))).toEqual({ rgb: [255, 255, 255], alpha: 1 });
    });

    it('has no border, no outline and no shadow, and is round', () => {
      for (const p of ['border', 'border-color', 'border-width', 'border-style', 'outline', 'box-shadow']) expect(rule.has(p), p).toBe(false);
      expect(rule.get('border-radius')).toBe(PILL_RADII[selector]);
      expect(parseFloat(rule.get('border-radius')!)).toBeGreaterThanOrEqual(12);
    });

    it.each(BACKDROPS)('its white text is at least 4.5:1 over %s', (_backdrop, map) => {
      expect(contrast([255, 255, 255], over(paint(rule.get('background')), map))).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('no rule of these controls is a white panel or has a light border any more', () => {
    const own = RULES.filter((r) => r.selectors.some((s) => /^\.(spc-banner|spc-overnight|spc-legend|ml\b|ml__|map-v2__daynight)/.test(s)));
    expect(own.length).toBeGreaterThan(15);
    const light: string[] = [];
    for (const r of own) {
      for (const [prop, value] of r.decls) {
        const here = `${r.selectors.join(', ')} { ${prop}: ${value} }`;
        // A fill is the pill's ink, nothing, or the 14% white of a hovered button (as on the Play buttons).
        if (/^background(-color)?$/.test(prop) && value !== 'transparent' && paint(value).alpha > 0.14 && noFallback(value) !== noFallback(PILL_BACKGROUND)) light.push(here);
        // No frame: `border: 0` on the toggle and the ring swatch (whose border is the map's colour, set inline) are the only borders.
        if (/^border(-(top|right|bottom|left))?(-color)?$/.test(prop) && value !== '0' && !(r.selectors[0] === '.ml__swatch--ring' && value === '2px solid')) light.push(here);
        if (prop === 'box-shadow') light.push(here);
        if (/--(border|warn|muted|accent|accent-soft|bg)\b/.test(value)) light.push(here);
      }
    }
    expect(light).toEqual([]);
    // The night badge has no look of its own: one pill for the day and the night.
    expect(RULES.filter((r) => r.selectors.some((s) => /daynight--(day|night)/.test(s)))).toEqual([]);
    // The legend's scroll box paints nothing: the pill is the legend inside it.
    expect(decls('.spc-legend').has('background')).toBe(false);
  });

  it('the icons are white: they are drawn in the text colour', () => {
    const badge = /export function DayNightBadge[\s\S]*?\n}\n/.exec(read('client/src/components/map/GoogleBaseMap.tsx'))?.[0] ?? '';
    expect(badge.match(/(fill|stroke)="currentColor"/g)).toHaveLength(3); // the moon; the sun's disc and rays
    expect(badge).not.toMatch(/(fill|stroke)="#/);
    expect(decls('.map-v2__daynight-icon').has('color')).toBe(false);
    const card = read('client/src/components/sim/v2/compose/OvernightCard.tsx');
    expect(card).toContain('fill="currentColor"');
    expect(card).not.toMatch(/(fill|stroke)="#/);
    expect(decls('.spc-overnight__icon').has('color')).toBe(false);
    // The legend's + / − takes the toggle's white, and the toggle takes the legend's. #874: the + / −
    // has no class and no rule (it had `ml__chevron` with no rule behind it).
    const legend = read('client/src/components/sim/v2/legend/MapLegend.tsx');
    expect(legend).not.toContain('ml__chevron');
    expect(legend).toContain(`<span aria-hidden="true">{isOpen ? '−' : '+'}</span>`);
    expect(RULES.filter((r) => r.selectors.some((s) => s.includes('ml__chevron')))).toEqual([]);
    expect(decls('.ml__toggle').get('color')).toBe('inherit');
  });
});

describe('the softer texts and the legend toggle stay readable on the pill (#864)', () => {
  const SOFT: Array<[name: string, selector: string]> = [
    ['the map-pending banner', '.spc-banner--quiet'],
    ['the legend labels "Dimmed" and "Normal commute"', '.ml__row--dimmed .ml__label'],
  ];

  it.each(SOFT)('%s is the white token, dimmed, and at least 4.5:1 over a white and a black map', (_name, selector) => {
    const soft = paint(decls(selector).get('color'));
    expect(soft.rgb).toEqual([255, 255, 255]);
    expect(soft.alpha).toBeLessThan(1);
    for (const [, map] of BACKDROPS) {
      const pill = over(PILL, map);
      expect(contrast(over(soft, pill), pill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('both dimmed legend rows share the rule, and a quiet banner only changes the text colour', () => {
    const rule = RULES.filter((r) => r.selectors.includes('.ml__row--dimmed .ml__label'));
    expect(rule).toHaveLength(1);
    expect(rule[0].selectors).toEqual(['.ml__row--dimmed .ml__label', '.ml__row--baseline .ml__label']);
    expect([...decls('.spc-banner--quiet').keys()]).toEqual(['color']);
  });

  it.each(BACKDROPS)('the legend toggle over %s: white on its hover fill at least 4.5:1, a white focus ring inside it at least 3:1', (_name, map) => {
    const toggle = decls('.ml__toggle');
    expect(toggle.get('background')).toBe('transparent');
    expect(toggle.get('border')).toBe('0');
    const pill = over(PILL, map);
    const hover = over(paint(decls('.ml__toggle:hover').get('background')), pill);
    expect(contrast([255, 255, 255], hover)).toBeGreaterThanOrEqual(4.5);
    // The ring is drawn inside the toggle, so what is behind it is the pill whatever the map shows.
    const focus = decls('.ml__toggle:focus-visible');
    expect(focus.get('outline')).toBe('2px solid var(--panel)');
    expect(parseFloat(focus.get('outline-offset')!)).toBeLessThan(0);
    expect(contrast([255, 255, 255], pill)).toBeGreaterThanOrEqual(3);
    expect(contrast([255, 255, 255], hover)).toBeGreaterThanOrEqual(3);
    // Round like the legend, 1px inside it, so the fill and the ring stay inside the corners.
    expect(parseFloat(toggle.get('border-radius')!)).toBe(parseFloat(decls('.ml').get('border-radius')!) - parseFloat(decls('.ml').get('padding')!));
  });
});

describe('the legend swatches stay readable on the dark pill (#864)', () => {
  it('every shape has a thin white outline, as the map draws its markers; it takes no room', () => {
    const shapes = RULES.filter((r) => r.selectors.includes('.ml__swatch--dot') && r.decls.some(([p]) => p === 'outline'));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].selectors).toEqual(['.ml__swatch--dot', '.ml__swatch--ring', '.ml__swatch--line']);
    expect(shapes[0].decls).toEqual([['outline', '1px solid var(--panel)']]);
    // The map's own outline is white too (layers.ts OUTLINE).
    expect(read('client/src/components/map/layers.ts')).toContain('export const OUTLINE: RGBA = [255, 255, 255, 255];');
    for (const [, map] of BACKDROPS) expect(contrast([255, 255, 255], over(PILL, map))).toBeGreaterThanOrEqual(3);
  });

  it('a glyph (the overnight diamond, the delivered flag) is outlined in white by four 1px shadows with no blur', () => {
    const glyph = decls('.ml__swatch--glyph').get('text-shadow') ?? '';
    expect(glyph.split(', ')).toEqual(['1px 0 0 var(--panel)', '-1px 0 0 var(--panel)', '0 1px 0 var(--panel)', '0 -1px 0 var(--panel)']);
  });

  it('the "Dimmed" sample keeps a fainter outline, and no swatch changed size', () => {
    const dim = paint(decls('.ml__row--dimmed .ml__swatch').get('outline-color'));
    expect(dim.rgb).toEqual([255, 255, 255]);
    expect(dim.alpha).toBeLessThan(0.5);
    expect([decls('.ml__swatch-box').get('width'), decls('.ml__swatch-box').get('height')]).toEqual(['20px', '14px']);
    expect([decls('.ml__swatch--dot').get('width'), decls('.ml__swatch--dot').get('height')]).toEqual(['10px', '10px']);
    expect(decls('.ml__swatch--line').get('width')).toBe('20px');
  });
});

describe('nothing moved (#864): positions, sizes, z-order and the legend scroll are as before', () => {
  it('the banners: top center of the map, one line, the second one under the first', () => {
    const banner = decls('.spc-banner');
    expect([banner.get('position'), banner.get('top'), banner.get('left'), banner.get('transform'), banner.get('z-index')])
      .toEqual(['absolute', 'var(--space-3, 12px)', '50%', 'translateX(-50%)', '2']);
    expect(banner.get('white-space')).toBe('nowrap');
    expect(banner.get('font-size')).toBe('var(--text-xs, 12px)');
    expect(decls('.spc-banner + .spc-banner').get('top')).toBe('calc(var(--space-3, 12px) + 32px)');
  });

  it('the overnight card: the center of the map, above the banners, never wider than the map', () => {
    const card = decls('.spc-overnight');
    expect([card.get('position'), card.get('top'), card.get('left'), card.get('transform'), card.get('z-index')])
      .toEqual(['absolute', '50%', '50%', 'translate(-50%, -50%)', '3']);
    expect(card.get('max-width')).toBe('calc(100% - 48px)');
    expect([card.get('font-size'), card.get('font-weight'), card.get('line-height')]).toEqual(['var(--text-lg, 18px)', '600', '1.2']);
  });

  it('the day/night badge: the top-left corner, above the map, taking no clicks', () => {
    const badge = decls('.map-v2__daynight');
    expect([badge.get('position'), badge.get('top'), badge.get('left'), badge.get('z-index'), badge.get('pointer-events')])
      .toEqual(['absolute', 'var(--space-3, 12px)', 'var(--space-3, 12px)', '2', 'none']);
    expect([badge.get('font-size'), badge.get('line-height'), badge.get('white-space')]).toEqual(['var(--text-xs, 12px)', '1.4', 'nowrap']);
  });

  it('the legend: top-left under the badge (#831), at most 240px wide, scrolling in a short window', () => {
    const corner = decls('.spc-legend');
    expect([corner.get('position'), corner.get('left'), corner.get('top'), corner.get('z-index'), corner.get('max-height'), corner.get('overflow-y')])
      .toEqual(['absolute', 'var(--space-3, 12px)', '48px', '2', 'calc(100% - 200px)', 'auto']);
    const legend = decls('.ml');
    expect([legend.get('box-sizing'), legend.get('width'), legend.get('max-width')]).toEqual(['border-box', 'max-content', 'min(240px, 100%)']);
    // Play stays on top of all of them (bottom center, z-index 3).
    expect([decls('.spc-playbar').get('z-index'), decls('.spc-playbar').get('bottom')]).toEqual(['3', '32px']);
  });

  it('the legend fits inside the narrowest map (#874): 12px in from both sides, as Play, its labels wrapping', () => {
    // A 900px window with both panels open leaves a 220px map; the legend was up to 240px and ran past it.
    const corner = decls('.spc-legend');
    // The corner box: at most the map less the 12px inset on each side (as Play), and at most the legend's
    // 240px, so the empty scroll box never reaches past the legend and takes the map's clicks.
    expect(corner.get('max-width')).toBe('min(240px, 100% - 2 * var(--space-3, 12px))');
    expect(decls('.spc-playbar').get('max-width')).toBe('calc(100% - 2 * var(--space-3, 12px))');
    expect(corner.get('left')).toBe('var(--space-3, 12px)');
    // The legend box is never wider than that corner box (196px in a 220px map), never wider than 240px in a wide one.
    expect(decls('.ml').get('max-width')).toBe('min(240px, 100%)');
    // A label wraps beside its swatch (the swatch keeps its 20x14 box); a long word breaks rather than overflows.
    expect(decls('.ml__label').get('min-width')).toBe('0');
    expect(decls('.ml__label').get('overflow-wrap')).toBe('anywhere');
    expect([decls('.ml__swatch-box').get('flex'), decls('.ml__swatch-box').get('width'), decls('.ml__swatch-box').get('height')]).toEqual(['0 0 auto', '20px', '14px']);
    // No white-space: nowrap anywhere in the legend, so nothing can push it wider than its box.
    const nowrap = RULES.filter((r) => r.selectors.some((s) => /^\.ml\b/.test(s)) && r.decls.some(([p, v]) => p === 'white-space' && v === 'nowrap'));
    expect(nowrap).toEqual([]);
  });

  it('each box is as large as before: where a 1px border was, there is 1px more padding', () => {
    expect(decls('.spc-banner').get('padding')).toBe('calc(var(--space-1, 4px) + 1px) calc(var(--space-3, 12px) + 1px)');
    expect(decls('.spc-overnight').get('padding')).toBe('calc(var(--space-3, 12px) + 1px) calc(var(--space-4, 16px) + 1px)');
    expect(decls('.map-v2__daynight').get('padding')).toBe('calc(var(--space-1, 4px) + 1px) calc(var(--space-2, 8px) + 1px)');
    // The legend had a 1px frame and a 1px line between the toggle and the rows.
    expect(decls('.ml').get('padding')).toBe('1px');
    expect(decls('.ml__toggle').get('padding')).toBe('var(--space-1) var(--space-2)');
    expect(decls('.ml__body').get('padding')).toBe('calc(var(--space-1) + 1px) var(--space-2) var(--space-2)');
  });
});

describe('what is not a control keeps its look (#864)', () => {
  it('the map states (key missing, error, loading) and the hover tooltip are still light panels', () => {
    for (const selector of ['.map-v2__panel', '.map-v2__tooltip']) {
      const rule = decls(selector);
      expect([rule.get('background'), rule.get('border'), rule.get('color')], selector)
        .toEqual(['var(--panel, #FFFFFF)', '1px solid var(--border, #E3E3DE)', 'var(--text, #171C24)']);
      expect(rule.has('backdrop-filter'), selector).toBe(false);
    }
    expect(decls('.map-v2__overlay').get('background')).toBe('color-mix(in srgb, var(--bg, #F7F7F4) 85%, transparent)');
    expect(decls('.map-v2__overlay--solid').get('background')).toBe('var(--bg, #F7F7F4)');
    // The area behind the tiles: light by day, the ink at night.
    expect(decls('.map-v2').get('background')).toBe('var(--bg, #F7F7F4)');
    expect(decls('.map-v2--night').get('background')).toBe('var(--text, #171C24)');
  });

  it('the blur is on the controls only: the Play pill, the banners, the card, the legend and the badge', () => {
    const blurred = RULES.filter((r) => r.decls.some(([p]) => p === 'backdrop-filter')).map((r) => r.selectors.join(', '));
    expect(blurred).toEqual(['.spc-banner', '.spc-playbar', '.spc-overnight', '.ml', '.map-v2__daynight']);
  });
});
