import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import { ShipmentList } from '../../client/src/components/business/ShipmentList';
import { statusLabel } from '../../client/src/ui/StatusPill';

const read = (p: string) => readFileSync(p, 'utf8');
const portal = read('client/src/components/business/BusinessPortal.css');
const tracking = read('client/src/components/business/tracking.css');
const form = read('client/src/components/business/ShipmentForm.css');
const ui = read('client/src/ui/ui.css');
const global = read('client/src/styles/global.css');

describe('business portal narrow CSS', () => {
  it('nav becomes a top row and summary cards go 2-up below 600px', () => {
    const m = /@media \(max-width: 599px\) \{([\s\S]*?)\n\}/.exec(portal)![1];
    expect(m).toMatch(/\.bp \{ grid-template-columns: minmax\(0, 1fr\)/);
    expect(m).toMatch(/\.bp-nav \{ flex-direction: row/);
    expect(m).toMatch(/\.bp-summary \{ grid-template-columns: repeat\(2/);
  });
  it('shipment rows become cards and the form stacks', () => {
    expect(tracking).toMatch(/@media \(max-width:599px\)\{[^@]*\.trk-row\{display:flex;flex-direction:column/);
    expect(form).toMatch(/max-width: 599px[\s\S]*\.shipment-form__row \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
  it('tracking drawer is full width below 600px', () => {
    expect(ui).toMatch(/@media \(max-width:599px\)\{\s*\.ui-drawer\{width:100vw/);
  });
  it('has focus-visible on rows, nav, and reduced motion', () => {
    expect(tracking).toContain('.trk-row:focus-visible');
    expect(portal).toContain('.bp-nav button:focus-visible');
    expect(global).toContain(':focus-visible');
    expect(ui).toMatch(/prefers-reduced-motion:reduce\)\{[^@]*\.ui-drawer[^@]*animation:none/);
  });
});

describe('shipment rows with Demo-city data', () => {
  const run = createInitialRun(loadDefaultScenario());
  const { businesses, settings } = run.scenario;
  it('every row is a button named with package and status', () => {
    const snap = snapshotAt(run, settings.simEndMin);
    let rows = 0;
    for (const b of businesses) {
      const d = businessDashboard(run, snap, b.id)!;
      const html = renderToStaticMarkup(
        <ShipmentList views={d.outgoing} direction="outgoing" businesses={businesses} onSelect={() => {}} />,
      );
      for (const v of d.outgoing) {
        rows++;
        const status = v.plan ? statusLabel(v.status) : 'No match yet';
        expect(html).toContain(`aria-label="${v.shipment.label}, ${status}`);
      }
      expect((html.match(/<button type="button"/g) ?? []).length).toBe(d.outgoing.length);
    }
    expect(rows).toBeGreaterThan(0);
  });
});
