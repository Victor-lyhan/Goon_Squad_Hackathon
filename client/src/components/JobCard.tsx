import type { EmployeeJobView } from '../../../shared/api';
import type { Business, Hub } from '../../../shared/types';
import { Button, Card, StatusPill } from '../ui';
import { toJobCardModel } from './employee/jobCardModel';
import './employee/employee.css';

export type JobCardProps = {
  view: EmployeeJobView;
  businesses: Business[];
  hubs: Hub[];
  onView?: (jobId: string) => void;
};

function Row({ label, children }: { label: string; children: string }) {
  return (
    <p className="job-card__row">
      <span className="job-card__label">{label}</span>
      {children}
    </p>
  );
}

export function JobCard({ view, businesses, hubs, onView }: JobCardProps) {
  const m = toJobCardModel(view, businesses, hubs);
  return (
    <Card className="job-card">
      <div className="job-card__head">
        <h3 className="job-card__title">{m.title}</h3>
        <StatusPill status={m.status} />
      </div>
      <span className="job-card__tag">{m.tag}</span>
      <Row label="Package">{`${m.packageName} · ${m.category} · ${m.weight}`}</Row>
      <Row label="From → To">{`${m.senderName} → ${m.recipientName}`}</Row>
      {m.finalDestination && <p className="job-card__context">Final destination: {m.finalDestination}</p>}
      <Row label="Pickup">{`${m.pickupPlace}, ${m.pickupTime}`}</Row>
      <Row label="Drop-off">{`${m.dropoffPlace}, ${m.dropoffTime}`}</Row>
      <div className="job-card__foot">
        <span>{m.addedTime} added</span>
        <span className="job-card__reward">{m.reward}</span>
        <Button onClick={() => onView?.(m.jobId)}>View job</Button>
      </div>
    </Card>
  );
}
