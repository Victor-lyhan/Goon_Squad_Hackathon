// @vitest-environment jsdom
// The Business shipments table and the delivery details in a real DOM (#609): one child per table cell
// (the stacked 390 px cell is a two-column grid: label, value), Esc closes the details, and focus returns
// to the delivery's row, or to the table's heading when that row is filtered out.
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import { INITIAL_TABLE, type TableState } from '../../client/src/components/business/v2/page/businessPageModel';
import type { BusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { NO_FILTERS } from '../../client/src/components/business/v2/shipmentsTableModel';
import { ATLAS, DASHBOARD, UNMATCHED_REASON, ready } from './business-v2-page-sample';
import { button, byLabel, click, mount, press, textOf } from './kitDom';

const T = 10_000;
const RELAY_ID = 'shp-8';
const UNMATCHED_ID = 'shp-9';

type PageProps = { initialId?: string | null; state?: BusinessWorkspaceState; initialTable?: TableState };

/** The page with `?shipment=` kept in state, as the route does. */
function Page({ initialId = null, state = ready(), initialTable }: PageProps) {
  const [id, setId] = useState<string | null>(initialId);
  return (
    <BusinessPageView
      state={state} shipmentId={id} initialTable={initialTable}
      createShipment={async () => { throw new Error('not called'); }}
      matchShipment={async () => { throw new Error('not called'); }}
      refetchNow={async () => {}} dismissRunChanged={() => {}}
      onOpenShipment={setId} onCloseShipment={() => setId(null)}
      businessHref={(b) => `/nyc/business/${b}`}
    />
  );
}

function setup(props: PageProps = {}) {
  const m = mount(<Page {...props} />);
  const c = m.container;
  const rows = () => [...c.querySelectorAll<HTMLTableRowElement>('tr.bw-row')];
  return {
    ...m,
    rows,
    row: (id: string) => {
      const found = rows().filter((r) => textOf(r.querySelector('td[data-label="Shipment ID"]')!) === id);
      if (found.length !== 1) throw new Error(`row(): ${found.length} rows for ${id}`);
      return found[0];
    },
    panel: () => c.querySelector<HTMLElement>('.bd-panel'),
    heading: () => c.querySelector<HTMLElement>('.bd-title'),
  };
}

const filtered = (query: string): TableState => ({ ...INITIAL_TABLE, filters: { ...NO_FILTERS, query } });
const cell = (row: Element, label: string) => row.querySelector(`td[data-label="${label}"]`)!;

describe('shipments table cells in a real DOM (#609)', () => {
  it('every cell of every row has exactly one child, so the stacked cell is label + value', () => {
    const p = setup();
    expect(p.rows()).toHaveLength(DASHBOARD.outgoing.length + DASHBOARD.incoming.length);
    for (const row of p.rows()) {
      const cells = [...row.querySelectorAll('td')];
      expect(cells).toHaveLength(11); // the ten columns and the Remove button's cell (#949)
      for (const td of cells) {
        expect(td.childNodes.length, `${td.dataset.label} of ${textOf(row)}`).toBe(1);
      }
    }
  }, T);

  it('a relay row: "Relay via <business>" is one element in the Plan cell', () => {
    const plan = cell(setup().row(RELAY_ID), 'Plan');
    expect(plan.children).toHaveLength(1);
    expect(plan.childNodes).toHaveLength(1);
    expect(textOf(plan.children[0])).toBe(`Relay via ${ATLAS.name}`);
  }, T);

  it('an unmatched row: "No match" and the reason are one element in the Plan cell', () => {
    const plan = cell(setup().row(UNMATCHED_ID), 'Plan');
    expect(plan.children).toHaveLength(1);
    expect(plan.childNodes).toHaveLength(1);
    const reason = plan.children[0].querySelector('.bw-reason')!;
    expect(textOf(reason)).toBe(UNMATCHED_REASON);
    expect(textOf(plan.children[0])).toBe(`No match${UNMATCHED_REASON}`);
  }, T);
});

describe('delivery details keyboard and focus in a real DOM (#609)', () => {
  it('Enter on a row opens the details with focus on the heading; Esc closes them and focus is on that row', () => {
    const p = setup();
    const row = p.row(RELAY_ID);
    row.focus();
    press('Enter');
    expect(p.panel()).not.toBeNull();
    expect(document.activeElement).toBe(p.heading());
    expect(row.getAttribute('aria-selected')).toBe('true');

    press('Escape');
    expect(p.panel()).toBeNull();
    expect(document.activeElement).toBe(p.row(RELAY_ID));
    expect(p.row(RELAY_ID).getAttribute('aria-selected')).toBe('false');
    // Enter opens it again from where the user is.
    press('Enter');
    expect(document.activeElement).toBe(p.heading());
  }, T);

  it('the Close button closes the details and focus is on that row', () => {
    const p = setup();
    p.row(UNMATCHED_ID).focus();
    press('Enter');
    click(button(p.panel()!, 'Close'));
    expect(p.panel()).toBeNull();
    expect(document.activeElement).toBe(p.row(UNMATCHED_ID));
  }, T);

  it('Esc from any control inside the details closes them', () => {
    const p = setup({ initialId: UNMATCHED_ID });
    const retry = button(p.panel()!, 'Try matching again');
    retry.focus();
    press('Escape');
    expect(p.panel()).toBeNull();
    expect(document.activeElement).toBe(p.row(UNMATCHED_ID));
  }, T);

  it('Esc that a control inside already handled does not close the details', () => {
    const p = setup({ initialId: RELAY_ID });
    const close = button(p.panel()!, 'Close');
    close.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault(); });
    close.focus();
    press('Escape');
    expect(p.panel()).not.toBeNull();
    expect(document.activeElement).toBe(close);
  }, T);

  it('Esc outside the details does nothing', () => {
    const p = setup({ initialId: RELAY_ID });
    const search = byLabel(p.container, 'Search');
    search.focus();
    press('Escape');
    expect(p.panel()).not.toBeNull();
    expect(document.activeElement).toBe(search);
  }, T);

  it('the row is filtered out: focus goes to the table heading', () => {
    const p = setup({ initialId: UNMATCHED_ID, initialTable: filtered('Fabric') });
    expect(p.rows()).toHaveLength(1);
    expect(document.activeElement).toBe(p.heading());
    press('Escape');
    expect(p.panel()).toBeNull();
    const caption = p.container.querySelector('caption')!;
    expect(document.activeElement).toBe(caption);
    expect(textOf(caption)).toMatch(/^Deliveries/);
    expect(caption.getAttribute('tabindex')).toBe('-1');
  }, T);

  it('no row matches the filters: focus goes to the empty state\'s title', () => {
    const p = setup({ initialId: UNMATCHED_ID, initialTable: filtered('zzz') });
    expect(p.rows()).toHaveLength(0);
    click(button(p.panel()!, 'Close'));
    expect(p.panel()).toBeNull();
    expect(textOf(document.activeElement!)).toBe('No deliveries match the filters');
  }, T);

  it('focus that is somewhere else on the page stays there when the delivery is cleared', () => {
    const page = (shipmentId: string | null) => (
      <BusinessPageView
        state={ready()} shipmentId={shipmentId}
        createShipment={async () => { throw new Error('not called'); }}
        matchShipment={async () => { throw new Error('not called'); }}
        refetchNow={async () => {}} dismissRunChanged={() => {}}
        onOpenShipment={() => {}} onCloseShipment={() => {}}
        businessHref={(b) => `/nyc/business/${b}`}
      />
    );
    const m = mount(page(RELAY_ID));
    const search = byLabel(m.container, 'Search');
    search.focus();
    // The URL loses ?shipment= (browser Back) while the user is in the search field.
    m.rerender(page(null));
    expect(m.container.querySelector('.bd-panel')).toBeNull();
    expect(document.activeElement).toBe(search);
  }, T);

  it('moving from one delivery to another keeps focus on the new heading', () => {
    const p = setup({ initialId: RELAY_ID });
    click(p.row(UNMATCHED_ID));
    expect(p.panel()).not.toBeNull();
    expect(document.activeElement).toBe(p.heading());
    expect(textOf(p.heading()!)).toBe('Spare keys');
  }, T);
});
