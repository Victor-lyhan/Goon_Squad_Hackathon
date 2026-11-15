// #831: the simulator's Play/Pause control floats at the bottom center of the map panel, always on
// screen. The markup side is in sim-v2-play-render / sim-v2-pageqa-doc (the group is in the map slot,
// in no panel); this file pins the CSS that puts it there, as measured in headless Chrome at
// 1440, 1280, 1070 and 900 px (map 760, 600, 390 and 220 px wide): centered on the map, inside it,
// both buttons hit by a real click, the legend never under or over it.
// #852 (human feedback): it is a dark translucent pill with white icons and labels, no white panel, and
// it shows Play/Pause and "Back to start" only (no step line, no note under the buttons).
import { describe, expect, it } from 'vitest';
import { PILL_BLUR, TOKENS, parseCss, read, type Rule } from './sim-v2-qa-css-rules';

const FILES = [
  'client/src/components/sim/v2/compose/compose.css',
  'client/src/components/sim/v2/controls/controls.css',
  'client/src/components/sim/v2/SimWorkspace.css',
  'client/src/components/sim/v2/page/page.css',
  'client/src/components/sim/v2/legend/legend.css',
  'client/src/components/map/map.css',
];
const RULES: Rule[] = FILES.flatMap((f) => parseCss(read(f), f));
/** The declarations of the plain (no @media) rules for exactly this selector, later ones winning. */
const decls = (selector: string) =>
  new Map(RULES.filter((r) => !r.media && r.selectors.includes(selector)).flatMap((r) => r.decls));
const px = (v: string | undefined) => (v && /^-?\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : NaN);

