import { EMPTY_TITLE, EMPTY_WHY, type DeliveryRow, type EmptyState } from './employeeWorkspaceModel';
import { splitMoment } from './jobDetailV2Model';
import { PageLink } from './page/PageLink';

export type DeliveryListProps = {
  id: string;
  title: string;
  rows: DeliveryRow[];
  newJobIds?: ReadonlySet<string> | string[];
  /** Shown when rows is empty: what is missing and why. Defaults to the assigned-deliveries text. */
  empty?: EmptyState;
  /**
   * true for the assigned list (issue 957): its first row is the next job and is drawn as a boarding
   * pass, the page's one bold element. The order of the rows is the server's; nothing is sorted here.
   */
  lead?: boolean;
};

const ASSIGNED_EMPTY: EmptyState = { title: EMPTY_TITLE, why: EMPTY_WHY };

const has = (ids: DeliveryListProps['newJobIds'], id: string) =>
  !!ids && (Array.isArray(ids) ? ids.includes(id) : ids.has(id));

/** The row's title line: the package, the "New" tag and the status, in the words of the API. */
function RowHead({ row, isNew }: { row: DeliveryRow; isNew: boolean }) {
  return (
    <div className="ew-row-head">
      <span className="ew-strong">{row.packageLabel}</span>
      {isNew && <span className="ew-new">New</span>}
      <span className={`ew-status is-${row.status}`}>{row.statusLabel}</span>
    </div>
  );
}

/** Which commute the job rides on, then what kind of delivery it is: two short sentences. */
function RowMeta({ row }: { row: DeliveryRow }) {
  return <div className="ew-row-meta ew-muted">{row.commute}. {row.legKind}</div>;
}

/** Router links (#584): the job opens on this page, the simulator without a new document. */
function RowLinks({ row }: { row: DeliveryRow }) {
  return (
    <div className="ew-row-links">
      <PageLink to={row.jobHref} data-row-focus="" aria-label={row.jobLinkLabel}>View job</PageLink>
      <PageLink to={row.simulatorHref} aria-label={row.simulatorLinkLabel}>Watch in simulator</PageLink>
    </div>
  );
}

// A stop's text is "Day 1, 5:15 PM · Etsy" in every row, as `DeliveryRow.pickup` has it: on screen the time
// and the place stand on two lines, so the " · " between them is for a screen reader (and for the tests of
// other modules that read a row's text).

/** "Day 1, 5:15 PM" as one text, the day small and the clock large (a delivery time never loses its day). */
function PassTime({ moment }: { moment: string }) {
  const { day, clock } = splitMoment(moment);
  return <span className="ew-pass-time">{day && <span className="ew-pass-day">{day}</span>}{clock}</span>;
}

/**
 * The next job as a boarding pass (issue 957): pickup and drop-off are the two stations of one route
 * line, each with its clock set large; the stub carries the reward and the page's one orange action.
 * The line is in the job's carrier colour and the orange square on it is the package: at the pickup
 * station while the job is assigned, on the line once it is in progress. Both are pictures of values
 * the row already says in words (`statusLabel`), so they are hidden from screen readers.
 */
function PassRow({ row, isNew }: { row: DeliveryRow; isNew: boolean }) {
  return (
    <li className="ew-row ew-pass" data-job-id={row.jobId} data-carrier={row.carrier} data-status={row.status}>
      <div className="ew-pass-ticket">
        <div className="ew-pass-main">
          <RowHead row={row} isNew={isNew} />
          <RowMeta row={row} />
          <dl className="ew-pass-route">
            <div className="ew-pass-stop">
              <dt>Pickup</dt>
              <dd>
                <PassTime moment={row.pickupTime} />
                <span className="ew-sr"> · </span>
                <span className="ew-pass-place">
                  {row.pickupPlace}
                  <span className="ew-pass-parcel" aria-hidden="true" />
                </span>
              </dd>
            </div>
            <div className="ew-pass-stop">
              <dt>Drop-off</dt>
              <dd>
                <PassTime moment={row.dropoffTime} />
                <span className="ew-sr"> · </span>
                <span className="ew-pass-place">{row.dropoffPlace}</span>
              </dd>
            </div>
          </dl>
        </div>
        <div className="ew-pass-stub">
          <dl className="ew-pass-terms">
            <div>
              <dt>Reward</dt>
              <dd className="ew-pass-reward">{row.reward}</dd>
            </div>
            <div>
              <dt>Extra time</dt>
              <dd className="ew-mono">{row.extraMin}</dd>
            </div>
          </dl>
          <RowLinks row={row} />
        </div>
      </div>
    </li>
  );
}

/** Every other row: quiet, the same facts in a small grid. */
function QuietRow({ row, isNew }: { row: DeliveryRow; isNew: boolean }) {
  return (
    <li className="ew-row" data-job-id={row.jobId}>
      <RowHead row={row} isNew={isNew} />
      <RowMeta row={row} />
      <dl className="ew-stops">
        <div>
          <dt>Pickup</dt>
          <dd><span className="ew-mono">{row.pickupTime}</span><span className="ew-sr"> · </span><span className="ew-place">{row.pickupPlace}</span></dd>
        </div>
        <div>
          <dt>Drop-off</dt>
          <dd><span className="ew-mono">{row.dropoffTime}</span><span className="ew-sr"> · </span><span className="ew-place">{row.dropoffPlace}</span></dd>
        </div>
        <div>
          <dt>Extra time</dt>
          <dd className="ew-mono">{row.extraMin}</dd>
        </div>
        <div>
          <dt>Reward</dt>
          <dd className="ew-mono">{row.reward}</dd>
        </div>
      </dl>
      <RowLinks row={row} />
    </li>
  );
}

/** A list of delivery rows (not cards). Renders the model; derives nothing. */
export function DeliveryList({ id, title, rows, newJobIds, empty = ASSIGNED_EMPTY, lead = false }: DeliveryListProps) {
  const headingId = `${id}-heading`;
  return (
    <section className={`ew-section${lead ? ' ew-next' : ''}`} aria-labelledby={headingId}>
      <div className="ew-section-head">
        <h2 id={headingId}>{title}</h2>
        <span className="ew-count">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="ew-empty">
          <span className="ew-empty-title">{empty.title}</span> {empty.why}
        </p>
      ) : (
        <ul className="ew-rows">
          {rows.map((r, i) => (lead && i === 0
            ? <PassRow key={r.jobId} row={r} isNew={has(newJobIds, r.jobId)} />
            : <QuietRow key={r.jobId} row={r} isNew={has(newJobIds, r.jobId)} />
          ))}
        </ul>
      )}
    </section>
  );
}
