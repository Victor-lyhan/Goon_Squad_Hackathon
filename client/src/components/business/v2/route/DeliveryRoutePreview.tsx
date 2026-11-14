// The open delivery on the NYC map (#549): sender, relay point and recipient, each carrier leg in its
// colour (LEG1, LEG2 from the map component) and the numbered stops, with the stops also as text under
// the map so nothing depends on the map loading. Same look as the simulator's package journey.
// `DeliveryRouteSlot` is what the Business page mounts: loading line, map, or one line with Retry.
import { useMemo } from 'react';
import type { MapResponse, ShipmentView } from '../../../../../../shared/v2/api';
import { GoogleBaseMap } from '../../../map/GoogleBaseMap';
import { toneLabelColor } from '../../../map/layers';
import type { LayerVisibility, RouteTone } from '../../../map/types';
import type { DeliveryMapSlot } from './deliveryMapLoader';
import { NO_ROUTE_NOTE, STRAIGHT_NOTE, buildDeliveryRoute } from './deliveryRouteModel';
import './deliveryRoute.css';

const VISIBLE: LayerVisibility = { routes: true, businesses: true, homes: false, packages: false };
const NO_MOVERS: never[] = [];

const LEG_TEXT: Record<RouteTone, string> = { leg1: 'First carrier', leg2: 'Second carrier, next morning' };

export type DeliveryRoutePreviewProps = { view: ShipmentView; map: MapResponse };

export function DeliveryRoutePreview({ view, map }: DeliveryRoutePreviewProps) {
  const model = useMemo(() => buildDeliveryRoute(view, map), [view, map]);
  const legend = model.tones.length > 1 ? model.tones : [];

  return (
    <section className="bdr" aria-label="Delivery route on the map">
      <div className="bdr__map">
        <GoogleBaseMap
          places={model.places}
          routes={model.routes}
          movers={NO_MOVERS}
          visible={VISIBLE}
          stops={model.stops}
          fitTo={model.fitTo ?? 'places'}
        />
      </div>

      {legend.length > 0 && (
        <ul className="bdr__legend" aria-label="Map legend">
          {legend.map((tone) => (
            <li key={tone}>
              <span className="bdr__swatch" style={{ background: toneLabelColor(tone) }} aria-hidden="true" />
              {LEG_TEXT[tone]}
            </li>
          ))}
        </ul>
      )}

      {!view.plan && <p className="bdr__note">{NO_ROUTE_NOTE}</p>}
      {model.straight && <p className="bdr__note">{STRAIGHT_NOTE}</p>}

      {model.stopTexts.length > 0 && (
        <ol className="bdr__stops" aria-label="Route stops">
          {model.stopTexts.map((s) => (
            <li key={s.n}>
              <span className="bdr__n">{s.n}</span> {s.label} · {s.placeName} <span className="bdr__time">{s.time}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export type DeliveryRouteSlotProps = { slot: DeliveryMapSlot; view: ShipmentView; onRetry: () => void };

export function DeliveryRouteSlot({ slot, view, onRetry }: DeliveryRouteSlotProps) {
  switch (slot.kind) {
    case 'none':
      return null;
    case 'loading':
      return <p className="bdr-line" role="status">{slot.text}</p>;
    case 'failed':
      return (
        <p className="bdr-line bdr-line--problem" role="alert">
          {slot.text}{' '}
          <button type="button" className="bdr-retry" onClick={onRetry}>Retry</button>
        </p>
      );
    case 'map':
      return <DeliveryRoutePreview view={view} map={slot.map} />;
  }
}

export default DeliveryRoutePreview;
