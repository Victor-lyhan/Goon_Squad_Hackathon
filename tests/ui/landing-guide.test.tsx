import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DemoGuide, GUIDE_STEPS, type GuideFacts } from '../../client/src/pages/Landing';
import { portalPaths, resolveIdentity } from '../../client/src/demoIdentity';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { snapshotAt } from '../../server/domain/simulation';

const run = createInitialRun(loadDefaultScenario());
const { businesses, employees } = run.scenario;
const m = snapshotAt(run, run.clock.timeMin).metrics;
const resolved = resolveIdentity({}, businesses, employees);
const paths = portalPaths(resolved);
const ready: GuideFacts = {
  status: 'ready', businesses: businesses.length, commuters: employees.length,
  matched: m.matched, requested: m.requested,
};
const render = (facts: GuideFacts, p = paths) =>
  renderToStaticMarkup(<MemoryRouter><DemoGuide paths={p} facts={facts} /></MemoryRouter>);

describe('landing demo guide with real Demo city data', () => {
  const html = render(ready);

  it('renders 6 numbered steps with correct hrefs', () => {
    expect(html.match(/class="guide-step"/g)).toHaveLength(6);
    expect(GUIDE_STEPS).toHaveLength(6);
    const emp = `href="/employee/${resolved!.employeeId}"`;
    const biz = `href="/business/${resolved!.businessId}"`;
    expect(html.match(new RegExp(emp, 'g'))).toHaveLength(2);
    expect(html.match(new RegExp(biz, 'g'))).toHaveLength(3);
    expect(html.match(/href="\/simulator"/g)).toHaveLength(1);
  });

  it('shows live facts with no NaN/undefined', () => {
    expect(html).toContain(`<strong>${businesses.length}</strong> businesses`);
    expect(html).toContain(`${m.matched} / ${m.requested}`);
    expect(html).not.toMatch(/NaN|undefined|null/);
  });

  it('shows a spinner while loading and a quiet line when offline, steps still render', () => {
    const loading = render({ status: 'loading' });
    expect(loading).toContain('ui-spinner');
    const offline = render({ status: 'error' });
    expect(offline).toContain('Live numbers unavailable');
    for (const h of [loading, offline]) expect(h.match(/class="guide-step"/g)).toHaveLength(6);
  });

  it('disables portal steps when no identity resolves', () => {
    const h = render({ status: 'error' }, { business: null, employee: null });
    expect(h).toContain('aria-disabled="true"');
    expect(h).toContain('href="/simulator"');
  });
});
