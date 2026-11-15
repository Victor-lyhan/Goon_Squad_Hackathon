import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PACKAGE_FILL, PACKAGE_HALO, RELAY_INK, SYMBOL_GLYPH } from '../../client/src/components/map/layers';
import { JourneyLegend } from '../../client/src/components/sim/v2/journey/JourneyLegend';
import { cssColor } from '../../client/src/components/sim/v2/legend/legendModel';
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
  it('shows the relay steps, with aria-current="step" on the current one only', () => {
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight, { 'shp-2': 'at_hub' }), map }) as Journey;
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    const t = text(html);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    // The current step (3) is the handoff: its symbol is the swap.
    expect(html).toMatch(/aria-current="step"[^>]*>\s*<span class="jt-step__n [^"]*" aria-hidden="true"><svg[^>]*data-symbol="swap"/);
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

  it('shows the extra minutes of a leg with their sign, in the step line and in the carrier line (#635)', () => {
    const base = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight, { 'shp-2': 'at_hub' }), map }) as Journey;
    const withExtra = (extraMin: number): Journey => ({
      ...base,
      carriers: base.carriers.map((c) => ({ ...c, extraMin })),
      steps: base.steps.map((s) => ({ ...s, extraMin })),
    });
    const render = (extraMin: number) => renderToStaticMarkup(<JourneyTimeline journey={withExtra(extraMin)} onSeek={noop} />);
    const lines = (html: string, re: RegExp) => (html.match(re) ?? []).map(text);
    const cases: [number, string][] = [
      [-3, '-3 min extra'], [0, '+0 min extra'], [6, '+6 min extra'], [-0.4, '+0 min extra'], [-2.6, '-3 min extra'],
      [Number.NaN, 'Extra time unavailable'], [Number.POSITIVE_INFINITY, 'Extra time unavailable'],
      [undefined as unknown as number, 'Extra time unavailable'], ['7' as unknown as number, 'Extra time unavailable'],
    ];
    for (const [extraMin, want] of cases) {
      const html = render(extraMin);
      const carrierLines = lines(html, /<span class="jt-leg__extra">.*?<\/span>/g);
      // The step's meta line holds three spans: time, carrier, extra minutes.
      const stepLines = lines(html, /<span class="jt-step__meta">.*?<\/span><\/span>/g);
      expect(carrierLines, String(extraMin)).toEqual(base.carriers.map(() => want));
      expect(stepLines.length).toBe(base.steps.length);
      for (const line of stepLines) expect(line.endsWith(want), `${extraMin}: ${line}`).toBe(true);
      expect(text(html)).not.toMatch(/NaN|undefined|Infinity/);
      if (want.startsWith('-')) expect(text(html)).not.toContain('+0 min extra');
    }
  });

  it('the map\'s symbols and short labels instead of step numbers: square, diamond, swap, flag (relay)', () => {
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight, { 'shp-2': 'at_hub' }), map }) as Journey;
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    const items = html.match(/<li class="jt-step [\s\S]*?<\/li>/g) ?? [];
    expect(items).toHaveLength(4);
    // One symbol per step, in the map's order, each an inline SVG in the map's ink (layers.ts RELAY_INK).
    expect(items.map((li) => li.match(/data-symbol="(\w+)"/)?.[1])).toEqual(['sender', 'relay', 'swap', 'recipient']);
    expect(html).toMatch(/jt-sym--sender[^>]*><rect [^>]*fill="rgb\(23, 28, 36\)"/);
    expect(html).toMatch(/jt-sym--relay[^>]*><polygon points="10,2 18,10 10,18 2,10"/);
    // The same short labels the map draws next to its symbols.
    const shorts = items.map((li) => text(li.match(/<span class="jt-step__short">.*?<\/span>/)![0]));
    expect(shorts).toEqual(j.stops.map((s) => s.label));
    expect(shorts).toEqual(['DUMBO Studio', 'Overnight · Brooklyn Roasting', 'Handed to Ben Okafor', 'To Etsy']);
    // The place line is shown only where the short label does not already name it.
    const places = items.map((li) => li.match(/<span class="(jt-step__place[^"]*)">([^<]*)<\/span>/)!.slice(1));
    expect(places).toEqual([
      ['jt-step__place jt-sr', 'DUMBO Studio'], ['jt-step__place jt-sr', 'Brooklyn Roasting'],
      ['jt-step__place', 'Brooklyn Roasting'], ['jt-step__place jt-sr', 'Etsy'],
    ]);
    // No visible step number: the number box holds only the symbol and a visually hidden copy of n.
    for (const [i, li] of items.entries()) {
      const box = li.match(/<span class="jt-step__n [^"]*" aria-hidden="true">([\s\S]*?)<\/span><span class="jt-step__body">/)![1];
      expect(box.replace(/<svg[\s\S]*?<\/svg>/, '')).toBe(`<span class="jt-sr">${i + 1}</span>`);
    }
    // Screen readers still hear "Step n:" first.
    for (const [i, li] of items.entries()) expect(li).toContain(`<span class="jt-sr">Step ${i + 1}: </span>`);
    // Thick rail in the carrier's colour within a leg, thin grey overnight between the legs; none after the last.
    const rails = items.map((li) => li.match(/<span class="jt-step__rail[^>]*>/)?.[0] ?? null);
    expect(rails[0]).toContain('jt-step__rail--carried" aria-hidden="true" style="background:#1D5075"');
    expect(rails[1]).toBe('<span class="jt-step__rail" aria-hidden="true">');
    expect(rails[2]).toContain('jt-step__rail--carried" aria-hidden="true" style="background:#0F8A5F"');
    expect(rails[3]).toBeNull();
    // The carrier lines: A and B with their letter badges, never "Leg 1" / "Leg 2".
    const t = text(html);
    expect(t).toContain('A · Cy Lam');
    expect(t).toContain('B · Ben Okafor');
    expect(t).not.toMatch(/\bLeg \d/);
    assertClean(html);
  });

  it('the flag says "Delivered <clock time>" once the snapshot has it, as on the map', () => {
    const base = simAt(T.afterDelivery, { 'shp-2': 'delivered' });
    const sim = { ...base, snapshot: { ...base.snapshot, deliveredAtMin: { 'shp-2': 1979 } } };
    const j = buildJourney({ shipmentId: 'shp-2', sim, map }) as Journey;
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    const shorts = (html.match(/<span class="jt-step__short">.*?<\/span>/g) ?? []).map(text);
    expect(shorts.at(-1)).toBe('Delivered 8:59 AM');
    expect(shorts.at(-1)).toBe(j.stops.at(-1)!.label);
  });

  it('direct: a square and a flag, only carrier A', () => {
    const j = buildJourney({ shipmentId: 'shp-1', sim: simAt(T.beforePickup), map }) as Journey;
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    expect([...html.matchAll(/data-symbol="(\w+)"/g)].map((m) => m[1])).toEqual(['sender', 'recipient']);
    const t = text(html);
    expect(t).toContain('A · Ana Ruiz');
    expect(t).not.toMatch(/\bB · |\bLeg \d|Overnight|Handed to/);
    expect(html).toContain('jt-badge--leg1" aria-hidden="true" style="background:#1D5075">A<');
    expect(html).not.toContain('jt-badge--leg2');
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
    expect(text(html)).toContain('Status Unmatched');
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
      const children = [rendered.props.children].flat() as (El | false)[];
      const button = children.find((c): c is El => !!c && c.type === 'button')!;
      (button.props.onClick as () => void)();
    }
    expect(calls).toEqual([[1042, 'biz-dumbo'], [1062, 'biz-roast'], [1952, 'biz-roast'], [1977, 'biz-etsy']]);
  });
});

