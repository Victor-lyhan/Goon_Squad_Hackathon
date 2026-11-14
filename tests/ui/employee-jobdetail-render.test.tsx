import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobDetail } from '../../client/src/components/employee/JobDetail';
import { sampleJob } from './jobDetailSample';

const render = (job = sampleJob.at(0)) =>
  renderToStaticMarkup(<JobDetail job={job} map={sampleJob.map} businesses={sampleJob.businesses} hubs={sampleJob.hubs} />);

describe('JobDetail', () => {
  it('renders map, stops, package, finish, reward and status', () => {
    const html = render();
    expect(html).toContain('route-base');
    expect(html).toContain('route-hi');
    expect(html).toContain('Pick up: Business A');
    expect(html).toContain('Drop at hub: Hub H');
    expect(html).toContain('Ask for desk');
    expect(html).toContain('Contracts');
    expect(html).toContain('0.3 kg');
    expect(html).toContain('Expected finish: Day 1, 5:22 PM');
    expect(html).toContain('+6 min');
    expect(html).toContain('$3.00');
    expect(html).toContain('Assigned');
    expect(html).toContain('Drop at Hub H; another employee completes delivery');
    expect(html).not.toContain('Accept');
  });
  it('direct has no relay line', () => {
    expect(render(sampleJob.direct())).not.toContain('another employee');
  });
});
