// The package panel's local filter state across polls (#418, DECISIONS pass 43). There is no DOM in
// this test setup, so a tiny hooks harness stands in for React's useState/useMemo while the panel
// function is called directly; the returned tree is then rendered with real React to read the HTML.
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ active: false, slots: [] as { v: unknown }[], i: 0 }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<T>(init: T) {
      if (!h.active) return actual.useState(init);
      const k = h.i++;
      h.slots[k] ??= { v: init };
      return [h.slots[k].v as T, (next: T) => { h.slots[k].v = next; }] as const;
    },
    useMemo<T>(make: () => T, deps: unknown[]) {
      return h.active ? make() : actual.useMemo(make, deps);
    },
  };
});

import { PackageFilterBar, type PackageFilterBarProps } from '../../client/src/components/sim/v2/packages/PackageFilterBar';
import { PackagePanel } from '../../client/src/components/sim/v2/packages/PackagePanel';
import type { SimulatorResponse } from '../../shared/v2/api';
import { makeMap, makeSim, STATUS_MORNING } from './sim-v2-packages-fixture';

const map = makeMap();
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** Calls the panel as a function with the harness hooks (one mounted instance). */
function render(sim: SimulatorResponse) {
  h.active = true; h.i = 0;
  const tree = PackagePanel({ sim, map, selectedId: undefined, onSelect: () => {} });
  h.active = false;
  return tree;
}

function find(node: ReactNode, pred: (el: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, pred));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<{ children?: ReactNode }>;
  return [...(pred(el) ? [el] : []), ...find(el.props.children, pred)];
}
const filterBar = (tree: ReactNode) => find(tree, (el) => el.type === PackageFilterBar)[0].props as PackageFilterBarProps;
const clearButtons = (tree: ReactNode) =>
  find(tree, (el) => el.type === 'button' && (el.props as { children?: unknown }).children === 'Clear filters');
const html = (tree: ReactNode) => unescape(renderToStaticMarkup(tree as ReactElement));
const chipTexts = (out: string) => [...out.matchAll(/<button[^>]*class="pk-chip[^"]*"[^>]*aria-pressed="(\w+)"[^>]*>([\s\S]*?)<\/button>/g)]
  .map((m) => `${m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}${m[1] === 'true' ? ' *' : ''}`);

beforeEach(() => { h.slots = []; h.i = 0; h.active = false; });

describe('PackagePanel across polls', () => {
  it('a new poll with changed statuses keeps the search text and filter, and updates the counts', () => {
    let tree = render(makeSim());
    filterBar(tree).onQueryChange('dumbo');
    tree = render(makeSim());
    filterBar(tree).onStatusChange('picked_up');
    tree = render(makeSim());
    let out = html(tree);
    expect(out).toMatch(/<input[^>]*type="search"[^>]*value="dumbo"/);
    expect(chipTexts(out)).toEqual(['All 4', 'Unmatched 1', 'Picked up 2 *', 'At relay point 1']);
    expect(out).toContain('1 of 4 packages');
    expect(out).toContain('Brand proofs');

    // Next poll: same shipments, new statuses, a new response object.
    tree = render(makeSim(STATUS_MORNING, 8));
    expect(filterBar(tree)).toMatchObject({ query: 'dumbo', status: 'picked_up' });
    out = html(tree);
    expect(out).toMatch(/<input[^>]*type="search"[^>]*value="dumbo"/);
    expect(chipTexts(out)).toEqual(['All 4', 'Unmatched 1', 'Picked up 0 *', 'Out for delivery 1', 'Delivered 2']);
    expect(out).toContain('0 of 4 packages');
    expect(out).toContain('No packages match these filters.');
  });

  it('the empty state offers "Clear filters", which resets search and status', () => {
    let tree = render(makeSim());
    filterBar(tree).onQueryChange('no such package');
    tree = render(makeSim());
    const out = html(tree);
    expect(out).toContain('No packages match these filters.');
    expect(out).toContain('0 of 4 packages');
    expect(out).not.toContain('class="sw-pkgs"');
    const [clear] = clearButtons(tree);
    expect(clear).toBeDefined();
    (clear.props as { onClick: () => void }).onClick();
    tree = render(makeSim());
    expect(filterBar(tree)).toMatchObject({ query: '', status: 'all' });
    expect(html(tree)).toContain('4 of 4 packages');
    expect(clearButtons(tree)).toHaveLength(0);
  });

  it('with an active filter and results, a "Clear filters" link is also shown', () => {
    let tree = render(makeSim());
    filterBar(tree).onStatusChange('at_hub');
    tree = render(makeSim());
    expect(html(tree)).toContain('1 of 4 packages');
    expect(clearButtons(tree)).toHaveLength(1);
  });
});
