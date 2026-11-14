import type { JobResponse, MapResponse } from '../../../../shared/api';
import type { Business, Hub, ShipmentProgress } from '../../../../shared/types';
import { CityMap } from '../CityMap';
import { Button, Card, EmptyState, StatusPill } from '../../ui';
import {
  EMPLOYEE_MISSING_TITLE, JOB_MISSING_TITLE, JOB_OTHER_TITLE, toJobDetailModel,
  type JobLinkState,
} from './jobDetailModel';
import './JobDetail.css';

export type JobDetailProps = { job: JobResponse; map: MapResponse; businesses: Business[]; hubs: Hub[]; progress?: ShipmentProgress };

export function JobDetail({ job, map, businesses, hubs, progress }: JobDetailProps) {
  const m = toJobDetailModel(job, { businesses, hubs, nodes: map.graph.nodes }, progress);
  const leg = job.plan.legs[job.job.legIndex];
  return (
    <div className="job-detail">
      <div className="job-detail__head">
        <h2 className="job-detail__title">Job detail</h2>
        <StatusPill status={job.status} />
      </div>
      <p className="job-detail__progress" role="status">{m.progress}</p>
      <nav className="job-detail__links" aria-label="Package links">
        <a className="job-detail__link" href={m.trackHref}>Track package</a>
        <a className="job-detail__link" href={m.watchHref}>Watch in simulator</a>
      </nav>
      <CityMap
        graph={map.graph}
        businesses={businesses}
        hubs={hubs}
        baselineRoute={job.trip.baselineNodeIds}
        highlightRoute={leg?.routeNodeIds}
      />
      {m.relay && <p className="job-detail__relay">{m.relay}</p>}
      {m.hubNote && <p className="job-detail__relay">{m.hubNote}</p>}
      <Card title="Stops">
        <ol className="job-detail__stops">
          {m.stops.map((s) => (
            <li key={s.key} className="job-detail__stop" data-done={s.done ? 'true' : 'false'}>
              <strong>{s.done ? '✓ ' : ''}{s.action}: {s.place}{s.done ? ' (done)' : ''}</strong>
              <span>Arrive {s.arrival}</span>
              <span>Service {s.service}</span>
              {s.instructions && <span>Instructions: {s.instructions}</span>}
            </li>
          ))}
        </ol>
      </Card>
      <Card title="Package">
        <p className="job-detail__line">{m.packageName} · {m.category} · {m.weight}</p>
      </Card>
      <Card title="Your delivery">
        <p className="job-detail__line">Trip: {m.trip}</p>
        <p className="job-detail__line">Expected finish: {m.finish}</p>
        <p className="job-detail__line">Added time: {m.added}</p>
        <p className="job-detail__line job-detail__reward">Reward: {m.reward}</p>
      </Card>
    </div>
  );
}

export function JobLinkNotice({ state, onBack }: { state: JobLinkState; onBack: () => void }) {
  if (state.kind === 'missing') {
    return (
      <div className="job-detail" role="status">
        <h3>{JOB_MISSING_TITLE}</h3>
        <p>The city was changed, so this job link is out of date.</p>
        <Button onClick={onBack}>Back to my jobs</Button>
      </div>
    );
  }
  if (state.kind === 'other') {
    return (
      <div className="job-detail" role="status">
        <h3>{JOB_OTHER_TITLE}</h3>
        <p>You can only see details for your own jobs here.</p>
        <p><a className="job-detail__link" href={state.href}>Open it on the right employee page</a></p>
        <Button onClick={onBack}>Back to my jobs</Button>
      </div>
    );
  }
  return null;
}

export function EmployeeNotFound({ firstId }: { firstId: string | null }) {
  return (
    <div className="emp-portal">
      <EmptyState
        title={EMPLOYEE_MISSING_TITLE}
        description="The city may have been regenerated or imported since this link was made."
        action={(
          <nav aria-label="Where to go">
            {firstId && <a className="job-detail__link" href={`/employee/${encodeURIComponent(firstId)}`}>Go to the first employee</a>}
            {' '}
            <a className="job-detail__link" href="/">Back to home</a>
          </nav>
        )}
      />
    </div>
  );
}
