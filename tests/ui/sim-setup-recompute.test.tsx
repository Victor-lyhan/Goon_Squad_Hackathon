import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SetupDrawer } from '../../client/src/components/sim/SetupDrawer';
import {
  LOCKED_RECOMPUTE_TEXT, hintEmployeeId, recomputeButtonState, recomputeToast,
} from '../../client/src/components/sim/setupModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import type { Run } from '../../shared/types';

const base = createInitialRun(loadDefaultScenario());
const planning = buildSimulatorResponse(base);
const lockedRun: Run = { ...base, clock: { ...base.clock, phase: 'locked' } };
const locked = buildSimulatorResponse(lockedRun);
const employees = base.scenario.employees;

const render = (sim: typeof planning) => renderToStaticMarkup(
  <MemoryRouter>
    <SetupDrawer open onClose={() => {}} onChanged={() => {}} phase={sim.clock.phase}
      hintEmployeeId={hintEmployeeId(sim.jobs, employees)} />
  </MemoryRouter>,
);

describe('setup drawer: recompute', () => {
  it('planning: enabled button, three-step hint, employee link', () => {
    const html = render(planning);
    expect(html).toContain('Recompute matches');
    expect(html).toContain('Show the detour tradeoff');
    expect(html).toContain('Start new planning cycle');
    expect(html).not.toContain(LOCKED_RECOMPUTE_TEXT);
    const id = hintEmployeeId(planning.jobs, employees)!;
    expect(html).toContain(`href="/employee/${id}"`);
    const btn = html.match(/<button[^>]*>(?:(?!<\/button>).)*Recompute matches/s)![0];
    expect(btn).not.toContain('disabled');
  });
  it('locked: disabled with the explanation', () => {
    const html = render(locked);
    expect(html).toContain(LOCKED_RECOMPUTE_TEXT);
    const btn = html.match(/<button[^>]*>(?:(?!<\/button>).)*Recompute matches/s)![0];
    expect(btn).toContain('disabled');
  });
});

describe('setupModel: recompute helpers', () => {
  it('button state', () => {
    expect(recomputeButtonState('planning', false)).toEqual({ disabled: false, loading: false, hint: null });
    expect(recomputeButtonState('planning', true).disabled).toBe(true);
    expect(recomputeButtonState('locked', false)).toEqual({ disabled: true, loading: false, hint: LOCKED_RECOMPUTE_TEXT });
    expect(recomputeButtonState(undefined, false).disabled).toBe(false);
  });
  it('toast counts come from the response', () => {
    expect(recomputeToast(planning)).toBe(`Matches recomputed: ${planning.plans.length} matched, ${planning.unmatched.length} unmatched.`);
    expect(recomputeToast({ plans: [], unmatched: [1, 2] })).toBe('Matches recomputed: 0 matched, 2 unmatched.');
  });
  it('hint employee falls back to the first employee', () => {
    expect(hintEmployeeId([], [{ id: 'e1' }])).toBe('e1');
    expect(hintEmployeeId(undefined, [])).toBeUndefined();
  });
});
