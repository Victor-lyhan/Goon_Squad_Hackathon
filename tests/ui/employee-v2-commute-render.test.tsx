import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CommuteResponse } from '../../shared/v2/api';
import type { Employee, Home, NetworkBusiness } from '../../shared/v2/types';
import { CommuteForm, type CommuteFormProps } from '../../client/src/components/employee/v2/CommuteForm';
import { draftFromSaved, type Draft, type SaveState } from '../../client/src/components/employee/v2/commuteFormModel';

const employee: Employee = {
  id: 'emp-001', name: 'Ana', businessId: 'biz-a', homeId: 'home-007',
  eveningDepartureMin: 1050, morningDepartureMin: 1950, maxExtraMin: 8,
  availableEvening: true, availableMorning: false,
};
const home: Home = { id: 'home-007', neighborhood: 'Astoria', lat: 40.76421, lng: -73.92353 };
const businesses: NetworkBusiness[] = [
  { id: 'biz-a', name: 'Atlas Coffee', address: '1 Main St', neighborhood: 'SoHo', borough: 'Manhattan', kind: 'cafe', lat: 40.7233, lng: -74.003 },
  { id: 'biz-b', name: 'Bento Office', address: '2 Main St', neighborhood: 'DUMBO', borough: 'Brooklyn', kind: 'office', lat: 40.7033, lng: -73.9881 },
];
const onSave = async (): Promise<CommuteResponse> => ({ employee, home, trips: [], rematchedShipmentIds: [] });
const clean = draftFromSaved(employee, home);

const render = (p: Partial<CommuteFormProps> = {}) =>
  renderToStaticMarkup(<CommuteForm employee={employee} home={home} businesses={businesses} phase="planning" onSave={onSave} {...p} />);
const withDraft = (d: Partial<Draft>, s?: SaveState) => render({ initialDraft: { ...clean, ...d }, initialSaveState: s });

const tags = (h: string, t: string) => h.match(new RegExp(`<${t}\\b[^>]*>`, 'g')) ?? [];
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const button = (h: string, text: string) => {
  const m = h.match(new RegExp(`<button\\b[^>]*>${text}</button>`));
  if (!m) throw new Error(`no button ${text}`);
  return m[0];
};
const saveBtn = (h: string) => button(h, '(?:Save commute|Saving…)');
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);

function expectClean(h: string) {
  expect(h).not.toMatch(/NaN|undefined/);
  expect(h).not.toContain('40.76');
  expect(h).not.toContain('73.92');
  expect(h).not.toContain('40.67');
  expect(h).not.toMatch(/home-\d|home-c-|ChIJ|place_id/);
  expect(h).not.toContain('1 Main St');
}

function expectLabelled(h: string) {
  const labelFor = new Set(tags(h, 'label').map((l) => attr(l, 'for')).filter(Boolean));
  for (const t of [...tags(h, 'input'), ...tags(h, 'select')]) {
    const id = attr(t, 'id');
    expect(Boolean(attr(t, 'aria-label')) || (id !== undefined && labelFor.has(id)), t).toBe(true);
  }
}

const states: Record<string, string> = {
  clean: render(),
  dirty: withDraft({ maxExtraMin: 12 }),
  invalid: withDraft({ maxExtraMin: 31 }),
  saving: withDraft({ maxExtraMin: 12 }, { status: 'saving' }),
  savedNone: render({ initialSaveState: { status: 'saved', matched: 0 } }),
  savedSome: render({ initialSaveState: { status: 'saved', matched: 3 } }),
  locked: render({ phase: 'locked' }),
  locked409: withDraft({ maxExtraMin: 12 }, { status: 'locked' }),
  keyMissing: withDraft({ home: { kind: 'new', neighborhood: 'Park Slope', lat: 40.6721, lng: -73.9772 } }, { status: 'unavailable', code: 'google_key_missing' }),
  travelMissing: withDraft({ maxExtraMin: 12 }, { status: 'unavailable', code: 'travel_data_missing' }),
  googleDown: withDraft({ maxExtraMin: 12 }, { status: 'unavailable', code: 'google_unavailable' }),
  error: withDraft({ maxExtraMin: 12 }, { status: 'error', message: 'Unknown business', fieldErrors: { businessId: 'Unknown business' } }),
};

