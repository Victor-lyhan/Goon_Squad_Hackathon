// #504: /nyc renders the NYC homepage (Landing dataset="nyc") through the router; / is unchanged.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import Landing from '../../client/src/pages/Landing';
import { nycSummaryFrom, NYC_UNAVAILABLE_TEXT, type NycSummary } from '../../client/src/pages/landingModel';
import type { V2BusinessDirectory, V2Directory } from '../../client/src/ui/shell';
import { ENV_LABELS } from '../../client/src/ui/shellModel';
import { loadDefaultScenario } from '../../server/api/initialRun';
import { businesses as v2b, employees as v2e, simulator } from './landing-nyc-sample';

const { businesses, employees } = loadDefaultScenario();
const v2: V2Directory = { status: 'ready', employees: [{ id: 'emp-7', name: 'Employee 7' }] };
const v2Biz: V2BusinessDirectory = { status: 'ready', businesses: [{ id: 'biz-a', name: 'Alpha' }] };
const ready = nycSummaryFrom(v2b, v2e, simulator);

const render = (path: string, initialNycSummary?: NycSummary) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initial={{ businesses, employees }} initialV2={v2} initialV2Businesses={v2Biz} initialNycSummary={initialNycSummary} />
    </MemoryRouter>,
  );
const main = (html: string) => /<main[^>]*>([\s\S]*)<\/main>/.exec(html)![1];
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const noMvp1Links = (html: string) => {
  for (const h of hrefs(html)) expect(h).not.toMatch(/^\/(business|employee|simulator|help)(\/|$|\?)/);
};

describe('/nyc', () => {
  it('ready: the NYC homepage with its numbers and preview links', () => {
    const html = render('/nyc', ready);
    const body = main(html);
    expect(body).toContain('class="landing landing-nyc"');
    expect(body).not.toContain('Page not found');
    expect(body).toContain('19 / 24');
    expect(body).toContain('href="/nyc/employee/emp-7"');
    expect(body).toContain('href="/nyc/simulator"');
    expect(body).toMatch(/<a [^>]*href="\/nyc\/help"[^>]*>Guided demo<\/a>/);
    expect(body).toContain(ENV_LABELS.nyc);
    expect(body).not.toMatch(/hub/i);
    noMvp1Links(html);
  });
  it.each<[string, NycSummary | undefined, RegExp]>([
    ['loading', undefined, /class="op-summary"/],
    ['503', { status: 'unavailable' }, new RegExp(NYC_UNAVAILABLE_TEXT.replace(/\./g, '\\.'))],
    ['error', { status: 'error' }, /class="op-summary"/],
  ])('%s: still the NYC homepage, no MVP 1 links', (_name, summary, marker) => {
    const html = render('/nyc', summary);
    expect(main(html)).toContain('landing-nyc');
    expect(main(html)).toMatch(marker);
    expect(main(html)).toContain('href="/nyc/help"');
    expect(main(html)).toContain('href="/nyc/simulator"');
    noMvp1Links(html);
  });
  it('the trailing slash renders it too; deeper unknown paths are still a 404', () => {
    expect(main(render('/nyc/', ready))).toContain('landing-nyc');
    expect(main(render('/nyc/nothing-here'))).toContain('Page not found');
  });
  it('/nyc/help is the NYC Guided demo with no MVP 1 links', () => {
    const html = render('/nyc/help');
    expect(main(html)).toContain('help-nyc');
    noMvp1Links(html);
  });
});

describe('/ is unchanged', () => {
  it('renders the synthetic homepage with MVP 1 links', () => {
    const body = main(render('/'));
    expect(body).toContain('class="landing"');
    expect(body).not.toContain('landing-nyc');
    expect(body).toContain('Simulated environment. No real deliveries are made.');
    expect(body).toMatch(/<a [^>]*href="\/help"[^>]*>Guided demo<\/a>/);
    expect(body).toContain('href="/simulator"');
  });
  it('Landing dataset="nyc" without helpPath still links to /help (the path after the cutover)', () => {
    const h = renderToStaticMarkup(<MemoryRouter><Landing dataset="nyc" initialSummary={ready} /></MemoryRouter>);
    expect(h).toMatch(/<a [^>]*href="\/help"[^>]*>Guided demo<\/a>/);
  });
});
