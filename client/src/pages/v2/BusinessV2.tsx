// MVP II Business workspace page (#461). Mounted at /nyc/business/:id during the preview and at
// /business/:id after the cutover: it only ever changes the query string (`?shipment=`), never the path.
import { useCallback } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useBusinessWorkspace } from '../../components/business/v2/live/useBusinessWorkspace';
import { BusinessPageView } from '../../components/business/v2/page/BusinessPageView';
import { siblingBusinessPath, withShipment } from '../../components/business/v2/page/businessPageModel';

export default function BusinessV2() {
  const { id = '' } = useParams();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const shipmentId = params.get('shipment') || null;
  const ws = useBusinessWorkspace(id);

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
    />
  );
}
