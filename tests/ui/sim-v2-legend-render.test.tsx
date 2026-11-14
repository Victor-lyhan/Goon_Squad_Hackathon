import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MapLegend } from '../../client/src/components/sim/v2/legend/MapLegend';
import { cssColor } from '../../client/src/components/sim/v2/legend/legendModel';
import { LEG2, PACKAGE_FILL } from '../../client/src/components/map/layers';
import { DEFAULT_LAYERS, type LayerVisibility } from '../../client/src/components/sim/v2/workspaceModel';

const ALL_OFF: LayerVisibility = { routes: false, businesses: false, homes: false, packages: false };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const items = (html: string) => html.match(/<li\b/g)?.length ?? 0;

function assertClean(html: string) {
  const t = text(html);
  expect(t).not.toMatch(/NaN|undefined|null/);
  expect(t).not.toMatch(/\bhubs?\b/i);
  expect(t).not.toMatch(/home address/i);
  expect(t).not.toMatch(/\b(biz|home|emp|shp)-[\w-]+/);
}

describe('MapLegend', () => {
  it('is open by default: a "Legend" button with aria-expanded and a real list of rows', () => {
    const html = renderToStaticMarkup(<MapLegend mode="network" layers={DEFAULT_LAYERS} />);
    expect(html).toMatch(/<section[^>]*aria-label="Map legend"/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-expanded="true"[^>]*>/);
    expect(text(html)).toMatch(/^Legend/);
    const controls = html.match(/aria-controls="([^"]+)"/)![1];
    expect(html).toContain(`id="${controls}"`);
    expect(html).not.toMatch(/\bhidden=""/);
    expect(html).toMatch(/<ul class="ml__list">/);
    expect(items(html)).toBe(6);
    const t = text(html);
    for (const s of ['Network business · every one is a relay point', 'Home neighborhood', 'Commuter vehicle', 'Package', 'Normal commute', 'Delivery route']) {
      expect(t).toContain(s);
    }
    // Swatches are drawn with CSS from the map constants and hidden from screen readers.
    expect(html).toContain(`background:${cssColor(PACKAGE_FILL)}`);
    expect(html.match(/class="ml__swatch-box" aria-hidden="true"/g)).toHaveLength(6);
    assertClean(html);
  });

  it('collapsed: aria-expanded="false" and the body is hidden', () => {
    const html = renderToStaticMarkup(<MapLegend mode="network" layers={DEFAULT_LAYERS} open={false} onOpenChange={() => {}} />);
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toMatch(/<div[^>]*class="ml__body"[^>]*hidden=""/);
  });

  it('adds the dimmed row with a selection', () => {
    const html = renderToStaticMarkup(<MapLegend mode="network" layers={DEFAULT_LAYERS} hasSelection />);
    expect(items(html)).toBe(7);
    expect(text(html)).toContain('Dimmed: not part of the selection');
  });

  it('journey mode: numbered stop, both legs, no carrier names', () => {
    const html = renderToStaticMarkup(<MapLegend mode="journey" layers={DEFAULT_LAYERS} />);
    expect(items(html)).toBe(6);
    const t = text(html);
    for (const s of ['Numbered stop, in journey order', 'Leg 1 route', 'Leg 2 route', 'Normal commute (faint)']) expect(t).toContain(s);
    expect(html).toMatch(/class="ml__swatch ml__swatch--numbered"[^>]*>1<\/span>/);
    expect(html).toContain(`background:${cssColor(LEG2)}`);
    expect(html).toMatch(/height:4px/);
    expect(html).toMatch(/height:2px/);
    assertClean(html);
  });

  it('all layers hidden in network mode: one line instead of the list', () => {
    const html = renderToStaticMarkup(<MapLegend mode="network" layers={ALL_OFF} hasSelection />);
    expect(text(html)).toBe('Legend − All map layers are hidden. Turn a layer on in the left panel.');
    expect(html).not.toContain('<ul');
    expect(items(html)).toBe(0);
    expect(html).toMatch(/aria-expanded="true"/);
  });

  it('journey mode ignores hidden layers', () => {
    const html = renderToStaticMarkup(<MapLegend mode="journey" layers={ALL_OFF} />);
    expect(items(html)).toBe(6);
    expect(text(html)).not.toContain('All map layers are hidden');
  });
});
