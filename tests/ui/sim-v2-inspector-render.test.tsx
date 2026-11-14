import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BusinessInspector } from '../../client/src/components/sim/v2/inspector/BusinessInspector';
import { EmployeeInspector } from '../../client/src/components/sim/v2/inspector/EmployeeInspector';
import { businessInspector, employeeInspector } from '../../client/src/components/sim/v2/inspector/inspectorModel';
import { BIZ, EMP, makeMap, makeSim } from './sim-v2-inspector-fixture';

const sim = makeSim();
const map = makeMap();
const noop = () => {};
const handlers = { onSelectPackage: noop, onSelectEmployee: noop, onSelectBusiness: noop, onFocus: noop, onClear: noop };

const renderBusiness = (id: string) =>
  renderToStaticMarkup(<BusinessInspector model={businessInspector(id, sim, map)} {...handlers} />);
const renderEmployee = (id: string) =>
  renderToStaticMarkup(<EmployeeInspector model={employeeInspector(id, sim, map)} {...handlers} />);

const renders: [string, string][] = [
  ...Object.values(BIZ).map((id) => [`business ${id}`, renderBusiness(id)] as [string, string]),
  ...Object.values(EMP).map((id) => [`employee ${id}`, renderEmployee(id)] as [string, string]),
  ['unknown business', renderBusiness('biz-nope')],
  ['unknown employee', renderEmployee('emp-99')],
];

const buttons = (h: string) => h.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
const textOf = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('inspector static renders', () => {
  it.each(renders)('%s: every interactive element is a labelled button', (_, html) => {
    expect(html).not.toMatch(/<(a|input|select|textarea)\b/);
    expect(html).not.toMatch(/onclick=/i);
    const bs = buttons(html);
    expect(bs.length).toBeGreaterThan(0);
    for (const b of bs) {
      expect(b).toMatch(/type="button"/);
      expect(b).toMatch(/aria-label="[^"]+"/);
    }
    expect(bs.some((b) => /aria-label="Close (business|employee) inspector"/.test(b))).toBe(true);
  });

  it.each(renders)('%s: no NaN, undefined, raw place ID, coordinates or "hub"', (_, html) => {
    expect(html).not.toMatch(/NaN|undefined|null/);
    expect(html).not.toMatch(/\bbiz-|\bhome-/);
    expect(html).not.toMatch(/-?\d{2}\.\d{3,}/);
    expect(html).not.toMatch(/hub/i);
  });

  it('business: header, definition rows, focus action and the three lists', () => {
    const html = renderBusiness(BIZ.sender);
    expect(html).toContain('Dumbo Print Studio');
    expect(html).toContain('Office · Brooklyn');
    expect(html).toContain('55 Water St, Brooklyn, NY');
    expect(html).toContain('DUMBO, Brooklyn');
    expect(html).toContain('2 commuters work here');
    expect(html).toContain('>Focus on this business</button>');
    for (const t of ['Sent', 'Received', 'Held overnight as relay point']) expect(textOf(html)).toContain(t);
    expect(html).toContain('aria-label="Open package Menu proofs"');
    expect(html).toContain('aria-label="Inspect carrier Maya Ortiz"');
    expect(html).toContain('aria-label="Inspect business Harlem Bakery"');
    expect(html).toContain('No package stays here overnight.');
  });

  it('business: the relay business shows the held package with both ends', () => {
    const html = renderBusiness(BIZ.relay);
    const held = html.slice(html.indexOf('data-testid="insp-held"'));
    expect(held).toContain('Author galleys');
    expect(held).toContain('At relay point');
    expect(held).toContain('aria-label="Inspect business Dumbo Print Studio"');
    expect(held).toContain('aria-label="Inspect business Harlem Bakery"');
    expect(textOf(html)).toContain('No packages sent.');
  });

  it('business: the unmatched row shows its reason', () => {
    const html = renderBusiness(BIZ.recipient);
    expect(html).toContain('No commuter passes both businesses within their detour limit');
    expect(textOf(html)).toContain('Spare keys Not matched Sender No match yet To Dumbo Print Studio');
    expect(textOf(html)).not.toContain('Not matched · Not matched');
  });

  it('employee: legs with stops, relay point tag, finish, extra, reward and earnings', () => {
    const html = renderEmployee(EMP.maya);
    const text = textOf(html);
    expect(text).toContain('Maya Ortiz');
    expect(text).toContain('EMP-1');
    expect(text).toContain('Astoria');
    expect(text).toContain('Relay leg 2 of 2');
    expect(text).toContain('Day 2, 7:42 AM · LIC Bookshop Pickup at relay point Relay point');
    expect(text).toContain('+7 min');
    expect(text).toContain('$5.20');
    expect(text).toContain('Earned so far $4.50');
    expect(text).toContain('Reward of all legs $9.70');
    expect(html).toContain('>Focus on this employee</button>');
    expect(html).toContain('aria-label="Inspect business Dumbo Print Studio"');
  });

  it('employee: no legs reads "No package on this commute."', () => {
    expect(renderEmployee(EMP.avery)).toContain('No package on this commute.');
  });
});

describe('inspector.css', () => {
  const css = readFileSync('client/src/components/sim/v2/inspector/inspector.css', 'utf8');
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('keeps corners square: no border-radius over 4px', () => {
    const radii = [...noComments.matchAll(/border-radius\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) {
      const px = [...r.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
      expect(px.every((n) => n <= 4), r).toBe(true);
      expect(r).not.toMatch(/%|rem|em\b/);
    }
  });

  it('has no gradient and no box-shadow except a 1px focus ring', () => {
    expect(noComments).not.toMatch(/gradient/i);
    for (const m of noComments.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
      expect(m[1]).toMatch(/^0 0 0 1px\b/);
    }
  });

  it('reads tokens with fallbacks and gives every button a :focus-visible style', () => {
    for (const m of noComments.matchAll(/var\(([^)]*)\)/g)) expect(m[1]).toContain(',');
    for (const cls of ['insp-row-main', 'insp-link', 'insp-btn', 'insp-close']) {
      expect(noComments).toMatch(new RegExp(`\\.${cls}:focus-visible`));
    }
  });

  it('never sets a fixed width over 340px', () => {
    for (const m of noComments.matchAll(/(?:^|[\s;{])(?:min-|max-)?width\s*:\s*([^;]+);/g)) {
      for (const px of m[1].matchAll(/(\d+)px/g)) expect(Number(px[1])).toBeLessThanOrEqual(340);
    }
  });
});
