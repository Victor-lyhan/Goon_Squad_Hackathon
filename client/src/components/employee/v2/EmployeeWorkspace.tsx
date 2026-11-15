import type { ReactNode } from 'react';
import type { EmployeeDashboard } from '../../../../../shared/v2/api';
import type { NetworkBusiness } from '../../../../../shared/v2/types';
import { CommuteSummary } from './CommuteSummary';
import { DeliveryList } from './DeliveryList';
import { LOCKED_TEXT, commuteSummary, deliveryRows, earnings, newJobAnnouncements } from './employeeWorkspaceModel';
import './EmployeeWorkspace.css';

export type EmployeeWorkspaceProps = {
  dashboard: EmployeeDashboard;
  businesses: NetworkBusiness[];
  /** Job IDs to flag as "New" (in-memory only, DECISIONS pass 9). */
  newJobIds?: ReadonlySet<string> | string[];
  /** When provided, replaces the commute summary (e.g. the commute form). */
  editor?: ReactNode;
  onEditCommute?: () => void;
  /**
   * false when the page around the workspace renders <NewJobAnnouncer> itself (#735), so the region
   * stays in place while a job view replaces the workspace. Default true: the workspace has the region.
   */
  announce?: boolean;
};

/**
 * The one hidden live region for new jobs (#633). Always rendered, so it is in place before a message
 * arrives. Each message is its own element and the region is not atomic: a second new job is read
 * alone, and a message that leaves (tag cleared, run changed) is not read again.
 */
export function NewJobAnnouncer({ dashboard, newJobIds }: Pick<EmployeeWorkspaceProps, 'dashboard' | 'newJobIds'>) {
  const announcements = newJobAnnouncements(dashboard, newJobIds);
  return (
    <div className="ew-sr ew-announce" role="status" aria-live="polite" aria-atomic="false">
      {announcements.map((a) => <p key={a.id}>{a.message}</p>)}
    </div>
  );
}

/** MVP II Employee workspace (docs/mvp2-ui-redesign.md §2). Renders props through the pure model. */
export function EmployeeWorkspace({
  dashboard, businesses, newJobIds, editor, onEditCommute, announce = true,
}: EmployeeWorkspaceProps) {
  const summary = commuteSummary(dashboard, businesses);
  const assigned = deliveryRows(dashboard.assigned, businesses, summary.homeNeighborhood);
  const completed = deliveryRows(dashboard.completed, businesses, summary.homeNeighborhood);
  const money = earnings(dashboard);
  const locked = dashboard.phase === 'locked';

  return (
    <div className="ew">
      <header className="ew-header">
        <h1>{dashboard.employee.name}</h1>
        <p className="ew-muted">
          {summary.workplaceName}
          {summary.workplaceNeighborhood && ` · ${summary.workplaceNeighborhood}`}
        </p>
      </header>

      {locked && <p className="ew-locked" role="status">{LOCKED_TEXT}</p>}

      {editor ?? <CommuteSummary model={summary} onEdit={onEditCommute} editDisabled={locked} />}

      <DeliveryList id="ew-assigned" title="Assigned deliveries" rows={assigned} newJobIds={newJobIds} />

      <section className="ew-section" aria-labelledby="ew-earnings-heading">
        <div className="ew-section-head">
          <h2 id="ew-earnings-heading">Earnings</h2>
        </div>
        <dl className="ew-earnings">
          <div>
            <dt>Earned</dt>
            <dd className="ew-mono">{money.earned}</dd>
          </div>
          <div>
            <dt>Projected</dt>
            <dd className="ew-mono">{money.projected}</dd>
          </div>
        </dl>
      </section>

      <DeliveryList
        id="ew-completed"
        title="Completed deliveries"
        rows={completed}
        emptyText="No completed deliveries yet."
      />

      {announce && <NewJobAnnouncer dashboard={dashboard} newJobIds={newJobIds} />}
    </div>
  );
}
