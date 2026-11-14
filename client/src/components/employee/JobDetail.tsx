import type { JobResponse, MapResponse } from '../../../../shared/api';
import type { Business, Hub, ShipmentProgress } from '../../../../shared/types';
import { CityMap } from '../CityMap';
import { Card, StatusPill } from '../../ui';
import { toJobDetailModel } from './jobDetailModel';
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
      <Card title="Stops">
        <ol className="job-detail__stops">
          {m.stops.map((s) => (
            <li key={s.key} className="job-detail__stop">
              <strong>{s.action}: {s.place}</strong>
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
        <p className="job-detail__line">Expected finish: {m.finish}</p>
        <p className="job-detail__line">Added time: {m.added}</p>
        <p className="job-detail__line job-detail__reward">Reward: {m.reward}</p>
      </Card>
    </div>
  );
}
