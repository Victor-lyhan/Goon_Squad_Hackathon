import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import { switchIdentityPath } from '../../client/src/ui/shell';
import { loadDefaultScenario } from '../../server/api/initialRun';

describe('switchIdentityPath', () => {
  it('keeps the portal type and drops nothing but the id', () => {
    expect(switchIdentityPath('/business/biz-1', 'biz-2')).toEqual({ kind: 'business', path: '/business/biz-2' });
    expect(switchIdentityPath('/employee/emp-1/', 'emp-2')).toEqual({ kind: 'employee', path: '/employee/emp-2' });
  });
  it('encodes ids and ignores other routes', () => {
    expect(switchIdentityPath('/business/a', 'x y')?.path).toBe('/business/x%20y');
    expect(switchIdentityPath('/simulator', 'x')).toBeNull();
    expect(switchIdentityPath('/business/a', '')).toBeNull();
  });
});

const { businesses, employees } = loadDefaultScenario();
const bid = businesses[0].id;
const eid = employees[0].id;
const render = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initial={{ businesses, employees }} />
    </MemoryRouter>,
  );

describe('app shell with Demo-city lists', () => {
  it('skip link comes first, targets main', () => {
    for (const p of ['/', `/business/${bid}`, `/employee/${eid}`, '/simulator', '/nope']) {
      const html = render(p);
      expect(html.indexOf('Skip to main content')).toBeGreaterThanOrEqual(0);
      expect(html.indexOf('<a')).toBe(html.indexOf('<a class="skip-link"'));
      expect(html).toContain('id="main-content"');
    }
  });
  it('marks the active portal with aria-current', () => {
    const cur = (html: string) => [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(cur(render(`/business/${bid}`))).toContain('Business');
    expect(cur(render(`/employee/${eid}`))).toContain('Employee');
    expect(cur(render('/simulator'))).toContain('Simulator');
    expect(cur(render('/nope'))).not.toContain('Business');
  });
  it('renders the selector on identity routes', () => {
    expect(render(`/business/${bid}`)).toContain('Demo account');
    expect(render(`/employee/${eid}`)).toContain('Demo account');
  });
  it('shows a branded 404 with portal links', () => {
    const html = render('/nope');
    expect(html).toContain('Page not found');
    expect(html).toContain('href="/"');
    expect(html).toContain(`href="/business/${bid}"`);
    expect(html).toContain(`href="/employee/${eid}"`);
    expect(html).toContain('href="/simulator"');
  });
});
