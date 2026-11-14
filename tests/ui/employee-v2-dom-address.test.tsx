// @vitest-environment jsdom
// The MVP II address search in a real DOM (#518): debounced typing on fake timers, abort of an older
// request, keyboard choice (combobox pattern), what a pick hands over (SPEC MVP II rule 6: neighborhood
// and point only) and the 503 state, with the commute form around it still saving the saved home.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommuteResponse } from '../../shared/v2/api';
import type { PutCommuteRequest } from '../../shared/v2/schemas';
import { AddressSearch } from '../../client/src/components/employee/v2/AddressSearch';
import {
  DEFAULT_DEBOUNCE_MS, SEARCHING_TEXT, UNAVAILABLE_TEXT, type HomeChoice, type SearchFn,
} from '../../client/src/components/employee/v2/addressSearchModel';
import { CommuteForm } from '../../client/src/components/employee/v2/CommuteForm';
import { businesses, dashboard } from './employee-v2-workspace-sample';
import {
  HAMILTON, HARLEM, INWOOD, T, advance, commuteAnswer, fakeSearch, geocode503, settle, useFakeTimers,
} from './employee-v2-dom-helpers';
import { byLabel, click, mount, press, textOf, typeInto } from './kitDom';

beforeEach(() => useFakeTimers());
afterEach(() => { vi.useRealTimers(); });

/** The search inside a parent that keeps the chosen home, like the commute form does. */
function Host({ search, onChoose }: { search: SearchFn; onChoose: (h: HomeChoice) => void }) {
  const [value, setValue] = useState<HomeChoice | null>(null);
  return <AddressSearch search={search} value={value} onChoose={(h) => { onChoose(h); setValue(h); }} />;
}

function setup() {
  const s = fakeSearch();
  const onChoose = vi.fn();
  const m = mount(<Host search={s.fn} onChoose={onChoose} />);
  const c = m.container;
  return {
    ...m, ...s, onChoose,
    input: () => byLabel(c, 'Home address') as HTMLInputElement,
    list: () => c.querySelector<HTMLUListElement>('[role="listbox"]')!,
    options: () => [...c.querySelectorAll<HTMLLIElement>('[role="option"]')],
    status: () => c.querySelector('[role="status"]')!,
  };
}

/** Types `query`, waits out the debounce and answers the search with `results`. */
async function searchFor(f: ReturnType<typeof setup>, query: string, results = [HARLEM, HAMILTON, INWOOD]) {
  typeInto(f.input(), query);
  await advance(DEFAULT_DEBOUNCE_MS);
  f.calls[f.calls.length - 1].resolve(results);
  await settle();
}

describe('AddressSearch in a real DOM: typing', () => {
  it('debounces typing into one call with the last query', async () => {
    const f = setup();
    typeInto(f.input(), '310');
    await advance(100);
    typeInto(f.input(), '310 W 14');
    await advance(100);
    typeInto(f.input(), '310 W 144th St');
    await advance(DEFAULT_DEBOUNCE_MS - 1);
    expect(f.fn).not.toHaveBeenCalled();
    await advance(1);
    expect(f.fn).toHaveBeenCalledTimes(1);
    expect(f.calls[0].query).toBe('310 W 144th St');
    expect(textOf(f.status())).toBe(SEARCHING_TEXT);
    await advance(5 * DEFAULT_DEBOUNCE_MS);
    expect(f.fn).toHaveBeenCalledTimes(1);
  }, T);

  it('a newer keystroke aborts the older request, and a late answer to it is ignored', async () => {
    const f = setup();
    typeInto(f.input(), '310 W 144th');
    await advance(DEFAULT_DEBOUNCE_MS);
    expect(f.calls).toHaveLength(1);
    const older = f.calls[0];
    expect(older.signal.aborted).toBe(false);

    typeInto(f.input(), '500 W 148th');
    expect(older.signal.aborted).toBe(true); // aborted at the keystroke, before the next debounce
    await advance(DEFAULT_DEBOUNCE_MS);
    expect(f.calls).toHaveLength(2);
    const newer = f.calls[1];
    expect(newer.query).toBe('500 W 148th');

    // The older request answers anyway (the fake ignores its signal): nothing of it shows.
    older.resolve([HARLEM]);
    await settle();
    expect(f.options()).toHaveLength(0);
    expect(textOf(f.status())).toBe(SEARCHING_TEXT);
    expect(f.input().value).toBe('500 W 148th');

    newer.resolve([HAMILTON]);
    await settle();
    expect(f.options().map((o) => o.querySelector('.addr-search__option-hood')!.textContent)).toEqual(['Hamilton Heights']);
    expect(newer.signal.aborted).toBe(false);
  }, T);
});

