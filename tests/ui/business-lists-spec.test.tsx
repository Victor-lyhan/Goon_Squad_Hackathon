import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { ShipmentView } from '../../shared/api';
import { ShipmentList } from '../../client/src/components/business/ShipmentList';
import { countText, modeText, sortShipmentViews } from '../../client/src/components/business/businessPortalModel';
import { formatMin } from '../../client/src/ui/format';

const run = createInitialRun(loadDefaultScenario());
const { businesses, hubs, settings } = run.scenario;
const times = { start: settings.simStartMin, overnight: 1440 + 6 * 60, finish: settings.simEndMin };
const BAD = [/NaN/, /undefined/, /\bnull\b/, /\bn-\d+-\d+/];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const render = (views: ShipmentView[], direction: 'outgoing' | 'incoming') =>
  renderToStaticMarkup(<ShipmentList views={views} direction={direction} businesses={businesses} hubs={hubs} onSelect={() => {}} />);

describe('outgoing/incoming lists vs spec §3A (real Demo-city data)', () => {
  for (const [label, t] of Object.entries(times)) {
    it(`every row is complete and counts match at ${label} (min ${t})`, () => {
      const snap = snapshotAt(run, t);
      let relayRows = 0;
      for (const b of businesses) {
        const d = businessDashboard(run, snap, b.id)!;
        for (const direction of ['outgoing', 'incoming'] as const) {
          const views = d[direction];
          const html = render(views, direction);
          for (const re of BAD) expect(re.test(html), `${b.name} ${direction}: ${re}`).toBe(false);
          if (views.length > 0) expect(html).toContain(countText(views.length));
          expect((html.match(/class="trk-row[ "]/g) ?? []).length).toBe(views.length);
          if (views.length === 0) expect(html).toMatch(/No (outgoing|incoming) packages yet/);
          for (const v of views) {
            const s = v.shipment;
            const other = businesses.find((x) => x.id === (direction === 'outgoing' ? s.destinationBusinessId : s.originBusinessId))!;
            expect(html).toContain(esc(s.id));
            expect(html).toContain(esc(other.name));
            if (v.plan) {
              expect(html).toContain(v.plan.kind === 'relay' ? 'Relay via ' : 'Direct');
              if (v.plan.kind === 'relay') {
                relayRows++;
                expect(html).toContain(esc(hubs.find((h) => h.id === v.plan!.hubId)!.name));
              }
              expect(html).toContain(v.status === 'delivered' && v.deliveredAtMin != null ? `Delivered ${formatMin(v.deliveredAtMin)}` : `ETA ${formatMin(v.plan.deliveryMin)}`);
            } else {
              expect(html).toContain('No match yet');
              if (v.unmatchedReason) expect(html).toContain(esc(v.unmatchedReason));
            }
          }
        }
      }
      expect(relayRows).toBeGreaterThan(0);
    });
  }

  it('sender and recipient see the same shipment with the same status and delivered time at the finish', () => {
    const snap = snapshotAt(run, times.finish);
    let checked = 0;
    for (const b of businesses) {
      for (const v of businessDashboard(run, snap, b.id)!.outgoing) {
        const rec = businessDashboard(run, snap, v.shipment.destinationBusinessId)!.incoming.find((x) => x.shipment.id === v.shipment.id);
        expect(rec).toBeDefined();
        expect(rec!.status).toBe(v.status);
        expect(rec!.deliveredAtMin).toBe(v.deliveredAtMin);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('orders newest first by createdSeq, stably, without mutating input', () => {
    const all = businesses.flatMap((b) => businessDashboard(run, snapshotAt(run, times.start), b.id)!.outgoing);
    const sorted = sortShipmentViews(all);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1].shipment.createdSeq).toBeGreaterThanOrEqual(sorted[i].shipment.createdSeq);
    expect(sortShipmentViews([...sorted].reverse()).map((v) => v.shipment.id)).toEqual(sorted.map((v) => v.shipment.id));
  });

  it('shows an unmatched package with its reason', () => {
    const base = businessDashboard(run, snapshotAt(run, times.start), businesses[0].id)!;
    const v = (base.outgoing[0] ?? base.incoming[0]) as ShipmentView;
    const fake: ShipmentView = { ...v, plan: null, status: 'unmatched', deliveredAtMin: null, unmatchedReason: 'No carrier passes both stops in time' };
    const html = render([fake], 'outgoing');
    expect(html).toContain('No match yet');
    expect(html).toContain('No carrier passes both stops in time');
    const noReason = render([{ ...fake, unmatchedReason: null }], 'outgoing');
    expect(noReason).not.toMatch(/null|undefined/);
  });

  it('modeText never leaks raw hub ids', () => {
    expect(modeText({ kind: 'relay', hubId: 'hub-zzz' }, hubs)).toBe('Relay via a hub');
    expect(modeText({ kind: 'relay', hubId: hubs[0].id }, hubs)).toBe(`Relay via ${hubs[0].name}`);
    expect(modeText(null, hubs)).toBe('');
  });

  it('390 px: ID and name wrap or carry a title; rows cannot overflow (class-based)', () => {
    const css = readFileSync('client/src/components/business/tracking.css', 'utf8');
    const narrow = css.split('@media (max-width:599px){').slice(1).join('\n');
    expect(narrow).toMatch(/\.trk-row\{[^}]*min-width:0/);
    expect(narrow).toMatch(/\.trk-row__label[^{]*\{[^}]*overflow-wrap:anywhere/);
    expect(narrow).toMatch(/\.trk-row__mode[^{]*\{[^}]*overflow-wrap:anywhere/);
    const snap = snapshotAt(run, times.finish);
    const d = businessDashboard(run, snap, businesses[0].id)!;
    const html = render([...d.outgoing, ...d.incoming], 'outgoing');
    expect(html).toMatch(/class="trk-row__label" title="/);
    expect(html).toMatch(/class="trk-row__who" title="/);
  });
});
