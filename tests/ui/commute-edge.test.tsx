import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommuteEditor } from '../../client/src/components/CommuteEditor';
import { LOCKED_TEXT, UNAVAILABLE_TEXT, commuteSaveError } from '../../client/src/components/employee/commuteModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { employeeDashboard } from '../../server/api/views';
import { generateScenario } from '../../server/domain/generator';
import { snapshotAt } from '../../server/domain/simulation';
import type { MapResponse } from '../../shared/api';
import type { Run } from '../../shared/types';

function editorHtml(run: Run, employeeId: string, over: { locked?: boolean } = {}) {
  const { graph, businesses, hubs, employees } = run.scenario;
  const map: MapResponse = {
    runId: run.runId, graph, businesses, hubs,
    homes: employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
  };
  const d = employeeDashboard(run, snapshotAt(run, run.clock.timeMin), employeeId)!;
  const html = renderToStaticMarkup(
    <CommuteEditor employee={d.employee} trips={d.trips} map={map} businesses={businesses}
      locked={over.locked ?? d.phase === 'locked'} onSave={() => {}} />,
  );
  return { html, d };
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ');
function clean(html: string) {
  const t = text(html);
  expect(t).not.toMatch(/NaN|undefined|\bnull\b/);
  expect(t).not.toMatch(/\bn-\d+-\d+\b/);
}

const demo = createInitialRun(loadDefaultScenario());

// Built once per file: generated/derived cities are the slow part on a CI runner.
const eveningOffBase = loadDefaultScenario();
const eveningOffTarget = eveningOffBase.employees[0];
const eveningOffRun = createInitialRun({
  ...eveningOffBase,
  employees: eveningOffBase.employees.map((e) => (e.id === eveningOffTarget.id ? { ...e, availableEvening: false } : e)),
});
const zeroHubRun = createInitialRun(generateScenario({
  seed: 5, employees: 20, packages: 10, hubs: 0, maxExtraMin: 8, preset: 'random',
}));

// Explicit timeouts: ~3x+ headroom over local time (<0.3 s), floor 10 s, for slower CI runners.
const SLOW_MS = 10_000;

describe('commute editor edge states with real data', () => {
  it('Demo employee with no jobs shows labels and API durations', () => {
    const id = demo.scenario.employees.find((e) => !demo.jobs.some((j) => j.employeeId === e.id))!.id;
    const { html, d } = editorHtml(demo, id);
    expect(d.assigned.length + d.completed.length).toBe(0);
    clean(html);
    for (const t of d.trips) {
      expect(text(html)).toMatch(new RegExp(`${t.direction === 'evening' ? 'Evening' : 'Morning'} route: .*\\d+ (min|h)`));
    }
    expect(html).not.toContain(UNAVAILABLE_TEXT);
    const home = demo.scenario.graph.nodes.find((n) => n.id === d.employee.homeNodeId)!.label;
    expect(html).toContain(home!.replace('&', '&amp;'));
  });

  it('evening trip switched off shows Not available for deliveries', () => {
    const { html, d } = editorHtml(eveningOffRun, eveningOffTarget.id);
    expect(d.trips.some((t) => t.direction === 'evening')).toBe(false);
    clean(html);
    expect(text(html)).toContain(`Evening route: ${UNAVAILABLE_TEXT}`);
    expect(text(html)).toMatch(/Morning route: .*\d+ (min|h)/);
  }, SLOW_MS);

  it('random zero-hub city (seed 5) renders every employee cleanly', () => {
    const run = zeroHubRun;
    expect(run.scenario.hubs).toHaveLength(0);
    for (const e of run.scenario.employees) {
      const { html } = editorHtml(run, e.id);
      clean(html);
      expect(text(html)).toMatch(/Evening route: .*(\d+ (min|h)|Not available)/);
    }
  }, SLOW_MS);

  it('locked phase disables inputs and links to the simulator', () => {
    const run = { ...demo, clock: { ...demo.clock, phase: 'locked' as const } };
    const { html } = editorHtml(run, run.scenario.employees[0].id);
    clean(html);
    expect(text(html)).toContain('need a new planning cycle');
    expect(html).toContain('href="/simulator"');
    expect(html).not.toMatch(/<(input|select)(?![^>]*disabled)[^>]*>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*Save commute and find jobs/);
  });

  it('maps a 409 to the locked message', () => {
    expect(commuteSaveError(409, 'Planning is locked')).toBe(LOCKED_TEXT);
    expect(commuteSaveError(400, 'x')).toBe('Please fix the highlighted fields.');
    expect(commuteSaveError(500, 'Boom')).toBe('Boom');
  });
});
