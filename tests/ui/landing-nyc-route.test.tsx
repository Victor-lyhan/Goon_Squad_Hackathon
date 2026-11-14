// #504, #548: / renders the NYC homepage (Landing dataset="nyc") through the router since the cutover;
// its links go to the main paths, never /nyc/.... #652: the button, Business and Employee; no Guided demo link.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import Landing from '../../client/src/pages/Landing';
import { nycSummaryFrom, nycWorkspacePaths, NYC_UNAVAILABLE_TEXT, type NycSummary } from '../../client/src/pages/landingModel';
import type { V2BusinessDirectory, V2Directory } from '../../client/src/ui/shell';
import { ENV_LABELS } from '../../client/src/ui/shellModel';
import { businesses as v2b, employees as v2e, simulator, storySimulator } from './landing-nyc-sample';

const v2: V2Directory = { status: 'ready', employees: [{ id: 'emp-7', name: 'Employee 7' }] };
const v2Biz: V2BusinessDirectory = { status: 'ready', businesses: [{ id: 'biz-a', name: 'Alpha' }] };
const ready = nycSummaryFrom(v2b, v2e, simulator);
const firstBiz = v2b.businesses[0].id;
const firstEmp = v2e.employees[0].id;

const render = (path: string, initialNycSummary?: NycSummary) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initialV2={v2} initialV2Businesses={v2Biz} initialNycSummary={initialNycSummary} />
    </MemoryRouter>,
  );
const main = (html: string) => /<main[^>]*>([\s\S]*)<\/main>/.exec(html)![1];
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const noPreviewLinks = (html: string) => {
  for (const h of hrefs(html)) expect(h).not.toMatch(/^\/nyc(\/|$|\?)/);
};

describe('/', () => {
  it('ready: the NYC homepage with its numbers and main-path links', () => {
    const html = render('/', ready);
    const body = main(html);
    expect(body).toContain('class="landing landing-nyc"');
    expect(body).not.toContain('Page not found');
    expect(body.replace(/<[^>]+>/g, '')).toContain('19 of 24 packages matched');
    expect(body).toContain(`href="/business/${firstBiz}"`);
    expect(body).toContain(`href="/employee/${firstEmp}"`);
    expect(body).toContain('href="/simulator"'); // the sample run has no plans: the button opens the plain simulator
    expect(body).not.toContain('Guided demo');
    expect(body).not.toContain('href="/help"');
    expect(body).toContain(ENV_LABELS.nyc);
    expect(body).not.toMatch(/hub|synthetic/i);
    expect(body).not.toContain('nav-pending');
    noPreviewLinks(html);
  });
  it.each<[string, NycSummary | undefined, RegExp]>([
    ['loading', undefined, /class="op-summary"/],
    ['503', { status: 'unavailable' }, new RegExp(NYC_UNAVAILABLE_TEXT.replace(/\./g, '\\.'))],
    ['error', { status: 'error' }, /class="op-summary"/],
  ])('%s: still the NYC homepage, no /nyc links', (_name, summary, marker) => {
    const html = render('/', summary);
    expect(main(html)).toContain('landing-nyc');
    expect(main(html)).toMatch(marker);
    expect(main(html)).not.toContain('href="/help"');
    expect(hrefs(main(html))).toEqual(['/simulator']); // the button works before and without the answer
    noPreviewLinks(html);
  });
  it('through the router, the button opens the story package of the run and plays it (#652)', () => {
    const body = main(render('/', nycSummaryFrom(v2b, v2e, storySimulator)));
    expect(hrefs(body)).toEqual(['/simulator?package=shp-3&amp;play=1', `/business/${firstBiz}`, `/employee/${firstEmp}`]);
  });
  it('Landing has no link to /help', () => {
    const h = renderToStaticMarkup(<MemoryRouter><Landing dataset="nyc" initialSummary={ready} /></MemoryRouter>);
    expect(h).not.toContain('/help');
  });
});

describe('workspace links', () => {
  it('use a stored identity that is in the NYC lists, else the first account', () => {
    const lastBiz = v2b.businesses[v2b.businesses.length - 1].id;
    const lastEmp = v2e.employees[v2e.employees.length - 1].id;
    expect(nycWorkspacePaths(ready, { businessId: lastBiz, employeeId: lastEmp }))
      .toEqual({ business: `/business/${lastBiz}`, employee: `/employee/${lastEmp}`, simulator: '/simulator' });
    expect(nycWorkspacePaths(ready, { businessId: 'biz-sunrise', employeeId: 'emp-001' }))
      .toEqual({ business: `/business/${firstBiz}`, employee: `/employee/${firstEmp}`, simulator: '/simulator' });
  });
  it('are pending until the summary is ready', () => {
    for (const s of [{ status: 'loading' }, { status: 'error' }, { status: 'unavailable' }] as NycSummary[]) {
      expect(nycWorkspacePaths(s)).toEqual({ business: null, employee: null, simulator: '/simulator' });
    }
  });
});
