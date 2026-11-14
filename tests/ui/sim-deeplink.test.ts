import { describe, expect, it } from 'vitest';
import demo from '../../fixtures/demoScenario.json';
import { handleRunIdChange, needsMapFetch, resolveDeepLink, withPackageParam } from '../../client/src/components/sim/simPageModel';

const shipments = demo.shipments.map((s) => ({ id: s.id }));
const first = shipments[0].id;

describe('sim deep link', () => {
  it('uses real Demo city ids', () => {
    expect(first).toBe('shp-1');
    expect(shipments.length).toBeGreaterThan(1);
  });

  it('selects a known package', () => {
    expect(resolveDeepLink('shp-3', shipments)).toEqual({ selectedId: 'shp-3', notFound: false });
  });

  it('flags an unknown package but not before the run loads', () => {
    expect(resolveDeepLink('shp-9999', shipments)).toEqual({ selectedId: undefined, notFound: true });
    expect(resolveDeepLink('shp-9999', null)).toEqual({ selectedId: undefined, notFound: false });
    expect(resolveDeepLink(null, shipments)).toEqual({ selectedId: undefined, notFound: false });
  });

  it('sets and clears the package param, keeping others', () => {
    const p = withPackageParam(new URLSearchParams('x=1'), 'shp-2');
    expect(p.get('package')).toBe('shp-2');
    expect(p.get('x')).toBe('1');
    expect(withPackageParam(p, undefined).has('package')).toBe(false);
  });

  it('runId change: first load fetches the map without clearing', () => {
    expect(handleRunIdChange(null, 'run-1', 'shp-1', shipments)).toEqual({ refetchMap: true, clearSelection: false });
  });

  it('runId change: same runId does nothing', () => {
    expect(needsMapFetch('run-1', 'run-1')).toBe(false);
    expect(handleRunIdChange('run-1', 'run-1', 'shp-1', [])).toEqual({ refetchMap: false, clearSelection: false });
  });

  it('runId change: clears a selection that is gone, keeps one that survives', () => {
    expect(handleRunIdChange('run-1', 'run-2', 'shp-1', [])).toEqual({ refetchMap: true, clearSelection: true });
    expect(handleRunIdChange('run-1', 'run-2', 'shp-1', shipments)).toEqual({ refetchMap: true, clearSelection: false });
    expect(handleRunIdChange('run-1', 'run-2', undefined, shipments)).toEqual({ refetchMap: true, clearSelection: false });
  });
});
