// @vitest-environment jsdom
// The MVP II commute form in a real DOM (#518): type and save, the pending, saved and error states,
// two fast clicks, invalid values, and a 1 s poll that must keep the typed draft (DECISIONS pass 43).
// The form computes nothing the server decides: the tests assert only what the fake answers contain.
import { describe, expect, it, vi } from 'vitest';
import type { CommuteResponse } from '../../shared/v2/api';
import type { PutCommuteRequest } from '../../shared/v2/schemas';
import { CommuteForm, type HomeControlArgs } from '../../client/src/components/employee/v2/CommuteForm';
import {
  LOCKED_MESSAGE, eveningFromTimeInput, morningFromTimeInput, parseMinutes, savedMessage, toRequest, type Draft,
} from '../../client/src/components/employee/v2/commuteFormModel';
import { businesses, dashboard } from './employee-v2-workspace-sample';
import { HARLEM, T, commuteAnswer } from './employee-v2-dom-helpers';
import { button, byLabel, click, deferred, flush, mount, select, textOf, typeInto } from './kitDom';

const { employee, home } = dashboard;

/** A stand-in for the address search: one button that hands over a picked home (neighborhood and point). */
const pickHarlem = ({ value, onChoose, disabled }: HomeControlArgs) => (
  <button
    type="button" disabled={disabled}
    onClick={() => onChoose({ neighborhood: HARLEM.neighborhood, lat: HARLEM.lat, lng: HARLEM.lng })}
  >
    Pick Harlem ({value.neighborhood})
  </button>
);

function setup(onSave: (req: PutCommuteRequest) => Promise<CommuteResponse>, phase: 'planning' | 'locked' = 'planning') {
  const save = vi.fn(onSave);
  const el = (e = employee, h = home) => (
    <CommuteForm employee={e} home={h} businesses={businesses} phase={phase} homeControl={pickHarlem} onSave={save} />
  );
  const m = mount(el());
  const form = () => m.container.querySelector('form')!;
  const field = (label: string) => byLabel(form(), label) as HTMLInputElement;
  return {
    ...m, save, form,
    poll: () => m.rerender(el({ ...employee }, { ...home })),
    workplace: () => field('Workplace') as unknown as HTMLSelectElement,
    evening: () => field('Evening departure (Day 1, work to home)'),
    morning: () => field('Morning departure (Day 2, home to work)'),
    detour: () => field('Maximum detour (minutes)'),
    saveButton: () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!,
    message: () => form().querySelector('.cf-message')!,
  };
}

/** Changes every field the issue names: workplace, home neighborhood, both departure times and the detour. */
function typeCommute(f: ReturnType<typeof setup>) {
  select(f.workplace(), 'Cafe Luna · Astoria');
  click(button(f.form(), /^Pick Harlem/));
  typeInto(f.evening(), '18:15');
  typeInto(f.morning(), '07:45');
  typeInto(f.detour(), '20');
}

/** The request commuteFormModel.ts builds from exactly those typed values. */
function expectedRequest(): PutCommuteRequest {
  const draft: Draft = {
    businessId: 'biz-luna',
    home: { kind: 'new', neighborhood: HARLEM.neighborhood, lat: HARLEM.lat, lng: HARLEM.lng },
    eveningDepartureMin: eveningFromTimeInput('18:15'),
    morningDepartureMin: morningFromTimeInput('07:45'),
    availableEvening: employee.availableEvening,
    availableMorning: employee.availableMorning,
    maxExtraMin: parseMinutes('20'),
  };
  const r = toRequest(draft);
  if (!r.ok) throw new Error('sample draft is invalid');
  return r.request;
}

