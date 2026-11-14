// @vitest-environment jsdom
// Issue #660: every simulator link of the Business page opens `/simulator?package=<shipment id>&play=1`
// (DECISIONS pass 63 and 64), URL-encoded and built by the one helper `simulatorHref`: "Watch in simulator" on
// the match result of New delivery, "View journey" in the delivery details, and the missing-delivery link.
// The hrefs are read from the rendered links. The planning note no longer promises editing (pass 64).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ShipmentResponse } from '../../shared/v2/api';
import type { DeliveryPlan } from '../../shared/v2/types';
import { simulatorHref as trackingSimulatorHref } from '../../client/src/components/business/trackingModel';
import { BusinessHeader } from '../../client/src/components/business/v2/activity/BusinessHeader';
import { headerModel } from '../../client/src/components/business/v2/activity/activityModel';
import { DeliveryDetails } from '../../client/src/components/business/v2/DeliveryDetails';
import { deliveryDetails } from '../../client/src/components/business/v2/deliveryDetailsModel';
import { NewDeliveryForm } from '../../client/src/components/business/v2/NewDeliveryForm';
import type { BusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { arrangedCard } from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import { simulatorHref } from '../../client/src/components/business/v2/page/businessPageModel';
import { ACME, BUSINESSES, EMPLOYEES, directPlan, relayPlan, unmatchedView, view } from './business-v2-details-sample';
import { DASHBOARD, ready, withHeld } from './business-v2-page-sample';
import { byLabel, click, flush, link, mount, select, typeInto } from './kitDom';

const T = 10_000;
const noop = () => {};
const LOOKUPS = { businesses: BUSINESSES, employees: EMPLOYEES, viewerBusinessId: ACME.id };

/** An ID no run produces, with every character a query string could trip on. */
const ODD_ID = 'shp 7&play=0#x/é';
const ODD_HREF = '/simulator?package=shp%207%26play%3D0%23x%2F%C3%A9&play=1';

const matched = (plan: DeliveryPlan, id: string): ShipmentResponse => ({
  ...view({ ...plan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Lab samples' }),
  matched: true,
});

/** The `href` attributes of the links with this text, as the browser reads them (`&amp;` decoded). */
function hrefs(html: string, label: string): string[] {
  const box = document.createElement('div');
  box.innerHTML = html;
  return [...box.querySelectorAll('a')].filter((a) => a.textContent === label).map((a) => a.getAttribute('href') ?? '');
}

const never = async (): Promise<ShipmentResponse> => { throw new Error('not called'); };
/** The whole Business page for a hook state, with `?shipment=` as given. */
const page = (state: BusinessWorkspaceState, shipmentId: string | null) => renderToStaticMarkup(
  <BusinessPageView
    state={state} shipmentId={shipmentId} createShipment={never} matchShipment={never} refetchNow={async () => {}}
    dismissRunChanged={noop} onOpenShipment={noop} onCloseShipment={noop} businessHref={(id) => `/business/${id}`}
  />,
);

describe('simulatorHref', () => {
  it('opens the package and plays its journey', () => {
    expect(simulatorHref('shp-0001')).toBe('/simulator?package=shp-0001&play=1');
  });

  it('URL-encodes the shipment ID, so it cannot add or change a parameter', () => {
    expect(simulatorHref(ODD_ID)).toBe(ODD_HREF);
    const query = new URLSearchParams(simulatorHref(ODD_ID).split('?')[1]);
    expect([...query.keys()]).toStrictEqual(['package', 'play']);
    expect(query.get('package')).toBe(ODD_ID);
    expect(query.get('play')).toBe('1');
  });

  it('is one helper: the page model exports the function the delivery details use', () => {
    expect(simulatorHref).toBe(trackingSimulatorHref);
    expect(deliveryDetails(matched(relayPlan, ODD_ID), LOOKUPS).journeyHref).toBe(simulatorHref(ODD_ID));
    expect(arrangedCard(matched(relayPlan, ODD_ID), LOOKUPS).simulatorHref).toBe(simulatorHref(ODD_ID));
  });
});

describe('New delivery: the match result\'s "Watch in simulator"', () => {
  async function arrangedLink(answer: ShipmentResponse) {
    const m = mount(
      <NewDeliveryForm origin={ACME} businesses={BUSINESSES} employees={EMPLOYEES} phase="planning"
        onSubmit={async () => answer} onMatch={async () => answer} onOpenDelivery={noop} onCancel={noop} />,
    );
    const c = m.container;
    select(byLabel(c, 'Recipient'), 'Bakery Row · Williamsburg');
    typeInto(byLabel(c, 'Package name'), 'Lab samples');
    typeInto(byLabel(c, 'Contents'), 'Two sealed vials');
    click(c.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    await flush();
    return link(c.querySelector('.nd-arranged')!, 'Watch in simulator').getAttribute('href');
  }

  it('a relay and a direct match both link to the playing journey', async () => {
    expect(await arrangedLink(matched(relayPlan, 'shp-41'))).toBe('/simulator?package=shp-41&play=1');
    expect(await arrangedLink(matched(directPlan, 'shp-42'))).toBe('/simulator?package=shp-42&play=1');
  }, T);

  it('URL-encodes the ID of the answer', async () => {
    expect(await arrangedLink(matched(relayPlan, ODD_ID))).toBe(ODD_HREF);
  }, T);
});

describe('Delivery details: "View journey"', () => {
  const details = (v: Parameters<typeof DeliveryDetails>[0]['view']) => renderToStaticMarkup(
    <DeliveryDetails view={v} businesses={BUSINESSES} employees={EMPLOYEES} viewerBusinessId={ACME.id}
      phase="planning" onClose={noop} onRetryMatch={noop} onEdit={noop} />,
  );

  it('matched and unmatched deliveries link to the playing journey', () => {
    expect(hrefs(details(view(relayPlan, 'scheduled')), 'View journey')).toStrictEqual(['/simulator?package=shp-7&play=1']);
    expect(hrefs(details(view(directPlan, 'delivered')), 'View journey')).toStrictEqual(['/simulator?package=shp-7&play=1']);
    expect(hrefs(details(unmatchedView()), 'View journey')).toStrictEqual(['/simulator?package=shp-7&play=1']);
  });

  it('URL-encodes the shipment ID', () => {
    expect(hrefs(details(matched(relayPlan, ODD_ID)), 'View journey')).toStrictEqual([ODD_HREF]);
  });
});

describe('The Business page', () => {
  it('an open delivery\'s journey link plays', () => {
    expect(hrefs(page(ready(), 'shp-9'), 'View journey')).toStrictEqual(['/simulator?package=shp-9&play=1']);
    expect(hrefs(page(ready(), 'shp-8'), 'View journey')).toStrictEqual(['/simulator?package=shp-8&play=1']);
  });

  it('a delivery that is not in the city: the simulator link comes from the same helper', () => {
    expect(hrefs(page(withHeld(ready(), 'shp-404', null), 'shp-404'), 'Look for it in the simulator'))
      .toStrictEqual(['/simulator?package=shp-404&play=1']);
    expect(hrefs(page(withHeld(ready(), ODD_ID, null), ODD_ID), 'Look for it in the simulator')).toStrictEqual([ODD_HREF]);
  });

  it('has no simulator link without play=1', () => {
    const pages = [page(ready(), 'shp-7'), page(ready(), 'shp-10'), page(withHeld(ready(), 'shp-404', null), 'shp-404')];
    for (const html of pages) {
      const box = document.createElement('div');
      box.innerHTML = html;
      const sim = [...box.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '').filter((h) => h.startsWith('/simulator'));
      expect(sim).toHaveLength(1);
      expect(sim[0]).toMatch(/^\/simulator\?package=[^&#]+&play=1$/);
    }
  });
});

describe('the planning note', () => {
  const SENTENCE = 'Deliveries can be added until the simulation starts.';

  it('says deliveries can be added, with no promise of editing', () => {
    expect(headerModel(DASHBOARD).phaseText).toBe(SENTENCE);
    const html = renderToStaticMarkup(<BusinessHeader dashboard={DASHBOARD} />);
    expect(html).toContain(`<span class="ba-header__phase-text">${SENTENCE}</span>`);
    expect(html).toContain(`title="${SENTENCE}"`);
    expect(html).not.toMatch(/edited/i);
  });

  it('is on the Business page while planning and gone once locked', () => {
    const planning = page(ready(), null);
    expect(planning).toContain(SENTENCE);
    expect(planning).not.toMatch(/added and edited/i);
    const locked = page(ready({ ...DASHBOARD, phase: 'locked' }), null);
    expect(locked).not.toContain(SENTENCE);
    expect(locked).toContain('The simulation is running; deliveries are read-only.');
  });
});
