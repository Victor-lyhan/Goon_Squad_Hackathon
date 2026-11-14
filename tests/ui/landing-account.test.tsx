import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import { resolveIdentity } from '../../client/src/demoIdentity';
import type { Business, Employee } from '../../shared/types';

const businesses = [
  { id: 'biz-x', name: 'Xylo Supply', nodeId: 'n1', district: 'd' },
  { id: 'biz-y', name: 'Yarrow Goods', nodeId: 'n2', district: 'd' },
] as Business[];
const employees = [
  { id: 'emp-9', name: 'Ana Ruiz', businessId: 'biz-y' },
  { id: 'emp-8', name: 'Bo Chen', businessId: 'biz-x' },
] as Employee[];

describe('resolveIdentity', () => {
  it('keeps valid stored ids', () => {
    expect(resolveIdentity({ businessId: 'biz-y', employeeId: 'emp-8' }, businesses, employees))
      .toEqual({ businessId: 'biz-y', employeeId: 'emp-8' });
  });
  it('falls back to first entries when stale or missing', () => {
    expect(resolveIdentity({ businessId: 'gone', employeeId: 'gone' }, businesses, employees))
      .toEqual({ businessId: 'biz-x', employeeId: 'emp-9' });
    expect(resolveIdentity({}, businesses, employees)).toEqual({ businessId: 'biz-x', employeeId: 'emp-9' });
  });
  it('returns null for empty lists', () => {
    expect(resolveIdentity({}, [], employees)).toBeNull();
    expect(resolveIdentity({}, businesses, [])).toBeNull();
  });
});

const render = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initial={{ businesses, employees }} />
    </MemoryRouter>,
  );

describe('demo account selector', () => {
  it('lists businesses on a business route and links real ids', () => {
    const html = render('/business/biz-y');
    expect(html).toContain('Xylo Supply');
    expect(html).toContain('Yarrow Goods');
    expect(html).toContain('href="/business/biz-x"');
    expect(html).toContain('href="/employee/emp-9"');
    expect(html).not.toContain('biz-a');
  });
  it('lists employees with employer on an employee route', () => {
    const html = render('/employee/emp-8');
    expect(html).toContain('Ana Ruiz (Yarrow Goods)');
    expect(html).toContain('Bo Chen (Xylo Supply)');
  });
  it('is hidden on / and /simulator', () => {
    expect(render('/')).not.toContain('<select');
    expect(render('/simulator')).not.toContain('<select');
  });
  it('landing buttons use resolved ids', () => {
    const html = render('/');
    expect(html).toContain('href="/business/biz-x"');
  });
});
