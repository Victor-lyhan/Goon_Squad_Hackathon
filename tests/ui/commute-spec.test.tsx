import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_EXTRA_MIN, WAYPOINT_LIMIT_MESSAGE, addWaypoint, emptyForm, rematchedText, toRequest,
} from '../../client/src/components/employee/commuteModel';

// The MVP 1 CommuteEditor render cases were deleted with the component (#566); the model rules stay.
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
});
