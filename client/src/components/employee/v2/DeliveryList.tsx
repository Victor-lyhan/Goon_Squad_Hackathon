import { EMPTY_TEXT, type DeliveryRow } from './employeeWorkspaceModel';

export type DeliveryListProps = {
  id: string;
  title: string;
  rows: DeliveryRow[];
  newJobIds?: ReadonlySet<string> | string[];
  /** Shown when rows is empty; defaults to the assigned-deliveries empty text. */
  emptyText?: string;
};

const has = (ids: DeliveryListProps['newJobIds'], id: string) =>
  !!ids && (Array.isArray(ids) ? ids.includes(id) : ids.has(id));

/** A list of delivery rows (not cards). Renders the model; derives nothing. */
export function DeliveryList({ id, title, rows, newJobIds, emptyText = EMPTY_TEXT }: DeliveryListProps) {
  const headingId = `${id}-heading`;
  return (
    <section className="ew-section" aria-labelledby={headingId}>
      <div className="ew-section-head">
        <h2 id={headingId}>{title}</h2>
        <span className="ew-count ew-mono">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="ew-empty">{emptyText}</p>
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
                <a href={r.jobHref}>View job</a>
                <a href={r.simulatorHref}>Watch in simulator</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
