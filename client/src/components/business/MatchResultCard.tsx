import type { ShipmentResponse } from '../../../../shared/api';
import type { Business, Employee, Hub } from '../../../../shared/types';
import { Link } from 'react-router-dom';
import { Button, Card, formatCents, formatKg, formatMin } from '../../ui';
import { carrierHref, simulatorHref } from './trackingModel';
import { jobIdFor } from '../../../../shared/types';
import './ShipmentForm.css';

export type MatchResultCardProps = {
  response: ShipmentResponse;
  businesses: Business[];
  hubs: Hub[];
  employees: Employee[];
  onViewTracking: () => void;
  onEdit: () => void;
  onRetry: () => void;
};

export function MatchResultCard({ response, businesses, hubs, employees, onViewTracking, onEdit, onRetry }: MatchResultCardProps) {
  const { shipment, plan } = response;
  const recipient = businesses.find((b) => b.id === shipment.destinationBusinessId)?.name ?? 'Recipient';

  if (!response.matched || !plan) {
    return (
      <Card className="match-card match-card--unmatched" title={<span>No matching commute yet</span>}>
        <p>{response.unmatchedReason ?? 'No employee commute fits this package yet.'}</p>
        <p>{shipment.label} to {recipient}. Your request stays in your list.</p>
        <div className="match-card__actions">
          <Button variant="secondary" onClick={onEdit}>Edit request</Button>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      </Card>
    );
  }

  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? 'Employee';
  const carriers = plan.legs.map((l, i) => ({ key: `${l.tripId}-${i}`, name: nameOf(l.employeeId), href: carrierHref(l.employeeId, jobIdFor(plan.id, i)) }));
  const hub = plan.kind === 'relay' ? hubs.find((h) => h.id === plan.hubId)?.name ?? 'Hub' : null;
  const collectionMin = plan.legs[0]?.stops[0]?.serviceStartMin;

  return (
    <Card className="match-card match-card--matched" title={<span>Delivery arranged</span>}>
      <dl className="match-card__list">
        <dt>Shipment ID</dt><dd>{shipment.id}</dd>
        <dt>Package</dt><dd>{shipment.label} ({formatKg(shipment.weightGrams)})</dd>
        <dt>Recipient</dt><dd>{recipient}</dd>
        {collectionMin !== undefined && (<><dt>Collection</dt><dd>{formatMin(collectionMin)}</dd></>)}
        <dt>Estimated arrival</dt><dd>{formatMin(plan.deliveryMin)}</dd>
        <dt>Requested deadline</dt><dd>{formatMin(shipment.deadlineMin)}</dd>
        <dt>Price</dt><dd>{formatCents(plan.customerPriceCents)}</dd>
        <dt>{carriers.length > 1 ? 'Carriers' : 'Carrier'}</dt><dd>{carriers.map((c, i) => (
          <span key={c.key}>{i > 0 && ' → '}<Link to={c.href}>{c.name}</Link></span>
        ))}</dd>
        {hub && (<><dt>Hub</dt><dd>{hub}</dd></>)}
      </dl>
      <ol className="match-card__timeline">
        {collectionMin !== undefined && <li>{formatMin(collectionMin)}: collected</li>}
        {hub && <li>Held at {hub} overnight</li>}
        <li>{formatMin(plan.deliveryMin)}: delivered to {recipient}</li>
      </ol>
      <div className="match-card__actions">
        <Button onClick={onViewTracking}>View tracking</Button>
        <Link to={simulatorHref(shipment.id)}>Watch in simulator</Link>
      </div>
    </Card>
  );
}
