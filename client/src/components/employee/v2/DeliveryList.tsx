import { EMPTY_TITLE, EMPTY_WHY, type DeliveryRow, type EmptyState } from './employeeWorkspaceModel';
import { PageLink } from './page/PageLink';

export type DeliveryListProps = {
  id: string;
  title: string;
  rows: DeliveryRow[];
  newJobIds?: ReadonlySet<string> | string[];
  /** Shown when rows is empty: what is missing and why. Defaults to the assigned-deliveries text. */
  empty?: EmptyState;
};

const ASSIGNED_EMPTY: EmptyState = { title: EMPTY_TITLE, why: EMPTY_WHY };

const has = (ids: DeliveryListProps['newJobIds'], id: string) =>
  !!ids && (Array.isArray(ids) ? ids.includes(id) : ids.has(id));

/** A list of delivery rows (not cards). Renders the model; derives nothing. */
export function DeliveryList({ id, title, rows, newJobIds, empty = ASSIGNED_EMPTY }: DeliveryListProps) {
  const headingId = `${id}-heading`;
  return (
    <section className="ew-section" aria-labelledby={headingId}>
      <div className="ew-section-head">
        <h2 id={headingId}>{title}</h2>
        <span className="ew-count ew-mono">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="ew-empty">
          <span className="ew-empty-title">{empty.title}</span> {empty.why}
        </p>
      ) : (
        <ul className="ew-rows">
          {rows.map((r) => (
            <li key={r.jobId} className="ew-row" data-job-id={r.jobId}>
              <div className="ew-row-head">
                <span className="ew-strong">{r.packageLabel}</span>
                {has(newJobIds, r.jobId) && <span className="ew-new">New</span>}
                <span className={`ew-status is-${r.status}`}>{r.statusLabel}</span>
              </div>
              <div className="ew-row-meta ew-muted">
                {r.legKind} · {r.commute}
              </div>
              <dl className="ew-stops">
                <div>
                  <dt>Pickup</dt>
                  <dd><span className="ew-mono">{r.pickupTime}</span> · {r.pickupPlace}</dd>
                </div>
                <div>
                  <dt>Drop-off</dt>
                  <dd><span className="ew-mono">{r.dropoffTime}</span> · {r.dropoffPlace}</dd>
                </div>
                <div>
                  <dt>Extra time</dt>
                  <dd className="ew-mono">{r.extraMin}</dd>
                </div>
                <div>
                  <dt>Reward</dt>
                  <dd className="ew-mono">{r.reward}</dd>
                </div>
              </dl>
              <div className="ew-row-links">
                {/* Router links (#584): the job opens on this page, the simulator without a new document. */}
                <PageLink to={r.jobHref} data-row-focus="" aria-label={r.jobLinkLabel}>View job</PageLink>
                <PageLink to={r.simulatorHref} aria-label={r.simulatorLinkLabel}>Watch in simulator</PageLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
