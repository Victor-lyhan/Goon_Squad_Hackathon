import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import { ConnectionBanner } from '../../client/src/ui/ConnectionBanner';
import { initialConnection, nextConnection } from '../../client/src/ui/connectionModel';
import { reconcileSelection, runChanged, staleNote } from '../../client/src/ui/shellModel';

const businesses = [{ id: 'biz-01', name: 'Brooklyn Roasters' }, { id: 'biz-02', name: 'Hudson Print Co' }];
const employees = [{ id: 'emp-01', name: 'Maya Chen' }, { id: 'emp-02', name: 'Luis Ortega' }, { id: 'emp-03', name: 'Ana Ruiz' }, { id: 'emp-04', name: 'Sam Lee' }];
const bids = businesses.map((b) => b.id);
const eids = employees.map((e) => e.id);
const render = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initialV2={{ status: 'ready', employees }} initialV2Businesses={{ status: 'ready', businesses }} />
    </MemoryRouter>,
  );

describe('reconcileSelection with Demo-city ids', () => {
  it('keeps a valid id', () => {
    expect(reconcileSelection(bids[1], bids)).toEqual({ id: bids[1], stale: false });
    expect(reconcileSelection(eids[3], eids)).toEqual({ id: eids[3], stale: false });
  });
  it('falls back to the first valid id when the chosen one is gone', () => {
    expect(reconcileSelection('biz-gone', bids)).toEqual({ id: bids[0], stale: true });
    expect(reconcileSelection(undefined, eids)).toEqual({ id: eids[0], stale: true });
  });
  it('handles an empty city', () => {
    expect(reconcileSelection('x', [])).toEqual({ id: '', stale: true });
  });
  it('note names the fallback', () => {
    expect(staleNote('business', 'Acme')).toContain('Acme');
    expect(staleNote('employee', null)).toContain("isn't in the current city");
  });
});

describe('runChanged', () => {
  it('ignores the first sighting and repeats; flags a new id', () => {
    expect(runChanged(null, 'run-1')).toBe(false);
    expect(runChanged('run-1', 'run-1')).toBe(false);
    expect(runChanged('run-1', 'run-2')).toBe(true);
    expect(runChanged('run-1', undefined)).toBe(false);
  });
});

describe('shell render', () => {
  it('stale business URL shows the first valid account and a polite note, never the stale id', () => {
    const html = render('/business/biz-stale');
    expect(html).toContain('Demo account');
    expect(html).toContain("isn&#x27;t in the current city");
    expect(html).toContain(`value="${bids[0]}" selected`.replace(' selected', '')); // option present
    expect(html).not.toContain('value="biz-stale"');
    expect(html).toContain(`href="/business/${bids[0]}"`);
    expect(html).toMatch(/role="status"[^>]*>That business/);
  });
  it('stale employee URL falls back to the first employee', () => {
    const html = render('/employee/emp-stale');
    expect(html).toContain(`href="/employee/${eids[0]}"`);
    expect(html).not.toContain('value="emp-stale"');
  });
  it('valid ids show no note', () => {
    expect(render(`/business/${bids[0]}`)).not.toContain('current city');
  });
  it('badge is on no route (#833 the homepage, #854 every page)', () => {
    for (const p of ['/', `/business/${bids[0]}`, `/employee/${eids[0]}`, '/simulator', '/nope']) {
      expect(render(p), p).not.toContain('Real NYC locations · simulated deliveries');
    }
  });
});

describe('connection banner recovery', () => {
  it('appears after failed checks, says "connected again" on the next success, then goes, as role=status', () => {
    let s = nextConnection(nextConnection(initialConnection, false), false);
    const off = renderToStaticMarkup(<ConnectionBanner status={s.status} />);
    expect(off).toContain('role="status"');
    expect(off).not.toContain('role="alert"');
    expect(off).toContain('ui-connection-banner');
    // Since #886 the next success is the "back" moment; the note goes two answered checks later.
    s = nextConnection(s, true);
    const back = renderToStaticMarkup(<ConnectionBanner status={s.status} />);
    expect(back).toContain('Connected to the Relay server again.');
    expect(back).not.toContain('role="alert"');
    s = nextConnection(nextConnection(s, true), true);
    expect(s.status).toBe('online');
    expect(renderToStaticMarkup(<ConnectionBanner status={s.status} />)).not.toContain('ui-connection-banner');
  });
});