describe('CommuteForm in a real DOM: save', () => {
  it('sends one request equal to what commuteFormModel builds; pending disables Save and says so; success shows saved', async () => {
    const pending = deferred<CommuteResponse>();
    const f = setup(() => pending.promise);
    expect(f.saveButton().disabled).toBe(true); // nothing changed yet

    typeCommute(f);
    expect(textOf(f.form())).toContain('Home: Harlem');
    expect(f.saveButton().disabled).toBe(false);
    click(f.saveButton());

    expect(f.save).toHaveBeenCalledTimes(1);
    const req = f.save.mock.calls[0][0];
    expect(req).toEqual(expectedRequest());
    expect(req.home).toEqual({ neighborhood: 'Harlem', lat: HARLEM.lat, lng: HARLEM.lng }); // no street address

    // Pending: the button is disabled and its text says so; the live region says it too.
    expect(f.saveButton().disabled).toBe(true);
    expect(textOf(f.saveButton())).toBe('Saving…');
    expect(textOf(f.message())).toBe('Saving commute…');
    expect(f.message().getAttribute('aria-live')).toBe('polite');

    const res = commuteAnswer(req, dashboard, ['shp-020', 'shp-021']);
    pending.resolve(res);
    await flush();
    expect(textOf(f.saveButton())).toBe('Save commute');
    expect(f.message().getAttribute('role')).toBe('status');
    expect(textOf(f.message())).toBe(savedMessage(res.rematchedShipmentIds.length));
    // The form now shows the server's saved values and has nothing left to save.
    expect(f.workplace().value).toBe(res.employee.businessId);
    expect(f.detour().value).toBe(String(res.employee.maxExtraMin));
    expect(textOf(f.form())).toContain(`Home: ${res.home.neighborhood}`);
    expect(f.saveButton().disabled).toBe(true);
  }, T);

  it('a rejected save shows the error in a live region and keeps the draft', async () => {
    const f = setup(async () => { throw new Error('The server could not save the commute.'); });
    typeCommute(f);
    click(f.saveButton());
    await flush();

    expect(f.save).toHaveBeenCalledTimes(1);
    const msg = f.message();
    expect(msg.getAttribute('role')).toBe('alert');
    expect(msg.getAttribute('aria-live')).toBe('assertive');
    expect(textOf(msg)).toBe('The server could not save the commute.');
    // Every typed value is still there, and Save is enabled again for a retry.
    expect(f.workplace().value).toBe('biz-luna');
    expect(f.evening().value).toBe('18:15');
    expect(f.morning().value).toBe('07:45');
    expect(f.detour().value).toBe('20');
    expect(textOf(f.form())).toContain('Home: Harlem');
    expect(f.saveButton().disabled).toBe(false);
  }, T);

  it('two fast clicks on Save send one request', async () => {
    const pending = deferred<CommuteResponse>();
    const f = setup(() => pending.promise);
    typeInto(f.detour(), '20');
    const btn = f.saveButton();
    click(btn);
    click(btn);
    expect(f.save).toHaveBeenCalledTimes(1);
    pending.resolve(commuteAnswer(f.save.mock.calls[0][0]));
    await flush();
    expect(f.save).toHaveBeenCalledTimes(1);
  }, T);

  it('a locked run sends nothing and says why', () => {
    const f = setup(async () => { throw new Error('not called'); }, 'locked');
    expect(f.detour().disabled).toBe(true);
    expect(f.saveButton().disabled).toBe(true);
    f.form().requestSubmit();
    expect(f.save).not.toHaveBeenCalled();
    expect(textOf(f.message())).toBe(LOCKED_MESSAGE);
  }, T);
});

describe('CommuteForm in a real DOM: invalid values', () => {
  it('an invalid value sends nothing and sets aria-invalid with its message', () => {
    const f = setup(async () => { throw new Error('not called'); });
    typeInto(f.evening(), '');
    typeInto(f.detour(), '45');

    for (const input of [f.evening(), f.detour()]) {
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const err = document.getElementById(input.getAttribute('aria-describedby')!);
      expect(err?.textContent).toBeTruthy();
    }
    expect(f.morning().hasAttribute('aria-invalid')).toBe(false);
    expect(f.saveButton().disabled).toBe(false); // pressable: pressing it moves focus instead (#550)

    click(f.saveButton());
    f.form().requestSubmit(); // what Enter in a field would do
    expect(f.save).not.toHaveBeenCalled();
  }, T);

  // Fixed in #550 (found by #518): Save used to be disabled, so nothing moved focus to the wrong field.
  it('trying to save with invalid values moves focus to the first invalid field', () => {
    const f = setup(async () => { throw new Error('not called'); });
    typeInto(f.evening(), '');
    typeInto(f.detour(), '45');
    click(f.saveButton());
    f.form().requestSubmit();
    expect(f.save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(f.evening());
  }, T);
});

describe('CommuteForm in a real DOM: a poll while typing', () => {
  it('a re-render with equal props in new objects keeps the typed draft', () => {
    const f = setup(async () => { throw new Error('not called'); });
    typeCommute(f);
    f.poll();
    f.poll();
    expect(f.workplace().value).toBe('biz-luna');
    expect(f.evening().value).toBe('18:15');
    expect(f.morning().value).toBe('07:45');
    expect(f.detour().value).toBe('20');
    expect(textOf(f.form())).toContain('Home: Harlem');
    // Typing continues normally after the poll.
    typeInto(f.detour(), '21');
    f.poll();
    expect(f.detour().value).toBe('21');
    expect(document.activeElement).toBe(f.detour());
  }, T);
});
