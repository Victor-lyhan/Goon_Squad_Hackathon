// @vitest-environment jsdom
// Issue #661: both "watch" links of the Employee page (the delivery list's "Watch in simulator" and the job
// view's "Watch this package") open `/simulator?package=<shipment id>&play=1` (DECISIONS pass 63 and 64),
// URL-encoded and built by the one helper `simulatorHref`. The hrefs are read from the rendered links.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeliveryList } from '../../client/src/components/employee/v2/DeliveryList';
import { JobDetailV2 } from '../../client/src/components/employee/v2/JobDetailV2';
import { deliveryRows } from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import { jobDetail, simulatorHref, watchHref } from '../../client/src/components/employee/v2/jobDetailV2Model';
import { businesses as listBusinesses, directView, relayView } from './employee-v2-workspace-sample';
import { businesses as jobBusinesses, eveningDirect, relayLeg2 } from './employeeV2JobSample';

/** The `href` attributes of the links with this text, as the browser reads them (`&amp;` decoded). */
function hrefs(html: string, label: string): string[] {
  const box = document.createElement('div');
  box.innerHTML = html;
  return [...box.querySelectorAll('a')].filter((a) => a.textContent === label).map((a) => a.getAttribute('href') ?? '');
}

/** An ID no run produces, with every character a query string could trip on. */
const ODD_ID = 'shp 7&play=0#x/é';
const ODD_HREF = '/simulator?package=shp%207%26play%3D0%23x%2F%C3%A9&play=1';

describe('simulatorHref', () => {
  it('opens the package and plays its journey', () => {
    expect(simulatorHref('shp-0001')).toBe('/simulator?package=shp-0001&play=1');
  });

  it('URL-encodes the shipment ID, so it cannot add or change a parameter', () => {
    expect(simulatorHref(ODD_ID)).toBe(ODD_HREF);
    const query = new URLSearchParams(simulatorHref(ODD_ID).split('?')[1]);
    expect([...query.keys()]).toStrictEqual(['package', 'play']);
    expect(query.get('package')).toBe(ODD_ID);
    expect(query.get('play')).toBe('1');
  });
});

describe('the delivery list\'s "Watch in simulator"', () => {
  const list = (views: Parameters<typeof deliveryRows>[0]) => renderToStaticMarkup(
    <DeliveryList id="assigned" title="Assigned deliveries" rows={deliveryRows(views, listBusinesses, 'Astoria')} emptyText="" />,
  );

  it('plays the journey of each row\'s own package', () => {
    expect(hrefs(list([directView, relayView]), 'Watch in simulator')).toStrictEqual([
      `/simulator?package=${directView.shipment.id}&play=1`,
      `/simulator?package=${relayView.shipment.id}&play=1`,
    ]);
  });

  it('is the helper\'s link, encoded', () => {
    const odd = { ...directView, job: { ...directView.job, shipmentId: ODD_ID }, shipment: { ...directView.shipment, id: ODD_ID } };
    expect(hrefs(list([odd]), 'Watch in simulator')).toStrictEqual([ODD_HREF]);
    expect(deliveryRows([odd], listBusinesses, 'Astoria')[0].simulatorHref).toBe(simulatorHref(ODD_ID));
  });
});

describe('the job view\'s "Watch this package"', () => {
  const view = (job: ReturnType<typeof eveningDirect>) => renderToStaticMarkup(
    <JobDetailV2 job={job} businesses={jobBusinesses} homeNeighborhood="Astoria" onBack={() => {}} />,
  );

  it.each([['a direct job', eveningDirect()], ['a relay leg', relayLeg2()]])('plays the journey of %s', (_name, job) => {
    expect(hrefs(view(job), 'Watch this package')).toStrictEqual([`/simulator?package=${job.shipment.id}&play=1`]);
  });

  it('is the helper\'s link, encoded', () => {
    const job = eveningDirect();
    const odd = { ...job, job: { ...job.job, shipmentId: ODD_ID }, shipment: { ...job.shipment, id: ODD_ID } };
    expect(hrefs(view(odd), 'Watch this package')).toStrictEqual([ODD_HREF]);
    expect(watchHref(odd)).toBe(simulatorHref(ODD_ID));
    expect(jobDetail(odd, jobBusinesses, 'Astoria').watchHref).toBe(simulatorHref(ODD_ID));
  });
});