describe('AddressSearch in a real DOM: keyboard', () => {
  it('Arrow keys move the active option, Enter picks it', async () => {
    const f = setup();
    await searchFor(f, 'W 14');
    const input = f.input();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(f.list().hidden).toBe(false);
    expect(f.options()).toHaveLength(3);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);

    const active = () => document.getElementById(input.getAttribute('aria-activedescendant')!)!;
    press('ArrowDown', input);
    expect(active()).toBe(f.options()[0]);
    expect(f.options()[0].getAttribute('aria-selected')).toBe('true');
    press('ArrowDown', input);
    expect(active()).toBe(f.options()[1]);
    press('ArrowUp', input);
    expect(active()).toBe(f.options()[0]);
    press('ArrowUp', input); // wraps to the last
    expect(active()).toBe(f.options()[2]);
    press('ArrowDown', input); // and back to the first
    expect(active()).toBe(f.options()[0]);
    press('ArrowDown', input);
    expect(f.options().filter((o) => o.getAttribute('aria-selected') === 'true')).toEqual([f.options()[1]]);

    press('Enter', input);
    expect(f.onChoose).toHaveBeenCalledTimes(1);
    expect(f.onChoose.mock.calls[0][0]).toEqual({ neighborhood: HAMILTON.neighborhood, lat: HAMILTON.lat, lng: HAMILTON.lng });
  }, T);

  it('Esc closes the list and keeps focus in the input', async () => {
    const f = setup();
    await searchFor(f, 'W 14');
    const input = f.input();
    expect(document.activeElement).toBe(input);
    press('ArrowDown', input);
    press('Escape', input);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(f.list().hidden).toBe(true);
    expect(f.options()).toHaveLength(0);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('W 14'); // the typed text stays
    expect(f.onChoose).not.toHaveBeenCalled();
    // Enter with the list closed picks nothing.
    press('Enter', input);
    expect(f.onChoose).not.toHaveBeenCalled();
  }, T);
});

describe('AddressSearch in a real DOM: what a pick keeps', () => {
  it('hands over the neighborhood and coordinates only, and no street address stays on screen', async () => {
    const f = setup();
    await searchFor(f, '310 W 144th St');
    expect(textOf(f.container)).toContain(HARLEM.label); // visible while choosing

    click(f.options()[0]);
    expect(f.onChoose).toHaveBeenCalledTimes(1);
    const picked = f.onChoose.mock.calls[0][0] as HomeChoice;
    expect(Object.keys(picked).sort()).toEqual(['lat', 'lng', 'neighborhood']);
    expect(picked).toEqual({ neighborhood: 'Harlem', lat: HARLEM.lat, lng: HARLEM.lng });

    // The chosen view shows Change only (the form around it prints the home, #598); the street label and
    // the typed query are gone from the page.
    const page = document.body;
    expect(textOf(page)).toBe('Change');
    for (const street of [HARLEM.label, '310 W 144th St', HAMILTON.label, INWOOD.label]) {
      expect(page.innerHTML).not.toContain(street);
    }
    expect(page.querySelector('input')).toBeNull();

    // Change opens an empty search again, not the old address.
    click([...page.querySelectorAll('button')].find((b) => textOf(b) === 'Change')!);
    expect(f.input().value).toBe('');
  }, T);
});

describe('AddressSearch in a real DOM: 503', () => {
  function formSetup() {
    const s = fakeSearch();
    const save = vi.fn(async (req: PutCommuteRequest): Promise<CommuteResponse> => commuteAnswer(req));
    const m = mount(
      <CommuteForm
        employee={dashboard.employee} home={dashboard.home} businesses={businesses} phase="planning" onSave={save}
        homeControl={({ value, onChoose, disabled }) => (
          <AddressSearch
            search={s.fn} disabled={disabled} onChoose={onChoose}
            value={value.kind === 'new' ? value : { neighborhood: value.neighborhood, lat: dashboard.home.lat, lng: dashboard.home.lng }}
          />
        )}
      />,
    );
    const c = m.container;
    const changeBtn = () => [...c.querySelectorAll('button')].find((b) => textOf(b) === 'Change')!;
    return { ...m, ...s, save, c, changeBtn, input: () => byLabel(c, 'Home address') as HTMLInputElement };
  }

  it('shows the "address search is not available" message; the saved home still saves and a later search still picks', async () => {
    const f = formSetup();
    click(f.changeBtn());
    typeInto(f.input(), '310 W 144th St');
    await advance(DEFAULT_DEBOUNCE_MS);
    f.calls[0].reject(geocode503());
    await settle();

    const status = f.c.querySelector('.addr-search__status')!;
    expect(textOf(status)).toBe(UNAVAILABLE_TEXT);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(f.input().getAttribute('aria-describedby')).toBe(status.id);
    expect(f.input().getAttribute('aria-expanded')).toBe('false');
    expect(f.input().disabled || f.input().readOnly).toBe(false);

    // The rest of the form works with the saved home: change the detour and save.
    typeInto(byLabel(f.c, 'Maximum detour (minutes)'), '20');
    click(f.c.querySelector('button[type="submit"]')!);
    await settle();
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save.mock.calls[0][0].home).toEqual({ homeId: dashboard.home.id });
    expect(f.save.mock.calls[0][0].maxExtraMin).toBe(20);

    // And once the search answers again, a new home can still be picked by keyboard (the search is still open).
    expect(f.changeBtn()).toBeUndefined();
    typeInto(f.input(), '500 W 148th');
    await advance(DEFAULT_DEBOUNCE_MS);
    expect(f.calls).toHaveLength(2);
    f.calls[1].resolve([HAMILTON]);
    await settle();
    press('ArrowDown', f.input());
    press('Enter', f.input());
    expect(textOf(f.c)).toContain('Home: Hamilton Heights');
    expect(f.c.innerHTML).not.toContain(HAMILTON.label);
  }, T);
});
