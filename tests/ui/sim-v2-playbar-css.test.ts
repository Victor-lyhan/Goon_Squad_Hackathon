// #831: the simulator's Play/Pause control floats at the bottom center of the map panel, always on
// screen. The markup side is in sim-v2-play-render / sim-v2-pageqa-doc (the group is in the map slot,
// in no panel); this file pins the CSS that puts it there, as measured in headless Chrome at
// 1440, 1280, 1070 and 900 px (map 760, 600, 390 and 220 px wide): centered on the map, inside it,
// both buttons hit by a real click, the legend never under or over it.
import { describe, expect, it } from 'vitest';
import { parseCss, read, type Rule } from './sim-v2-qa-css-rules';

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
    const hiding = RULES.filter((r) => r.selectors.some((s) => /spc-playbar|ctl-playback|ctl-row|ctl-btn|ctl-primary/.test(s)))
      .filter((r) => r.decls.some(([k, v]) => (k === 'display' && v === 'none') || (k === 'visibility' && v !== 'visible')
        || (k === 'opacity' && v !== '1') || k === 'clip' || k === 'clip-path'));
    expect(hiding).toEqual([]);
    // One layout for every width: nothing about it changes in a media query.
    expect(RULES.filter((r) => r.media && r.selectors.some((s) => s.includes('spc-playbar')))).toEqual([]);
  });

  it('is never wider than the map: a fixed width capped at the map width minus a margin on each side', () => {
    expect(bar.get('box-sizing')).toBe('border-box');
    const width = px(bar.get('width'));
    expect(width).toBeGreaterThanOrEqual(240); // room for Play and "Back to start" on one row
    expect(width).toBeLessThanOrEqual(360);
    expect(bar.get('max-width')).toMatch(/^calc\(100% - .+\)$/);
    // In a map narrower than the two buttons the row wraps instead of running out of the control.
    expect(decls('.ctl-row').get('flex-wrap')).toBe('wrap');
    expect(decls('.ctl-btn').get('min-width')).toBe('0');
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

  it('looks like the other map overlays: panel fill, hairline border, radius token, no shadow', () => {
    expect(bar.get('background')).toMatch(/^var\(--panel\b/);
    expect(bar.get('border')).toMatch(/^1px solid var\(--border\b/);
    expect(bar.get('border-radius')).toMatch(/^var\(--radius\b/);
    expect(bar.has('box-shadow')).toBe(false);
  });

  it('the empty step line takes no room in the control and is still in the page', () => {
    // The live region is never display: none (controls.css), so the rows are spaced by margins here.
    expect(decls('.spc-playbar .ctl-block').get('gap')).toBe('0');
    const spaced = RULES.find((r) => r.selectors.includes('.spc-playbar .ctl-status:not(:empty)'))!;
    expect(spaced.selectors).toEqual(['.spc-playbar .ctl-note', '.spc-playbar .ctl-status:not(:empty)', '.spc-playbar .ctl-error']);
    expect(spaced.decls.map(([k]) => k)).toEqual(['margin-top']);
    expect(decls('.ctl-status').has('display')).toBe(false);
  });
});