describe('JourneyLegend', () => {
  it('relay: "A · <name>" and "B · <name>", each with its letter badge in its colour; no normal commute', () => {
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight), map }) as Journey;
    const html = renderToStaticMarkup(<JourneyLegend carriers={j.carriers} />);
    const t = text(html);
    expect(t).toContain('A · Cy Lam');
    expect(t).toContain('B · Ben Okafor');
    expect(t.match(/Cy Lam/g)).toHaveLength(1);
    expect(t.match(/Ben Okafor/g)).toHaveLength(1);
    expect(t).not.toContain('Normal commute');
    expect(t).toContain('Thick: carrying the package');
    expect(html).toContain('jl__badge--leg1" aria-hidden="true" style="background:#1D5075">A<');
    expect(html).toContain('jl__badge--leg2" aria-hidden="true" style="background:#0F8A5F">B<');
    assertClean(html);
  });

  it('direct: only A', () => {
    const j = buildJourney({ shipmentId: 'shp-1', sim: simAt(T.overnight), map }) as Journey;
    const t = text(renderToStaticMarkup(<JourneyLegend carriers={j.carriers} />));
    expect(t).toContain('A · Ana Ruiz');
    expect(t).not.toMatch(/\bB · /);
  });

  /** The symbol key's rows: [data-symbol, glyph or '' (package), label]. */
  const symbolRows = (html: string) => {
    const list = html.match(/<ul class="jl__list jl__symbols"[^>]*>([\s\S]*?)<\/ul>/)![1];
    return [...list.matchAll(/<li[^>]*data-symbol="(\w+)"[^>]*><span class="jl__glyph" aria-hidden="true" style="color:([^"]+)">([\s\S]*?)<\/span><span class="jl__text"><span class="jl__label">([^<]+)<\/span>/g)]
      .map((m) => ({ key: m[1], color: m[2], glyph: m[3].startsWith('<svg') ? '' : m[3], svg: m[3], label: m[4] }));
  };

  it('relay: a symbol key under the carrier rows, five rows, each glyph the map\'s SYMBOL_GLYPH in its ink (#699)', () => {
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight), map }) as Journey;
    expect(j.carriers).toHaveLength(2);
    const html = renderToStaticMarkup(<JourneyLegend carriers={j.carriers} />);
    const rows = symbolRows(html);
    expect(rows.map((r) => [r.key, r.label])).toEqual([
      ['package', 'Package waiting at a business'],
      ['sender', 'Sender'],
      ['relay', 'Overnight at the relay point'],
      ['swap', 'Handoff'],
      ['recipient', 'Delivered'],
    ]);
    expect(rows.slice(1).map((r) => r.glyph)).toEqual([SYMBOL_GLYPH.sender, SYMBOL_GLYPH.relay, SYMBOL_GLYPH.swap, SYMBOL_GLYPH.recipient]);
    for (const r of rows.slice(1)) expect(r.color).toBe(cssColor(RELAY_INK));
    // The package: an orange ring over a white halo, the map's own colours.
    expect(rows[0].svg).toContain(`stroke="${cssColor(PACKAGE_HALO)}"`);
    expect(rows[0].svg).toContain(`stroke="${cssColor(PACKAGE_FILL)}"`);
    // Under the carrier rows and the thick/thin key, which stays.
    expect(html.indexOf('jl__symbols')).toBeGreaterThan(html.indexOf('Thick: carrying the package · thin: rest of the commute'));
    expect(html.indexOf('jl__symbols')).toBeGreaterThan(html.indexOf('B · Ben Okafor'));
    expect(text(html)).not.toMatch(/Numbered stop|\bLeg [12]\b/);
    assertClean(html);
  });

  it('direct: package, sender and delivered only; no overnight and no handoff row (#699)', () => {
    const j = buildJourney({ shipmentId: 'shp-1', sim: simAt(T.overnight), map }) as Journey;
    expect(j.carriers).toHaveLength(1);
    const html = renderToStaticMarkup(<JourneyLegend carriers={j.carriers} />);
    const rows = symbolRows(html);
    expect(rows.map((r) => r.key)).toEqual(['package', 'sender', 'recipient']);
    expect(rows.slice(1).map((r) => r.glyph)).toEqual([SYMBOL_GLYPH.sender, SYMBOL_GLYPH.recipient]);
    expect(html).not.toContain(SYMBOL_GLYPH.relay);
    expect(html).not.toContain(SYMBOL_GLYPH.swap);
    expect(text(html)).not.toMatch(/Overnight|Handoff/);
    expect(text(html)).toContain('Thick: carrying the package');
  });

  it('the same person on both legs: one row per leg, A and B', () => {
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight), map }) as Journey;
    const same = j.carriers.map((c) => ({ ...c, employeeId: 'emp-3', name: 'Cy Lam' }));
    const t = text(renderToStaticMarkup(<JourneyLegend carriers={same} />));
    expect(t).toContain('A · Cy Lam');
    expect(t).toContain('B · Cy Lam');
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
  it('the legend rules (.jl*) use only tokens: no hex, no fallbacks, radius at most 6px, 1px hairline borders only (#699)', () => {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const legend = [...noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.jl\b|\.jl__/.test(m[1]));
    expect(legend.length).toBeGreaterThan(5);
    for (const [, selector, body] of legend) {
      expect(selector, selector).not.toMatch(/\.jt\b/);
      expect(body, selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, selector).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
      expect(body, selector).not.toMatch(/var\(--[\w-]+\s*,/);
      expect(body, selector).not.toMatch(/shadow/);
      for (const m of body.matchAll(/border(?:-\w+)?:\s*(\d+)px/g)) expect(Number(m[1]), selector).toBeLessThanOrEqual(1);
      for (const m of body.matchAll(/border-radius:\s*([^;]+);/g)) expect(['0', 'var(--radius)', 'var(--radius-lg)']).toContain(m[1].trim());
    }
  });

  it('step buttons have a visible focus style', () => {
    expect(css).toMatch(/\.jt-step__button:focus-visible\s*\{[^}]*outline:/);
  });
});
