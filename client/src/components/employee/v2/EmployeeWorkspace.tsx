import type { ReactNode } from 'react';
import type { EmployeeDashboard } from '../../../../../shared/v2/api';
import type { NetworkBusiness } from '../../../../../shared/v2/types';
import { CommuteSummary } from './CommuteSummary';
import { DeliveryList } from './DeliveryList';
import { LOCKED_TEXT, commuteSummary, deliveryRows, earnings } from './employeeWorkspaceModel';
import './EmployeeWorkspace.css';

export type EmployeeWorkspaceProps = {
  dashboard: EmployeeDashboard;
  businesses: NetworkBusiness[];
  /** Job IDs to flag as "New" (in-memory only, DECISIONS pass 9). */
  newJobIds?: ReadonlySet<string> | string[];
  /** When provided, replaces the commute summary (e.g. the commute form). */
  editor?: ReactNode;
  onEditCommute?: () => void;
};

/** MVP II Employee workspace (docs/mvp2-ui-redesign.md §2). Renders props through the pure model. */
export function EmployeeWorkspace({ dashboard, businesses, newJobIds, editor, onEditCommute }: EmployeeWorkspaceProps) {
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
    </div>
  );
}
