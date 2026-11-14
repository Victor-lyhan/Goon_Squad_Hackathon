import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JourneyLegend } from '../../client/src/components/sim/v2/journey/JourneyLegend';
import { JourneyTimeline } from '../../client/src/components/sim/v2/journey/JourneyTimeline';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { T, map, simAt } from './sim-v2-journey-sample';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noop = () => {};

function assertClean(html: string) {
  const t = text(html);
  expect(t).not.toMatch(/NaN|undefined|null/);
  expect(t).not.toMatch(/\bhub\b/i);
  expect(t).not.toMatch(/\b(biz|home|emp|shp)-[\w-]+/); // no raw IDs
}

describe('JourneyTimeline', () => {
  it('shows the numbered relay steps, with aria-current="step" on the current one only', () => {
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight, { 'shp-2': 'at_hub' }), map }) as Journey;
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    const t = text(html);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step"[^>]*>\s*<span[^>]*aria-hidden="true">3<\/span>/);
    for (const s of ['Step 1: Pickup at sender', 'Step 2: Drop at relay point', 'Step 3: Pickup at relay point', 'Step 4: Delivered to recipient']) {
      expect(t).toContain(s);
    }
    expect(t).toContain('Day 1, 5:22 PM');
    expect(t).toContain('Day 2, 8:57 AM');
    expect(t).toContain('Brooklyn Roasting');
    expect(t).toContain('Cy Lam');
    expect(t).toContain('Ben Okafor');
    expect(t).toContain('+5 min extra');
    expect(t).toContain('At the relay point');
    expect((html.match(/<button/g) ?? []).length).toBe(4);
    expect(html).toContain('type="button"');
    assertClean(html);
  });

  it('after delivery: no step is current, still clean', () => {
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.afterDelivery, { 'shp-2': 'delivered' }), map }) as Journey;
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    expect(html).not.toContain('aria-current');
    expect(text(html)).toContain('Delivered');
    assertClean(html);
  });

  it('a direct journey with an unknown place and carrier never prints IDs', () => {
    const sparse = {
      ...map,
      businesses: map.businesses.filter((b) => b.id !== 'biz-etsy'),
      employees: map.employees.filter((e) => e.id !== 'emp-1'),
    };
    const j = buildJourney({ shipmentId: 'shp-1', sim: simAt(T.beforePickup), map: sparse }) as Journey;
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    expect(text(html)).toContain('Unknown place');
    expect(text(html)).toContain('Unknown carrier');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    assertClean(html);
  });

  it('unmatched shows the reason', () => {
    const j = buildJourney({ shipmentId: 'shp-3', sim: simAt(T.overnight), map })!;
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    expect(text(html)).toContain('No commuter passes both businesses within their detour limit.');
    expect(html).not.toContain('<button');
    assertClean(html);
  });

  it('each step button calls onSeek(timeMin, placeId)', () => {
    // Static render cannot click; call the element tree's handlers directly.
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight), map }) as Journey;
    const calls: [number, string][] = [];
    const tree = JourneyTimeline({ journey: j, onSeek: (t, p) => calls.push([t, p]) });
    type El = { type: unknown; props: Record<string, unknown> };
    const kids = (tree as unknown as El).props.children as unknown[];
    // The steps list is the <ol> (the header and the per-leg <ul> come before it).
    const items = (kids.find((k) => (k as El | null)?.type === 'ol') as El).props.children as El[];
    for (const item of items) {
      const rendered = (item.type as (p: unknown) => El)(item.props);
      ((rendered.props.children as El).props.onClick as () => void)();
    }
    expect(calls).toEqual([[1042, 'biz-dumbo'], [1062, 'biz-roast'], [1952, 'biz-roast'], [1977, 'biz-etsy']]);
  });
});

describe('JourneyLegend', () => {
  it('names each carrier once, with its leg, plus the normal commute', () => {
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight), map }) as Journey;
    const html = renderToStaticMarkup(<JourneyLegend carriers={j.carriers} />);
    const t = text(html);
    expect(t.match(/Cy Lam/g)).toHaveLength(1);
    expect(t.match(/Ben Okafor/g)).toHaveLength(1);
    expect(t).toContain('Leg 1');
    expect(t).toContain('Leg 2');
    expect(t).toContain('Normal commute');
    expect(html).toContain('#28618A');
    expect(html).toContain('#C03A64');
    assertClean(html);
  });

  it('the same person on both legs is named once', () => {
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight), map }) as Journey;
    const same = j.carriers.map((c) => ({ ...c, employeeId: 'emp-3', name: 'Cy Lam' }));
    const t = text(renderToStaticMarkup(<JourneyLegend carriers={same} />));
    expect(t.match(/Cy Lam/g)).toHaveLength(1);
    expect(t).toContain('Legs 1 and 2');
  });
});

describe('journey.css', () => {
  const css = readFileSync(resolve(__dirname, '../../client/src/components/sim/v2/journey/journey.css'), 'utf8');
  it('square corners: no radius over 4px', () => {
    const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1]);
    for (const r of radii) {
      for (const px of r.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px[1])).toBeLessThanOrEqual(4);
      expect(r).not.toMatch(/%|rem|em/);
    }
  });
  it('no shadows, no gradients', () => {
    expect(css).not.toMatch(/box-shadow/);
    expect(css).not.toMatch(/gradient/);
  });
  it('step buttons have a visible focus style', () => {
    expect(css).toMatch(/\.jt-step__button:focus-visible\s*\{[^}]*outline:/);
  });
});
