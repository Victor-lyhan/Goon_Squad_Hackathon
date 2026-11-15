import { useEffect, useRef } from 'react';
import type { ShipmentView } from '../../../../../shared/v2/api';
import type { Employee, NetworkBusiness, Phase } from '../../../../../shared/v2/types';
import type { PartyText } from './deliveryDetailsModel';
import { deliveryDetails, requestActions } from './deliveryDetailsModel';
import './deliveryDetails.css';

export type DeliveryDetailsProps = {
  view: ShipmentView;
  businesses: Pick<NetworkBusiness, 'id' | 'name' | 'neighborhood'>[];
  employees: Pick<Employee, 'id' | 'name'>[];
  viewerBusinessId: string;
  phase: Phase;
  busy?: boolean;
  onRetryMatch?: () => void;
  onEdit?: () => void;
  onClose: () => void;
};

function Party({ role, party }: { role: string; party: PartyText }) {
  return (
    <div className="bd-party">
      <dt>{role}</dt>
      <dd>
        {party.name}
        {party.neighborhood && <span className="bd-muted">, {party.neighborhood}</span>}
      </dd>
    </div>
  );
}

/** Delivery details and match result for one shipment. Side panel on desktop, full width at 390 px. */
export function DeliveryDetails(props: DeliveryDetailsProps) {
  const { view, businesses, employees, viewerBusinessId, phase, busy = false } = props;
  const m = deliveryDetails(view, { businesses, employees, viewerBusinessId });
  const actions = requestActions(m, phase);
  const headingId = `bd-title-${m.header.shipmentId}`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headRef = useRef<HTMLElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    // The browser scrolls only the focused title into view. Opened from further down the page ("View delivery"
    // in the New delivery form), that left the row above it, with the Close button, just off screen (#719).
    // `nearest` moves nothing when the header is in view. Not in every DOM (jsdom has none).
    const head = headRef.current;
    if (typeof head?.scrollIntoView === 'function') head.scrollIntoView({ block: 'nearest' });
  }, [m.header.shipmentId]);

  const { header, result, steps, legs, facts } = m;
  // The panel's one way on: the package's journey in the simulator (links.ts builds the address). With a
  // plan it sits in the result, at the top of the panel; without one, at the end.
  const journeyLink = <a className="bd-btn bd-btn--link" href={m.journeyHref}>{m.journeyLabel}</a>;

  return (
    <section
      className="bd-panel"
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        // Esc closes the details, unless a control inside already used the key.
        if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); props.onClose(); }
      }}
    >
      <header className="bd-head" ref={headRef}>
        {/* The heading comes first and takes focus when the panel opens, so it is announced and the next Tab is Close. */}
        <div className="bd-head__top">
          <h2 id={headingId} className="bd-title" tabIndex={-1} ref={headingRef}>{header.label}</h2>
          <button type="button" className="bd-btn bd-btn--ghost" onClick={props.onClose} aria-label="Close delivery details">Close</button>
        </div>
        <p className="bd-kind"><span className="bd-eyebrow">{header.directionLabel}</span></p>
        <dl className="bd-parties">
          <Party role="From" party={header.sender} />
          <Party role="To" party={header.recipient} />
        </dl>
      </header>

      {result.kind === 'matched' ? (
        <div className="bd-result bd-result--ok" role="status">
          <p className="bd-result__title">{result.title}</p>
          <dl className="bd-facts">
            <div><dt>Plan</dt><dd>{result.planText}</dd></div>
            <div><dt>{result.timeLabel}</dt><dd className="bd-mono">{result.timeText}</dd></div>
            {result.priceText && <div><dt>Price</dt><dd className="bd-mono">{result.priceText}</dd></div>}
          </dl>
          <div className="bd-actions">{journeyLink}</div>
        </div>
      ) : (
        <div className="bd-result bd-result--none" role="status">
          <p className="bd-result__title">{result.title}</p>
          {result.reason && <p className="bd-result__reason">{result.reason}</p>}
          {actions.show && (
            <div className="bd-actions">
              {props.onRetryMatch && (
                <button type="button" className="bd-btn bd-btn--primary" onClick={props.onRetryMatch} disabled={busy}>
                  {busy ? 'Matching…' : 'Try matching again'}
                </button>
              )}
              {props.onEdit && (
                <button type="button" className="bd-btn" onClick={props.onEdit} disabled={busy}>Edit request</button>
              )}
            </div>
          )}
          {actions.lockedNote && <p className="bd-muted bd-note">{actions.lockedNote}</p>}
        </div>
      )}

      {steps.length > 0 && (
        <div className="bd-section">
          <h3 className="bd-section__title">Progress</h3>
          <ol className="bd-steps">
            {steps.map((s) => (
              <li key={s.key} className={`bd-step bd-step--${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
                <span className="bd-step__mark" aria-hidden="true" />
                <span className="bd-step__label">{s.label}</span>
                <span className="bd-visually-hidden">
                  {s.state === 'done' ? ' (done)' : s.state === 'current' ? ' (current)' : ' (upcoming)'}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {legs.length > 0 && (
        <div className="bd-section">
          <h3 className="bd-section__title">Carriers</h3>
          <table className="bd-legs">
            <caption className="bd-visually-hidden">Carriers and stops</caption>
            <thead>
              <tr><th scope="col">Carrier</th><th scope="col">Stops</th><th scope="col" className="bd-num">Extra</th></tr>
            </thead>
            <tbody>
              {legs.map((leg) => (
                <tr key={leg.key}>
                  <td data-label="Carrier">
                    <a className="bd-link" href={leg.carrierHref}>{leg.carrierName}</a>
                    <div className="bd-muted bd-small">{leg.tripText}</div>
                  </td>
                  <td data-label="Stops">
                    <ul className="bd-stops">
                      {leg.stops.map((st) => (
                        <li key={st.key} className={st.isRelay ? 'bd-stop bd-stop--relay' : 'bd-stop'}>
                          <span className="bd-mono">{st.timeText}</span>
                          <span className="bd-stop__what"><span className="bd-muted">{st.actionLabel}</span> {st.placeText}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td data-label="Extra" className="bd-mono bd-num">{leg.extraText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bd-section">
        <h3 className="bd-section__title">Package</h3>
        <dl className="bd-facts">
          <div><dt>Category</dt><dd>{facts.category}</dd></div>
          <div><dt>Weight</dt><dd className="bd-mono">{facts.weight}</dd></div>
          <div><dt>Ready</dt><dd className="bd-mono">{facts.ready}</dd></div>
          <div><dt>Deadline</dt><dd className="bd-mono">{facts.deadline}</dd></div>
          {facts.description && <div><dt>Contents</dt><dd>{facts.description}</dd></div>}
          {facts.pickupInstructions && <div><dt>Pickup instructions</dt><dd>{facts.pickupInstructions}</dd></div>}
          {facts.dropoffInstructions && <div><dt>Drop-off instructions</dt><dd>{facts.dropoffInstructions}</dd></div>}
        </dl>
      </div>

      {result.kind !== 'matched' && <div className="bd-footer">{journeyLink}</div>}
    </section>
  );
}
