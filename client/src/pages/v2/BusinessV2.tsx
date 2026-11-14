// MVP II Business workspace page (#461). Mounted at /nyc/business/:id during the preview and at
// /business/:id after the cutover: it only ever changes the query string (`?shipment=`), never the path.
// The open delivery's route map (#549) loads GET /api/v2/map once per run and when that delivery's plan
// is new to the loaded map, never on the poll (DECISIONS pass 52).
import { useCallback } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useBusinessWorkspace } from '../../components/business/v2/live/useBusinessWorkspace';
import { BusinessPageView } from '../../components/business/v2/page/BusinessPageView';
import { pageScreen, siblingBusinessPath, withShipment } from '../../components/business/v2/page/businessPageModel';
import { DeliveryRouteSlot } from '../../components/business/v2/route/DeliveryRoutePreview';
import { useDeliveryMap } from '../../components/business/v2/route/useDeliveryMap';

export default function BusinessV2() {
  const { id = '' } = useParams();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const shipmentId = params.get('shipment') || null;
  // The open delivery goes to the hook: one the dashboard does not list (held here as the relay point) is read there (#581).
  const ws = useBusinessWorkspace(id, undefined, shipmentId);

  const screen = pageScreen(ws, shipmentId);
  const openView = screen.kind === 'delivery' ? screen.view : null;
  const routeMap = useDeliveryMap(ws.runId, openView?.plan ?? null);

  const onOpenShipment = useCallback((shipment: string) => setParams((p) => withShipment(p, shipment)), [setParams]);
  const onCloseShipment = useCallback(() => setParams((p) => withShipment(p, null)), [setParams]);
  const businessHref = useCallback((other: string) => siblingBusinessPath(pathname, other), [pathname]);

  return (
    <BusinessPageView
      key={id}
      state={ws}
      shipmentId={shipmentId}
      createShipment={ws.createShipment}
      matchShipment={ws.matchShipment}
      refetchNow={ws.refetchNow}
      dismissRunChanged={ws.dismissRunChanged}
      onOpenShipment={onOpenShipment}
      onCloseShipment={onCloseShipment}
      businessHref={businessHref}
      deliveryRoute={openView ? <DeliveryRouteSlot slot={routeMap.slot} view={openView} onRetry={routeMap.retry} /> : null}
    />
  );
}
