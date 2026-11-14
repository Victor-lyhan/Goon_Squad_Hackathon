import type { MapResponse, ShipmentView } from '../../../../shared/api';
import type { Business, Employee, Hub } from '../../../../shared/types';
import { Link } from 'react-router-dom';
import { Button, StatusPill, formatKg, formatMin } from '../../ui';
import { RouteMiniMap } from './RouteMiniMap';
import { STALE_SHIPMENT_MESSAGE, legRows, progressSteps, simulatorHref } from './trackingModel';
import './tracking.css';

export type TrackingDetailProps = { view: ShipmentView; businesses: Business[]; hubs: Hub[]; employees: Employee[]; map?: MapResponse | null };

export function TrackingDetail({ view, businesses, hubs, employees, map }: TrackingDetailProps) {
  const { shipment: s, plan } = view;
  const name = (id: string) => businesses.find((b) => b.id === id)?.name ?? 'Business';
  const hub = plan?.hubId ? hubs.find((h) => h.id === plan.hubId) : undefined;
  const origin = businesses.find((b) => b.id === s.originBusinessId);
  const dest = businesses.find((b) => b.id === s.destinationBusinessId);
  const rows = legRows(view, { businesses, hubs, employees });
  return (
    <div className="trk-detail">
      <h3>{s.label}</h3>
      <p>{name(s.originBusinessId)} → {name(s.destinationBusinessId)}</p>
      {plan ? <StatusPill status={view.status} /> : <span className="trk-row__nomatch">No match yet</span>}
      <dl className="trk-facts">
        <dt>Contents</dt>
        <dd>{s.description || s.label} ({s.category === 'envelope' ? 'Envelope' : 'Small box'}, {formatKg(s.weightGrams)})</dd>
        <dt>Requested ready time</dt><dd>{formatMin(s.readyMin)}</dd>
        <dt>Requested deadline</dt><dd className="trk-requested">{formatMin(s.deadlineMin)} <span className="trk-hint">(what you asked for)</span></dd>
        {plan && <><dt>Calculated arrival</dt><dd className="trk-calculated">{formatMin(plan.deliveryMin)} <span className="trk-hint">(ETA from the plan)</span></dd></>}
        {view.deliveredAtMin != null && <><dt>Delivered</dt><dd>{formatMin(view.deliveredAtMin)}</dd></>}
        {plan?.kind === 'relay' && <><dt>Relay hub</dt><dd>{hub?.name ?? 'Hub'}</dd></>}
      </dl>
      {!plan && view.unmatchedReason && <p className="trk-reason">{view.unmatchedReason}</p>}
      <h4>Route</h4>
      <RouteMiniMap
        originNodeId={origin?.nodeId ?? ''}
        destinationNodeId={dest?.nodeId ?? ''}
        hubId={plan?.kind === 'relay' ? plan.hubId : undefined}
        legRoutes={plan?.legs.map((l) => l.routeNodeIds)}
        map={map}
      />
      <h4>Progress</h4>
      <ol className="trk-steps">
        {progressSteps(view).map((st) => (
          <li key={st.key} className={`trk-step trk-step--${st.state}`} aria-current={st.state === 'current' ? 'step' : undefined}>
            {st.label}
          </li>
        ))}
      </ol>
      {rows.length > 0 && (
        <>
          <h4>Carriers</h4>
          <ol className="trk-legs">
            {rows.map((r) => (
              <li key={r.key}>
                <strong><Link to={r.employeeHref}>{r.employeeName}</Link></strong>
                <span>{r.pickupPlace} ({r.pickupTime}) → {r.dropoffPlace} ({r.dropoffTime})</span>
              </li>
            ))}
          </ol>
          <p><Link to={simulatorHref(s.id)}>Watch in simulator</Link></p>
        </>
      )}
    </div>
  );
}

/** Drawer body when ?shipment= points at a package that is not in the current city. */
export function StaleShipmentNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="trk-detail" role="status">
      <p>{STALE_SHIPMENT_MESSAGE}</p>
      <Button variant="secondary" onClick={onClose}>Close</Button>
    </div>
  );
}
