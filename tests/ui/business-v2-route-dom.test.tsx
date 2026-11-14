// @vitest-environment jsdom
// useDeliveryMap + the route slot in a real DOM (#549), wired the way pages/v2/BusinessV2.tsx wires them:
// GET /api/v2/map once per run, not on polls, again for a plan the map does not list; Retry after a failure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapResponse, ShipmentResponse } from '../../shared/v2/api';
import type { BusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import { pageScreen } from '../../client/src/components/business/v2/page/businessPageModel';
import { DeliveryRouteSlot } from '../../client/src/components/business/v2/route/DeliveryRoutePreview';
import { useDeliveryMap } from '../../client/src/components/business/v2/route/useDeliveryMap';
import { ApiRequestError } from '../../client/src/api/client';
import { ACME, BAKERY, BUSINESSES, DASHBOARD, RELAY, ready } from './business-v2-page-sample';
import { button, click, flush, mount, textOf } from './kitDom';

const never = async (): Promise<ShipmentResponse> => { throw new Error('not called'); };
const noop = () => {};

const MAP: MapResponse = {
  runId: 'run-1', businesses: BUSINESSES, homes: [], employees: [],
  polylines: [
    { from: ACME.id, to: 'biz-atlas', encoded: null },
    { from: 'biz-atlas', to: BAKERY.id, encoded: null },
    { from: ACME.id, to: BAKERY.id, encoded: null },
    { from: BAKERY.id, to: ACME.id, encoded: null },
  ],
};

type GetMap = (opts?: { signal?: AbortSignal }) => Promise<MapResponse>;

function Page({ state, shipmentId, getMap }: { state: BusinessWorkspaceState; shipmentId: string | null; getMap: GetMap }) {
  const screen = pageScreen(state, shipmentId);
  const open = screen.kind === 'delivery' ? screen.view : null;
  const routeMap = useDeliveryMap(state.runId, open?.plan ?? null, getMap);
  return (
    <BusinessPageView
      state={state} shipmentId={shipmentId} createShipment={never} matchShipment={never} refetchNow={async () => {}}
      dismissRunChanged={noop} onOpenShipment={noop} onCloseShipment={noop} businessHref={(id) => `/b/${id}`}
      deliveryRoute={open ? <DeliveryRouteSlot slot={routeMap.slot} view={open} onRetry={routeMap.retry} /> : null}
    />
  );
}

beforeEach(() => vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', ''));
afterEach(() => vi.unstubAllEnvs());

describe('delivery route map in a real DOM', () => {
  it('loads the map once per run and never on the poll', async () => {
    const getMap = vi.fn<GetMap>(async () => MAP);
    const m = mount(<Page state={ready()} shipmentId={RELAY.shipment.id} getMap={getMap} />);
    await flush();
    const route = () => m.container.querySelector('section.bdr');
    expect(route()).not.toBeNull();
    expect(textOf(route()!)).toContain('Drop at relay point');
    // Ten polls, each a new dashboard version, same run and plans; opening another delivery of the run.
    for (let v = 8; v < 18; v += 1) {
      m.rerender(<Page state={ready({ ...DASHBOARD, version: v })} shipmentId={v % 2 ? 'shp-7' : RELAY.shipment.id} getMap={getMap} />);
      await flush();
    }
    expect(getMap).toHaveBeenCalledTimes(1);
    // A new run requests again.
    m.rerender(<Page state={ready(DASHBOARD, 'run-2')} shipmentId={RELAY.shipment.id} getMap={getMap} />);
    await flush();
    expect(getMap).toHaveBeenCalledTimes(2);
  });

  it('requests again when the open delivery has a plan the map does not list', async () => {
    const getMap = vi.fn<GetMap>(async () => MAP);
    const m = mount(<Page state={ready()} shipmentId={RELAY.shipment.id} getMap={getMap} />);
    await flush();
    const rematched = { ...RELAY, plan: { ...RELAY.plan!, id: 'plan-shp-8-b', relayBusinessId: BAKERY.id,
      legs: [{ ...RELAY.plan!.legs[0], stops: [{ ...RELAY.plan!.legs[0].stops[0], placeId: BAKERY.id }, RELAY.plan!.legs[0].stops[1]] }, RELAY.plan!.legs[1]] } };
    const next = { ...DASHBOARD, version: 9, outgoing: DASHBOARD.outgoing.map((v) => (v.shipment.id === RELAY.shipment.id ? rematched : v)) };
    m.rerender(<Page state={ready(next)} shipmentId={RELAY.shipment.id} getMap={getMap} />);
    await flush();
    expect(getMap).toHaveBeenCalledTimes(2);
    m.rerender(<Page state={ready({ ...next, version: 10 })} shipmentId={RELAY.shipment.id} getMap={getMap} />);
    await flush();
    expect(getMap).toHaveBeenCalledTimes(2);
  });

  it('a failed request shows one line with Retry; the table and details keep working; Retry loads the map', async () => {
    let fail = true;
    const getMap = vi.fn<GetMap>(async () => { if (fail) throw new ApiRequestError(0, 'Network error'); return MAP; });
    const m = mount(<Page state={ready()} shipmentId={RELAY.shipment.id} getMap={getMap} />);
    await flush();
    const alert = m.container.querySelector('.bdr-line--problem');
    expect(alert && textOf(alert)).toBe("Couldn't load the map. Retry");
    expect(m.container.querySelector('.bd-panel')).not.toBeNull();
    expect(m.container.querySelectorAll('.bw-row').length).toBeGreaterThan(0);
    fail = false;
    click(button(m.container, 'Retry'));
    await flush();
    expect(getMap).toHaveBeenCalledTimes(2);
    expect(m.container.querySelector('.bdr-line--problem')).toBeNull();
    expect(m.container.querySelector('section.bdr')).not.toBeNull();
  });

  it('without a browser key the map area shows the key-missing state', async () => {
    const m = mount(<Page state={ready()} shipmentId={RELAY.shipment.id} getMap={async () => MAP} />);
    await flush();
    expect(textOf(m.container.querySelector('.bdr__map')!)).toContain('Google Maps key missing.');
  });
});
