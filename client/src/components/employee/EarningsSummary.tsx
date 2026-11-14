import { formatCents } from '../../ui';
import type { EmployeeDashboard } from '../../../../shared/api';

type Props = Pick<EmployeeDashboard, 'earnedCents' | 'assigned' | 'completed'>;

// earnedCents and the job lists come straight from the dashboard response. The API has no
// single "scheduled" total, only per-job rewards, so this adds up the API's own rewardCents
// for the assigned/in-progress jobs (no pricing logic, just a sum of API values).
export function EarningsSummary({ earnedCents, assigned, completed }: Props) {
  const scheduledCents = assigned.reduce((sum, v) => sum + (v.job.rewardCents || 0), 0);
  const count = completed.length;
  return (
    <section className="earnings" aria-labelledby="earnings-heading">
      <h2 id="earnings-heading" className="earnings__heading">Earnings</h2>
      <dl className="earnings__list">
        <div className="earnings__item">
          <dt className="earnings__label">Earned so far</dt>
          <dd className="earnings__value">{formatCents(earnedCents || 0)}</dd>
        </div>
        <div className="earnings__item">
          <dt className="earnings__label">Scheduled</dt>
          <dd className="earnings__value">{formatCents(scheduledCents)}</dd>
        </div>
        <div className="earnings__item">
          <dt className="earnings__label">Completed jobs</dt>
          <dd className="earnings__value">{count}</dd>
          {count === 0 && <dd className="earnings__note">No completed jobs yet</dd>}
        </div>
      </dl>
    </section>
  );
}
