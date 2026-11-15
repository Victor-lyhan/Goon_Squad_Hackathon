import type { ReactNode } from 'react';
import type { EmployeeDashboard } from '../../../../../shared/v2/api';
import type { NetworkBusiness } from '../../../../../shared/v2/types';
import { CommuteSummary } from './CommuteSummary';
import { DeliveryList } from './DeliveryList';
import {
  COMPLETED_EMPTY, LOCKED_TEXT, assignedEmpty, commuteSummary, deliveryRows, earnings, newJobAnnouncements,
} from './employeeWorkspaceModel';
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

/**
 * The Employee workspace. Renders props through the pure model. Order (issue 957): the band with the name,
 * the earnings and the next job; the other assigned jobs; the commute; the completed jobs.
 */
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
      {/* The ink band (issue 957): who this is and what they earn, then the assigned list, whose first
          row is the next job's boarding pass. The band ends under the pass; the rest is on paper. */}
      <div className="ew-top">
        <header className="ew-header">
          <h1 className="ew-name">{dashboard.employee.name}</h1>
          <p className="ew-muted">
            {summary.workplaceName}
            {summary.workplaceNeighborhood && `, ${summary.workplaceNeighborhood}`}
          </p>
        </header>
        {/* The heading names the region for a screen reader; the two labels say it on screen. */}
        <section className="ew-money" aria-labelledby="ew-earnings-heading">
          <h2 id="ew-earnings-heading" className="ew-sr">Earnings</h2>
          <dl className="ew-earnings">
            <div>
              <dt>Earned</dt>
              <dd>{money.earned}</dd>
            </div>
            <div>
              <dt>Projected</dt>
              <dd>{money.projected}</dd>
            </div>
          </dl>
        </section>
      </div>

      <DeliveryList
        id="ew-assigned"
        title="Assigned deliveries"
        rows={assigned}
        newJobIds={newJobIds}
        empty={assignedEmpty(summary)}
        lead
      />

      {/* Right above the commute it is about: the line says why Edit commute is switched off. */}
      {locked && <p className="ew-locked" role="status">{LOCKED_TEXT}</p>}

      {editor ?? <CommuteSummary model={summary} onEdit={onEditCommute} editDisabled={locked} />}

      <DeliveryList
        id="ew-completed"
        title="Completed deliveries"
        rows={completed}
        empty={COMPLETED_EMPTY}
      />

      {announce && <NewJobAnnouncer dashboard={dashboard} newJobIds={newJobIds} />}
    </div>
  );
}
