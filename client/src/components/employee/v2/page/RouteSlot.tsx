// The Employee page's route-preview slot (#463): the commute route preview (#419) once the map is
// in, a one-line note while it loads, and a short message with Retry if it failed. Props only.
import type { EmployeeDashboard, EmployeeJobView } from '../../../../../../shared/v2/api';
import type { NetworkBusiness } from '../../../../../../shared/v2/types';
import { CommuteRoutePreview } from '../route/CommuteRoutePreview';
import type { RunMapSlot } from './runMapModel';

export type RouteSlotProps = {
  slot: RunMapSlot;
  dashboard: EmployeeDashboard;
  businesses: NetworkBusiness[];
  /** The open `?job=` job when it is this employee's; its stops are numbered on the map. */
  job: EmployeeJobView | null;
  onRetry: () => void;
};

export function RouteSlot({ slot, dashboard, businesses, job, onRetry }: RouteSlotProps) {
  if (slot.kind === 'none') return null;
  if (slot.kind === 'loading') {
    return <p className="ep-route-note" role="status">{slot.text}</p>;
  }
  const preview = slot.map ? (
    <CommuteRoutePreview
      employee={dashboard.employee}
      home={dashboard.home}
      trips={dashboard.trips}
      businesses={businesses}
      map={slot.map}
      job={job}
    />
  ) : null;
  if (slot.kind === 'map') return <div className="ep-route">{preview}</div>;
  return (
    <div className="ep-route">
      <p className="ep-route-note ep-problem" role="alert">
        {slot.text}{' '}
        <button type="button" className="ep-btn ep-btn-link" onClick={onRetry}>Retry</button>
      </p>
      {preview}
    </div>
  );
}
