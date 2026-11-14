import { describe, expect, it } from 'vitest';
import {
  addWaypoint, commuteSync, syncCommuteForm, toForm, toRequest, type CommuteForm, type CommuteSync,
} from '../../client/src/components/employee/commuteModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { employeeDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { EmployeeDashboard } from '../../shared/api';

const run = createInitialRun(loadDefaultScenario());
const snap = snapshotAt(run, 1050);
const [first, second] = run.scenario.employees;
const dash = employeeDashboard(run, snap, first.id)!;
const poll = (d: EmployeeDashboard): EmployeeDashboard => JSON.parse(JSON.stringify(d));

/** A node that is neither the current home nor a current evening waypoint. */
function otherNode(exclude: string[]): string {
  return run.scenario.graph.nodes.find((n) => n.label && !exclude.includes(n.id))!.id;
}

function editedForm(): { form: CommuteForm; sync: CommuteSync; home: string; via: string } {
  const e = dash.employee;
  const sync = commuteSync(e);
  const home = otherNode([e.homeNodeId]);
  const via = otherNode([home, e.homeNodeId, ...e.eveningViaNodeIds]);
  let form: CommuteForm = {
    ...toForm(e),
    eveningTime: '18:05',
    maxExtraMin: e.maxExtraMin === 3 ? 4 : 3,
    availableMorning: !e.availableMorning,
    homeNodeId: home,
  };
  form = addWaypoint({ ...form, eveningViaNodeIds: [] }, 'evening', via).form;
  return { form, sync, home, via };
}

describe('commute editor keeps unsaved edits across polls (#317)', () => {
  it('keeps every edit through 5 polls with equal values', () => {
    const { form: edited, sync: sync0, home, via } = editedForm();
    let form = edited;
    let sync = sync0;
    for (let i = 0; i < 5; i++) {
      const fresh = poll(dash);
      expect(fresh.employee).not.toBe(dash.employee);
      const next = syncCommuteForm(form, sync, fresh.employee);
      expect(next.form).toBe(form);
      expect(next.sync).toBe(sync);
      form = next.form;
      sync = next.sync;
    }
    const req = toRequest(form);
    expect(req.eveningDepartureMin).toBe(18 * 60 + 5);
    expect(req.maxExtraMin).toBe(edited.maxExtraMin);
    expect(req.availableMorning).toBe(!dash.employee.availableMorning);
    expect(req.homeNodeId).toBe(home);
    expect(req.eveningViaNodeIds).toEqual([via]);
  });

  it('resets to the new employee on an identity switch', () => {
    const { form, sync } = editedForm();
    const other = poll(employeeDashboard(run, snap, second.id)!).employee;
    const next = syncCommuteForm(form, sync, other);
    expect(next.form).toEqual(toForm(other));
    expect(next.sync.employeeId).toBe(second.id);
  });

  it('takes the server values when the saved commute changed (save, or another tab)', () => {
    const { form, sync } = editedForm();
    const fresh = poll(dash);
    fresh.employee.eveningDepartureMin = dash.employee.eveningDepartureMin + 10;
    fresh.employee.maxExtraMin = dash.employee.maxExtraMin === 20 ? 21 : 20;
    const next = syncCommuteForm(form, sync, fresh.employee);
    expect(next.form).toEqual(toForm(fresh.employee));
    expect(next.sync).not.toBe(sync);
    // The following poll with the same new values keeps the form as is.
    const after = { ...next.form, eveningTime: '19:00' };
    const again = syncCommuteForm(after, next.sync, poll(fresh).employee);
    expect(again.form).toBe(after);
  });
});
