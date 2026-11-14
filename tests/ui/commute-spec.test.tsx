import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommuteEditor } from '../../client/src/components/CommuteEditor';
import {
  DEFAULT_MAX_EXTRA_MIN, SAVED_TEXT, WAYPOINT_LIMIT_MESSAGE, addWaypoint, emptyForm, rematchedText, toRequest,
} from '../../client/src/components/employee/commuteModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { employeeDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { MapResponse } from '../../shared/api';

const run = createInitialRun(loadDefaultScenario());
const { graph, businesses, hubs, employees } = run.scenario;
const map: MapResponse = {
  runId: run.runId, graph, businesses, hubs,
  homes: employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
};
const render = (id: string, saved?: { trips: never[]; rematchedShipmentIds: string[] }) => {
  const d = employeeDashboard(run, snapshotAt(run, run.clock.timeMin), id)!;
  const html = renderToStaticMarkup(
    <CommuteEditor employee={d.employee} trips={d.trips} map={map} businesses={businesses} locked={false} saved={saved} onSave={() => {}} />,
  );
  return { html, d, text: html.replace(/<[^>]+>/g, ' ') };
};
const withJob = employees.find((e) => run.jobs.some((j) => j.employeeId === e.id))!;
const noJob = employees.find((e) => !run.jobs.some((j) => j.employeeId === e.id))!;

describe.each([['with a job', withJob], ['without a job', noJob]])('spec 3B editor %s', (_n, emp) => {
  const { html, text, d } = render(emp.id);
  it('lists every registered business and the employer', () => {
    for (const b of businesses) expect(html).toContain(b.name.replace('&', '&amp;'));
    expect(html).toMatch(new RegExp(`<option value="${emp.businessId}" selected`));
  });
  it('picks home by friendly name, no raw node ids visible', () => {
    const label = graph.nodes.find((n) => n.id === emp.homeNodeId)!.label!;
    expect(text).toContain(label.replace('&', '&amp;'));
    expect(text).not.toMatch(/\bn-\d+-\d+\b/);
  });
  it('has both departures, two toggles, slider and durations', () => {
    expect(text).toContain('Evening departure (Day 1)');
    expect(text).toContain('Morning departure (Day 2)');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toMatch(/type="range"/);
    expect(text).toContain(`Max added minutes: ${emp.maxExtraMin}`);
    expect(text).toMatch(/Evening route: .*\d+ (min|h)/);
    expect(text).toMatch(/Morning route: .*\d+ (min|h)/);
    expect(d.trips).toHaveLength(2);
    expect(text).toContain('Adjust my route');
    expect(text).toContain('Save commute and find jobs');
    expect(text).not.toMatch(/NaN|undefined|\bnull\b/);
  });
});

describe('spec 3B model rules', () => {
  it('new commute defaults to 8 added minutes and morning is on Day 2', () => {
    expect(DEFAULT_MAX_EXTRA_MIN).toBe(8);
    expect(emptyForm('b').maxExtraMin).toBe(8);
    const req = toRequest({ ...emptyForm('b'), homeNodeId: 'x' });
    expect(req.eveningDepartureMin).toBeLessThan(1440);
    expect(req.morningDepartureMin).toBeGreaterThanOrEqual(1440);
  });
  it('refuses a 4th waypoint per direction with a message', () => {
    let f = emptyForm('b');
    for (const id of ['a', 'b', 'c']) f = addWaypoint(f, 'evening', id).form;
    const r = addWaypoint(f, 'evening', 'd');
    expect(r.error).toBe(WAYPOINT_LIMIT_MESSAGE);
    expect(r.form.eveningViaNodeIds).toEqual(['a', 'b', 'c']);
    expect(addWaypoint(f, 'morning', 'd').form.morningViaNodeIds).toEqual(['d']);
  });
  it('confirmation lists rematched packages by name', () => {
    expect(rematchedText([])).toBe('');
    const t = rematchedText(['s1', 's2'], { s1: 'Blue box', s2: 'Lab kit' });
    expect(t).toContain('Blue box, Lab kit');
    expect(rematchedText(['s9'])).not.toMatch(/s9|undefined/);
  });
  it('saved confirmation renders and uses API trips only', () => {
    const { text } = render(noJob.id, { trips: [], rematchedShipmentIds: ['s1'] });
    expect(text).toContain(SAVED_TEXT);
    expect(text).toContain('1 waiting package was matched');
    expect(text).toContain('Evening route: Not available');
  });
});