// ---------- Colour maths: a translucent token over a backdrop ----------
type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
/** `var(--token, #hex)` or `color-mix(in srgb, var(--token, #hex) N%, transparent)`: the token's colour and its opacity. */
function paint(value: string | undefined): { rgb: RGB; alpha: number } {
  const m = /^(?:color-mix\(in srgb, )?var\((--[\w-]+), (#[0-9A-Fa-f]{6})\)(?: (\d+)%, transparent\))?$/.exec(value ?? '');
  if (!m) throw new Error(`not a token colour: ${value}`);
  expect(TOKENS.get(m[1])?.toLowerCase(), m[1]).toBe(m[2].toLowerCase());
  return { rgb: hex(m[2]), alpha: m[3] === undefined ? 1 : Number(m[3]) / 100 };
}
const over = (top: { rgb: RGB; alpha: number }, under: RGB): RGB =>
  top.rgb.map((c, i) => top.alpha * c + (1 - top.alpha) * under[i]) as RGB;
const luminance = (rgb: RGB) => {
  const [r, g, b] = rgb.map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** The lightest and the darkest thing the map can show behind the pill: a white day map, a black night map. */
const BACKDROPS: Array<[name: string, rgb: RGB]> = [['white (the day map at its lightest)', [255, 255, 255]], ['black (the night map at its darkest)', [0, 0, 0]]];

describe('the floating Play/Pause control (#831)', () => {
  const bar = decls('.spc-playbar');

  it('is anchored to the map slot: bottom center, whatever the panels beside the map do', () => {
    expect(decls('.spc-map').get('position')).toBe('relative'); // its containing block is the map, not the page
    expect(bar.get('position')).toBe('absolute');
    expect([bar.get('left'), bar.get('transform')]).toEqual(['50%', 'translateX(-50%)']);
    expect(px(bar.get('bottom'))).toBeGreaterThanOrEqual(24); // above Google's attribution strip
    for (const p of ['top', 'right', 'inset', 'margin', 'margin-left']) expect(bar.has(p), p).toBe(false);
  });

  it('is always on screen: the workspace is fixed to the viewport and does not scroll, and no rule hides the control', () => {
    const page = decls('.sim-v2');
    expect([page.get('position'), page.get('bottom')]).toEqual(['fixed', '0']);
    expect(decls('.sw-frame').get('overflow')).toBe('hidden');
    expect(decls('.sw-frame').get('height')).toBe('100%');
    const hiding = RULES.filter((r) => r.selectors.some((s) => /spc-playbar|ctl-playback|ctl-row|ctl-btn|ctl-primary|ctl-icon|ctl-label/.test(s)))
      .filter((r) => r.decls.some(([k, v]) => (k === 'display' && v === 'none') || (k === 'visibility' && v !== 'visible')
        || (k === 'opacity' && v !== '1') || k === 'clip' || k === 'clip-path'));
    expect(hiding).toEqual([]);
    // One layout for every width: nothing about it changes in a media query.
    expect(RULES.filter((r) => r.media && r.selectors.some((s) => s.includes('spc-playbar')))).toEqual([]);
  });

  it('is as wide as its two buttons and never wider than the map', () => {
    expect(bar.get('box-sizing')).toBe('border-box');
    // Its content never changes size while a journey plays (#852: no step line), so no fixed width is needed.
    expect(bar.get('width')).toBe('max-content');
    expect(bar.get('max-width')).toMatch(/^calc\(100% - .+\)$/);
    // In a map narrower than the two buttons the row wraps instead of running out of the control.
    expect(decls('.ctl-row').get('flex-wrap')).toBe('wrap');
    expect(decls('.ctl-row').get('justify-content')).toBe('center');
    expect(decls('.ctl-btn').get('min-width')).toBe('0');
    // "Back to start" does not move when Play becomes Pause: the Play/Pause button has one width for both.
    expect(px(decls('.ctl-primary').get('min-width'))).toBeGreaterThanOrEqual(88);
  });

  it('is on top of the legend, the banners and the day/night badge, so nothing can cover Play', () => {
    const z = (selector: string) => Number(decls(selector).get('z-index') ?? 0);
    for (const other of ['.spc-legend', '.spc-banner', '.map-v2__daynight', '.map-v2__tooltip']) {
      expect(z('.spc-playbar'), other).toBeGreaterThan(z(other));
    }
  });

  it('the legend left the bottom edge, where it is as wide as the gap beside a centered control', () => {
    const legend = decls('.spc-legend');
    expect(legend.get('position')).toBe('absolute');
    expect(legend.has('bottom')).toBe(false);
    // Under the day/night badge (top 12px, 27px tall), in the same corner.
    expect(px(legend.get('top'))).toBeGreaterThanOrEqual(44);
    expect(legend.get('left')).toBe(decls('.map-v2__daynight').get('left'));
    // In a short window it scrolls rather than reaching down to the control.
    expect(legend.get('overflow-y')).toBe('auto');
    expect(legend.get('max-height')).toMatch(/^calc\(100% - \d+px\)$/);
    const reserved = Number(/(\d+)px/.exec(legend.get('max-height')!)![1]);
    expect(reserved).toBeGreaterThanOrEqual(px(legend.get('top')) + px(bar.get('bottom')) + 100);
  });
});

describe('the control is a dark translucent pill with white icons and labels (#852)', () => {
  const bar = decls('.spc-playbar');
  const btn = decls('.ctl-btn');

  it('the pill: the --text ink at 72% over a blur of the map, round, no white panel, no border, no shadow', () => {
    expect(bar.get('background')).toBe('color-mix(in srgb, var(--text, #171C24) 72%, transparent)');
    expect(paint(bar.get('background'))).toEqual({ rgb: [23, 28, 36], alpha: 0.72 }); // rgba(23, 28, 36, 0.72)
    expect(bar.get('backdrop-filter')).toBe(PILL_BLUR);
    expect(bar.get('-webkit-backdrop-filter')).toBe(PILL_BLUR); // Safari before 18
    for (const p of ['border', 'box-shadow']) expect(bar.has(p), p).toBe(false);
    // A full pill: the radius is half of the control's height (a 44 px button plus the padding on both sides).
    const height = px(btn.get('min-height')) + 2 * px(bar.get('padding')?.replace(/^var\(--space-1, (4px)\)$/, '$1'));
    expect(px(bar.get('border-radius'))).toBe(height / 2);
    expect(px(btn.get('border-radius'))).toBe(px(btn.get('min-height')) / 2);
  });

  it('the buttons have no fill of their own: white label and icon on the pill, 44 px touch targets', () => {
    expect(btn.get('background')).toBe('transparent');
    expect(btn.get('border')).toBe('0');
    expect(btn.get('color')).toBe('var(--panel, #FFFFFF)');
    expect(px(btn.get('min-height'))).toBeGreaterThanOrEqual(44);
    expect(decls('.ctl-block').get('color')).toBe('var(--panel, #FFFFFF)');
    // The Play/Pause button is the pill's, not an accent block on it.
    expect(decls('.ctl-primary').has('background')).toBe(false);
    expect(decls('.ctl-primary').get('font-weight')).toBe('600');
    // The icons are drawn in the label's colour.
    const src = read('client/src/components/sim/v2/controls/PlaybackControls.tsx');
    expect(src.match(/fill="currentColor"/g)).toHaveLength(1);
    expect(src).not.toMatch(/fill="#|stroke="#/);
  });

  it.each(BACKDROPS)('reads on %s: labels at least 4.5:1, also on hover; a disabled label and the focus ring at least 3:1', (_name, map) => {
    const pill = over(paint(bar.get('background')), map);
    const white = paint(btn.get('color'));
    expect(white).toEqual({ rgb: [255, 255, 255], alpha: 1 });
    expect(contrast(white.rgb, pill)).toBeGreaterThanOrEqual(4.5);
    const hover = over(paint(decls('.ctl-btn:hover:not([aria-disabled="true"])').get('background')), pill);
    expect(contrast(white.rgb, hover)).toBeGreaterThanOrEqual(4.5);
    // Disabled: dimmed, and still readable.
    const off = over(paint(decls('.ctl-btn[aria-disabled="true"]').get('color')), pill);
    expect(contrast(off, pill)).toBeGreaterThanOrEqual(3);
    expect(contrast(off, pill)).toBeLessThan(contrast(white.rgb, pill));
    // The focus ring is drawn inside the button, so its background is the pill whatever the map shows.
    const focus = decls('.ctl-btn:focus-visible');
    expect(focus.get('outline')).toBe('2px solid var(--panel, #FFFFFF)');
    expect(px(focus.get('outline-offset'))).toBeLessThan(0);
    expect(contrast([255, 255, 255], pill)).toBeGreaterThanOrEqual(3);
    expect(contrast([255, 255, 255], hover)).toBeGreaterThanOrEqual(3);
  });

  it('shows nothing under the buttons: the notes and the step announcement are visually hidden, still in the page', () => {
    const hidden = RULES.filter((r) => r.selectors.includes('.ctl-status'));
    expect(hidden).toHaveLength(1);
    expect(hidden[0].selectors).toEqual(['.ctl-note', '.ctl-status']);
    const d = new Map(hidden[0].decls);
    expect([d.get('position'), d.get('width'), d.get('height'), d.get('overflow'), d.get('clip-path')])
      .toEqual(['absolute', '1px', '1px', 'hidden', 'inset(50%)']);
    expect(d.has('display')).toBe(false); // the live region is never display: none
    expect(RULES.filter((r) => r.selectors.some((s) => s.includes('ctl-line')))).toEqual([]);
    // Nothing in the block takes room besides the row of buttons: no gap, no margins.
    expect(decls('.ctl-block').get('gap')).toBe('0');
    expect(RULES.filter((r) => r.selectors.some((s) => s.startsWith('.spc-playbar ')))).toEqual([]);
  });

  it('a refused step is the one text shown: a dark chip above the pill, out of its flow', () => {
    const error = decls('.ctl-error');
    expect(error.get('position')).toBe('absolute'); // the pill keeps its size
    expect(error.get('bottom')).toMatch(/^calc\(100% \+ .+\)$/);
    expect([error.get('left'), error.get('transform')]).toEqual(['50%', 'translateX(-50%)']);
    expect(error.get('max-width')).toBe('100%');
    expect(error.get('color')).toBe('var(--panel, #FFFFFF)');
    for (const [, map] of BACKDROPS) {
      expect(contrast([255, 255, 255], over(paint(error.get('background')), map))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
