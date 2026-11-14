// MVP II delivery job detail for the Employee workspace (issue #387).
// Renders the API's JobResponse through the pure jobDetailV2Model; computes nothing itself.
import { useEffect, useRef } from 'react';
import type { JobResponse } from '../../../../../shared/v2/api';
import type { NetworkBusiness } from '../../../../../shared/v2/types';
import { JOB_MISSING_TEXT, JOB_MISSING_TITLE, JOB_OTHER_TEXT, JOB_OTHER_TITLE, jobDetail } from './jobDetailV2Model';
import { PageLink } from './page/PageLink';
import './JobDetailV2.css';

export type JobDetailV2Props = {
  job: JobResponse;
  businesses: NetworkBusiness[];
  homeNeighborhood: string;
  onBack(): void;
};

/** Moves focus to the heading when the view opens, so keyboard and screen reader users land on it. */
function useFocusOnOpen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

export function JobDetailV2({ job, businesses, homeNeighborhood, onBack }: JobDetailV2Props) {
  const m = jobDetail(job, businesses, homeNeighborhood);
  const heading = useFocusOnOpen<HTMLHeadingElement>();
  return (
    <article className="job-v2" aria-labelledby="job-v2-title">
      <header className="job-v2__head">
        <p className="job-v2__kind">{m.legKind}</p>
        <h2 id="job-v2-title" className="job-v2__title" tabIndex={-1} ref={heading}>{m.title}</h2>
        <p className="job-v2__trip">{m.trip}</p>
        <p className="job-v2__status" role="status" data-status={m.status}>
          <span className="job-v2__status-label">{m.statusLabel}</span>
          <span className="job-v2__status-note">{m.statusNote}</span>
        </p>
      </header>

      <section className="job-v2__section" aria-labelledby="job-v2-route">
        <h3 id="job-v2-route" className="job-v2__h3">Your route</h3>
        <ol className="job-v2__route">
          {m.route.map((r) => (
            <li key={r.key} className="job-v2__stop" data-kind={r.kind} data-done={r.done ? 'true' : 'false'}>
              <span className="job-v2__time">{r.time}</span>
              <div className="job-v2__stop-body">
                <span className="job-v2__action">{r.action}{r.done ? ' (done)' : ''}</span>
                <span className="job-v2__place">{r.place}</span>
                {r.address && <span className="job-v2__address">{r.address}</span>}
                {r.instructions && <span className="job-v2__instructions">Instructions: {r.instructions}</span>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {m.relay && <p className="job-v2__relay">{m.relay}</p>}

      <section className="job-v2__section" aria-labelledby="job-v2-numbers">
        <h3 id="job-v2-numbers" className="job-v2__h3">What it adds</h3>
        <dl className="job-v2__numbers">
          {m.numbers.map((n) => (
            <div key={n.key} className="job-v2__number" data-number={n.key}>
              <dt>{n.label}</dt>
              <dd>{n.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <nav className="job-v2__actions" aria-label="Job links">
        <PageLink className="job-v2__link" to={m.watchHref}>Watch this package</PageLink>
        <button type="button" className="job-v2__button" onClick={onBack}>Back to deliveries</button>
      </nav>
    </article>
  );
}

/** The ?job= link points at a job the server no longer has: re-matched away, or from an earlier run (#634). */
export function JobV2Missing({ onBack }: { onBack(): void }) {
  const heading = useFocusOnOpen<HTMLHeadingElement>();
  return (
    <article className="job-v2" role="status">
      <h2 className="job-v2__title" tabIndex={-1} ref={heading}>{JOB_MISSING_TITLE}</h2>
      <p className="job-v2__text">{JOB_MISSING_TEXT}</p>
      <div className="job-v2__actions">
        <button type="button" className="job-v2__button" onClick={onBack}>Back to deliveries</button>
      </div>
    </article>
  );
}

/** The ?job= link points at another carrier's job (often after a re-match). `href` is that job on its owner's page. */
export function JobV2Other({ href, onBack }: { href: string; onBack(): void }) {
  const heading = useFocusOnOpen<HTMLHeadingElement>();
  return (
    <article className="job-v2" role="status">
      <h2 className="job-v2__title" tabIndex={-1} ref={heading}>{JOB_OTHER_TITLE}</h2>
      <p className="job-v2__text">{JOB_OTHER_TEXT}</p>
      <div className="job-v2__actions">
        <PageLink className="job-v2__link" to={href}>Open it on the right employee page</PageLink>
        <button type="button" className="job-v2__button" onClick={onBack}>Back to deliveries</button>
      </div>
    </article>
  );
}
