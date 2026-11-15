// @vitest-environment jsdom
// #746: the homepage is silent in the console in development. Mounted in a real DOM with the router, with both
// entries linked and with one of them disabled; any console.error (or console.warn) fails the test. Before
// #746 React logged 'A props object containing a "key" prop is being spread into JSX' for <EntryBody {...w} />.
// React logs that message once per component for each page load, so on the old code the first render here fails.
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import Landing, { WORKSPACES, WorkspaceEntries } from '../../client/src/pages/Landing';
import type { NycSummary } from '../../client/src/pages/landingModel';
import { mount, textOf } from './kitDom';

const ready: NycSummary = {
  status: 'ready', businesses: 18, commuters: 60, matched: 24, requested: 24,
  businessIds: ['biz-a', 'biz-b'], employeeIds: ['emp-a', 'emp-b'], watchPackageId: 'shp-3',
};

let error: MockInstance;
let warn: MockInstance;
beforeEach(() => {
  window.localStorage.clear();
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

/** Every console.error and console.warn call so far, as text (so a failure shows React's message). */
const logged = () => [...error.mock.calls, ...warn.mock.calls].map((args) => args.map(String).join(' '));

/** The entries as the page shows them: tag, class, href, aria-disabled and text, in order. */
const entries = (container: HTMLElement) => [...container.querySelectorAll('.workspaces > li > *')].map((el) => ({
  tag: el.tagName.toLowerCase(),
  className: el.className,
  href: el.getAttribute('href'),
  disabled: el.getAttribute('aria-disabled'),
  text: textOf(el),
}));

const link = (href: string, text: string) => ({ tag: 'a', className: 'workspace-entry', href, disabled: null, text });
const off = (text: string) => ({ tag: 'div', className: 'workspace-entry is-disabled', href: null, disabled: 'true', text });
const BUSINESS = 'BusinessSend a package and track it→';
const EMPLOYEE = 'EmployeeSet a commute and see your deliveries→';

describe('the homepage logs nothing to the console (#746)', () => {
  it('with Business and Employee both links', () => {
    const { container } = mount(<MemoryRouter><Landing initialSummary={ready} /></MemoryRouter>);
    expect(logged()).toEqual([]);
    expect(entries(container)).toEqual([link('/business/biz-a', BUSINESS), link('/employee/emp-a', EMPLOYEE)]);
  });

  it('with Business a link and Employee disabled (no employee account in the run)', () => {
    const { container } = mount(<MemoryRouter><Landing initialSummary={{ ...ready, employeeIds: [] }} /></MemoryRouter>);
    expect(logged()).toEqual([]);
    expect(entries(container)).toEqual([link('/business/biz-a', BUSINESS), off(EMPLOYEE)]);
  });

  it('with Business disabled and Employee a link, and with both disabled', () => {
    const one = mount(<MemoryRouter><WorkspaceEntries paths={{ business: null, employee: '/employee/emp-b' }} /></MemoryRouter>);
    expect(entries(one.container)).toEqual([off(BUSINESS), link('/employee/emp-b', EMPLOYEE)]);
    const none = mount(<MemoryRouter><Landing initialSummary={{ status: 'loading' }} /></MemoryRouter>);
    expect(entries(none.container)).toEqual([off(BUSINESS), off(EMPLOYEE)]);
    expect(logged()).toEqual([]);
  });
});

describe('Landing.tsx passes props by name (#746)', () => {
  const src = readFileSync('client/src/pages/Landing.tsx', 'utf8');

  it('spreads no object into a JSX element', () => {
    // `{...x}` right after a tag name or after another prop, inside one opening tag
    expect(src.match(/<[A-Za-z][\w.]*(\s[^<>]*)?\{\s*\.\.\.[^}]*\}/g)).toBeNull();
  });

  it('keeps the list key on the entries, which React reads from the <li> only', () => {
    expect(WORKSPACES.map((w) => w.key)).toEqual(['business', 'employee']);
    expect(src).toMatch(/<li key=\{w\.key\}>/);
  });
});
