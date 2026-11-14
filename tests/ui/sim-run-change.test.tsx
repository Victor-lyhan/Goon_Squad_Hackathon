import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SimulatorView } from '../../client/src/components/sim/SimulatorView';
import { SimNotes } from '../../client/src/pages/Simulator';
import {
  STALE_PACKAGE_NOTE, handleRunIdChange, isReconnecting, mapForRun, stalePackageNote,
} from '../../client/src/components/sim/simPageModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import { generateScenario } from '../../server/domain/generator';
import type { MapResponse } from '../../shared/api';

const demo = createInitialRun(loadDefaultScenario());
const random = createInitialRun(generateScenario({ preset: 'random', seed: 7, employees: 120, packages: 40, hubs: 3, maxExtraMin: 8 }));
const idsOf = (r: typeof demo) => r.scenario.shipments.map((s) => ({ id: s.id }));

function mapOf(r: typeof demo, runId: string): MapResponse {
  const s = r.scenario;
  return { runId, graph: s.graph, businesses: s.businesses, hubs: s.hubs,
    homes: s.employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })) } as unknown as MapResponse;
}
const noop = () => {};
const bad = (html: string) => {
  expect(html).not.toContain('NaN');
  expect(html).not.toContain('undefined');
  expect(html).not.toMatch(/node-\d+/);
};

describe('run change model', () => {
  it('refetches the map once on a new runId and clears a selection that is gone', () => {
    const demoIds = idsOf(demo);
    const rndIds = idsOf(random);
    const gone = demoIds.find((d) => !rndIds.some((r) => r.id === d.id))?.id ?? 'shp-gone';
    const r = handleRunIdChange('run-1', 'run-2', gone, rndIds);
    expect(r).toEqual({ refetchMap: true, clearSelection: true });
    expect(handleRunIdChange('run-2', 'run-2', gone, rndIds)).toEqual({ refetchMap: false, clearSelection: false });
    const kept = rndIds[0].id;
    expect(handleRunIdChange('run-1', 'run-2', kept, rndIds).clearSelection).toBe(false);
  });

  it('notes an unknown ?package= without hardcoded ids, and only once the run has loaded', () => {
    expect(stalePackageNote('nope-123', idsOf(demo))).toBe(STALE_PACKAGE_NOTE);
    expect(STALE_PACKAGE_NOTE).toBe("That package isn't in the current city");
    expect(stalePackageNote('nope-123', idsOf(random))).toBe(STALE_PACKAGE_NOTE);
    expect(stalePackageNote('nope-123', null)).toBeNull();
    expect(stalePackageNote(null, idsOf(demo))).toBeNull();
    expect(stalePackageNote(idsOf(demo)[0].id, idsOf(demo))).toBeNull();
  });

  it('only draws a map that belongs to the current runId', () => {
    const m = mapOf(demo, 'run-1');
    expect(mapForRun(m, 'run-1', 'run-1')).toBe(m);
    expect(mapForRun(m, 'run-1', 'run-2')).toBeNull();
    expect(mapForRun(m, 'run-1', undefined)).toBeNull();
  });

  it('reconnecting needs both an error and a last frame', () => {
    expect(isReconnecting('Request failed (503)', true)).toBe(true);
    expect(isReconnecting(null, true)).toBe(false);
    expect(isReconnecting('x', false)).toBe(false);
  });
});

describe.each([['demo', demo], ['random', random]] as const)('render states (%s)', { timeout: 15_000 }, (_n, run) => {
  const sim = buildSimulatorResponse(run);
  const map = mapOf(run, sim.runId);
  const view = (props: Partial<Parameters<typeof SimulatorView>[0]> = {}) => renderToStaticMarkup(
    <SimulatorView sim={sim} map={map} employees={run.scenario.employees} onSelect={noop} onControl={noop} {...props} />);

  it('normal frame', () => { bad(view()); });
  it('stale link note, no detail crash', () => {
    const html = renderToStaticMarkup(<><SimNotes note={STALE_PACKAGE_NOTE} reconnecting={false} />{view({ selectedId: 'missing' })}</>);
    expect(html).toContain("That package isn&#x27;t in the current city");
    bad(html);
  });
  it('reconnecting keeps the last frame', () => {
    const html = renderToStaticMarkup(<><SimNotes note={null} reconnecting />{view()}</>);
    expect(html).toContain('Reconnecting…');
    expect(html).toContain('Simulation playback');
    bad(html);
  });
  it('map still loading for a new run', () => {
    bad(view({ map: null }));
  });
});
