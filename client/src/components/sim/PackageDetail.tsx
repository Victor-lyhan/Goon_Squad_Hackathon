import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Business, Employee, Hub } from '../../../../shared/types';
import type { SimulatorResponse } from '../../../../shared/api';
import { toPackageDetail } from './packageDetailModel';
import './PackageDetail.css';

export type PackageDetailProps = {
  sim: SimulatorResponse | null;
  businesses: Business[];
  hubs: Hub[];
  employees: Employee[];
  selectedId?: string;
};

export function PackageDetail({ sim, businesses, hubs, employees, selectedId }: PackageDetailProps) {
  const d = useMemo(
    () => (sim && selectedId ? toPackageDetail({ sim, businesses, hubs, employees, shipmentId: selectedId }) : null),
    [sim, businesses, hubs, employees, selectedId],
  );
  if (!d) {
    return <section className="pd pd-empty" aria-label="Package detail">Select a package to see its details.</section>;
  }
  return (
    <section className="pd" aria-label="Package detail">
      <header className="pd-head">
        <h3 className="pd-title">{d.label}</h3>
        <span className={`pq-pill pq-pill-${d.status}`}>{d.statusLabel}</span>
      </header>
      <p className="pd-route">{d.route}</p>
      {d.planKind && <p className="pd-kind">{d.planKind}</p>}
      {d.unmatchedReason && (
        <p className="pd-unmatched"><strong>Unmatched</strong>: {d.unmatchedReason}</p>
      )}
      {d.timeline.length > 0 && (
        <>
          <h4 className="pd-h">Timeline</h4>
          <ol className="pd-legs">
            {d.timeline.map((t) => (
              <li key={t.key} className={`pd-leg pd-ev pd-ev-${t.state}`} aria-current={t.state === 'current' ? 'step' : undefined}>
                <span className="pd-ev-state">{t.stateLabel}</span> <span>{t.text}</span>, <span>{t.time}</span>
              </li>
            ))}
          </ol>
          {d.timeLabel && <p className="pd-row"><strong>{d.timeLabel}:</strong> {d.timeValue}</p>}
        </>
      )}
      <h4 className="pd-h">Businesses</h4>
      <p className="pd-row"><strong>Sender:</strong> {d.senderName}</p>
      <p className="pd-row"><strong>Recipient:</strong> {d.recipientName}</p>
      {d.hubName && <p className="pd-row"><strong>Relay hub:</strong> {d.hubName}</p>}
      <p className="pd-links">
        <Link to={d.senderHref}>Sender tracking</Link> · <Link to={d.recipientHref}>Recipient tracking</Link>
      </p>
      {d.legs.length > 0 && (
        <>
          <h4 className="pd-h">Carriers</h4>
          <ul className="pd-legs">
            {d.legs.map((l, i) => (
              <li key={l.jobId} className="pd-leg">
                <div className="pd-leg-top">
                  <Link to={l.href}>Leg {i + 1}: {l.employeeName}</Link>
                  <span>{l.legLabel} · {l.extraLabel} · {l.rewardLabel}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.priceLabel && (
        <>
          <h4 className="pd-h">Price</h4>
          <p className="pd-row"><strong>Customer price:</strong> {d.priceLabel}</p>
        </>
      )}
    </section>
  );
}