describe('CommuteForm static renders', () => {
  it.each(Object.entries(states))('%s: labelled, no leaks', (_, h) => {
    expectLabelled(h);
    expectClean(h);
    expect(h).toMatch(/role="(status|alert)"/);
  });

  it('shows the workplace select and home by neighborhood', () => {
    const h = states.clean;
    expect(h).toContain('Atlas Coffee · SoHo');
    expect(h).toContain('Bento Office · DUMBO');
    expect(h).toMatch(/Home: <span[^>]*>Astoria<\/span>/);
    expect(h).toContain('value="17:30"');
    expect(h).toContain('value="08:30"');
    expect(h).toContain('type="range"');
    expect(h).toContain('max="30"');
    expect(h).toContain('Maximum detour');
  });

  it('disables Save when clean or saving; enables it when dirty, even if invalid (#550)', () => {
    expect(isDisabled(saveBtn(states.clean))).toBe(true);
    expect(isDisabled(button(states.clean, 'Discard changes'))).toBe(true);
    expect(isDisabled(saveBtn(states.dirty))).toBe(false);
    expect(isDisabled(button(states.dirty, 'Discard changes'))).toBe(false);
    expect(isDisabled(saveBtn(states.invalid))).toBe(false);
    expect(isDisabled(saveBtn(states.saving))).toBe(true);
    expect(states.saving).toContain('Saving…');
  });

  it('shows the field error inline next to the field', () => {
    const h = states.invalid;
    const input = tags(h, 'input').find((t) => attr(t, 'type') === 'number')!;
    expect(attr(input, 'aria-invalid')).toBe('true');
    const errId = attr(input, 'aria-describedby')!;
    expect(h).toMatch(new RegExp(`<p class="cf-error" id="${errId.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')}">Maximum detour must be`));
  });

  it('words the saved state with and without rematches', () => {
    expect(states.savedNone).toMatch(/role="status"[^>]*>Commute saved\.</);
    expect(states.savedSome).toContain('Commute saved. 3 waiting packages matched.');
  });

  it('is read-only with the lock wording when locked', () => {
    for (const h of [states.locked, states.locked409]) {
      expect(h).toMatch(/role="alert"[^>]*>The run is playing[^<]*new planning cycle/);
      expect(isDisabled(saveBtn(h))).toBe(true);
      for (const t of [...tags(h, 'select'), ...tags(h, 'input').filter((x) => attr(x, 'type') !== 'checkbox')]) {
        expect(isDisabled(t), t).toBe(true);
      }
      expect(isDisabled(tags(h, 'fieldset')[0] ?? '')).toBe(true);
    }
  });

  it('words each 503 code', () => {
    expect(states.keyMissing).toContain('Travel times for a new address need the Google key on the server. Your saved commute is unchanged.');
    expect(states.keyMissing).toContain('Park Slope');
    for (const h of [states.travelMissing, states.googleDown]) {
      expect(h).toMatch(/role="alert"[^>]*>Travel times for this address could not be loaded\. Your saved commute is unchanged\. Try again\./);
    }
  });

  it('shows other errors with the server message and field errors', () => {
    expect(states.error).toMatch(/role="alert"[^>]*>Unknown business</);
    expect(states.error).toMatch(/class="cf-error"[^>]*>Unknown business</);
  });

  it('renders the home slot with value and disabled flag, read-only without it', () => {
    expect(states.clean).not.toContain('data-testid="home-slot"');
    const seen: { neighborhood: string; disabled: boolean }[] = [];
    const h = render({
      homeControl: ({ value, disabled }) => {
        seen.push({ neighborhood: value.neighborhood, disabled });
        return <button type="button" data-testid="home-slot">Change home</button>;
      },
    });
    expect(h).toContain('data-testid="home-slot"');
    expect(seen[0]).toEqual({ neighborhood: 'Astoria', disabled: false });
    render({ phase: 'locked', homeControl: ({ disabled }) => { seen.push({ neighborhood: '', disabled }); return null; } });
    expect(seen[seen.length - 1].disabled).toBe(true);
  });
});

describe('CommuteForm.css', () => {
  const css = readFileSync('client/src/components/employee/v2/CommuteForm.css', 'utf8');

  it('has a 390 px rule and focus-visible styles', () => {
    expect(css).toMatch(/@media \(max-width: 390px\)/);
    expect(css).toContain(':focus-visible');
    expect(css).toMatch(/min-height: 40px/);
  });

  it('keeps radii at most 4px and only a 1px focus ring shadow', () => {
    for (const m of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      const px = [...m[1].matchAll(/(\d+(?:\.\d+)?)px/g)].map((x) => Number(x[1]));
      for (const v of px) expect(v).toBeLessThanOrEqual(4);
    }
    const shadows = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
    for (const s of shadows) expect(s === 'none' || /^0 0 0 1px /.test(s), s).toBe(true);
  });
});
