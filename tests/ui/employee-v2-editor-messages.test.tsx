// @vitest-environment jsdom
// The commute editor's messages in a real DOM (#598, DECISIONS pass 61), on the real Employee page so the
// page's own wiring of the address search is part of the test:
//   1. address search failures: the key sentence only for `google_key_missing`; anything else is one plain
//      sentence with Retry, never the raw message;
//   2. the home is printed once;
//   3. a locked run gives one sentence, in the form, in MVP II words;
//   4. while a save is pending the home control cannot be used, and it works again when the save settles.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act, useReducer, type Dispatch } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommuteResponse, EmployeeDashboard } from '../../shared/v2/api';
import type { PutCommuteRequest } from '../../shared/v2/schemas';
import { ApiRequestError } from '../../client/src/api/http';
import {
  DEFAULT_DEBOUNCE_MS, NOT_ANSWERING_TEXT, UNAVAILABLE_TEXT,
} from '../../client/src/components/employee/v2/addressSearchModel';
import { LOCKED_MESSAGE } from '../../client/src/components/employee/v2/commuteFormModel';
import {
  employeeWorkspaceReducer, initialWorkspaceState, type EmployeeWorkspaceState, type WorkspaceAction,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { EmployeePageView } from '../../client/src/components/employee/v2/page/EmployeePageView';
import { businesses, dashboard, lockedDashboard } from './employee-v2-workspace-sample';
import {
  HAMILTON, HARLEM, T, advance, commuteAnswer, fakeSearch, settle, useFakeTimers,
} from './employee-v2-dom-helpers';
import { button, buttons, byLabel, click, deferred, mount, press, textOf, typeInto } from './kitDom';

beforeEach(() => useFakeTimers());
afterEach(() => { vi.useRealTimers(); });

const HOME = dashboard.home.neighborhood; // "Astoria"
/** The run starts playing while the editor is open: the next poll brings the locked phase. */
const nowLocked: EmployeeDashboard = { ...lockedDashboard, version: dashboard.version + 1 };
const QUERY = '310 W 144th St';

function ready(d: EmployeeDashboard = dashboard): EmployeeWorkspaceState {
  const s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboard', dashboard: d, runId: 'run-1' });
  return employeeWorkspaceReducer(s, { type: 'businesses', businesses });
}

type Api = {
  dispatch: Dispatch<WorkspaceAction>;
  saveCommute: (req: PutCommuteRequest) => Promise<CommuteResponse>;
};

/** The page with the real reducer; `api.dispatch` stands in for the poller. */
function Harness({ api, search }: { api: Api; search: ReturnType<typeof fakeSearch>['fn'] }) {
  const [state, dispatch] = useReducer(employeeWorkspaceReducer, ready());
  api.dispatch = dispatch;
  return (
    <EmployeePageView
      state={state} jobId={null} saveCommute={(r) => api.saveCommute(r)} refetchNow={async () => {}}
      markSeen={() => {}} onCloseJob={() => {}} search={search}
      employeeHref={(id) => `/employee/${id}`}
    />
  );
}

/** The page with the commute editor already open. */
function openEditor() {
  const s = fakeSearch();
  const api: Api = {
    dispatch: () => { throw new Error('not mounted'); },
    saveCommute: vi.fn(async (_req: PutCommuteRequest): Promise<CommuteResponse> => { throw new Error('not set'); }),
  };
  const m = mount(<Harness api={api} search={s.fn} />);
  const c = m.container;
  click(button(c, 'Edit commute'));
  const editor = () => c.querySelector<HTMLElement>('.ep-editor')!;
  const form = () => c.querySelector<HTMLFormElement>('form[aria-label="Commute"]')!;
  return {
    ...m, ...s, api, c, editor, form,
    poll: (d: EmployeeDashboard) => act(() => { api.dispatch({ type: 'dashboard', dashboard: d, runId: 'run-1' }); }),
    search: () => form().querySelector<HTMLElement>('.addr-search')!,
    input: () => byLabel(form(), 'Home address') as HTMLInputElement,
    options: () => [...form().querySelectorAll<HTMLLIElement>('[role="option"]')],
    status: () => form().querySelector<HTMLElement>('.addr-search__status')!,
    message: () => form().querySelector<HTMLElement>('.cf-message')!,
    detour: () => byLabel(form(), 'Maximum detour (minutes)') as HTMLInputElement,
    saveButton: () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!,
    homeLabel: () => textOf(form().querySelector('.cf-home .cf-label')!),
  };
}
type Editor = ReturnType<typeof openEditor>;

/** Presses Change, types `query` and waits out the debounce; the search is then pending in `f.calls`. */
async function startSearch(f: Editor, query = QUERY) {
  if (buttons(f.form(), 'Change').length > 0) click(button(f.form(), 'Change'));
  typeInto(f.input(), query);
  await advance(DEFAULT_DEBOUNCE_MS);
}

async function failSearch(f: Editor, error: unknown) {
  await startSearch(f);
  f.calls[f.calls.length - 1].reject(error);
  await settle();
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

/** What the acceptance criteria forbid in any visible text: "ms", a status number, an error class name. */
function expectNoRawError(text: string) {
  expect(text).not.toMatch(/\bms\b/);
  expect(text).not.toMatch(/\b[1-5]\d\d\b|\b8000\b/);
  expect(text).not.toMatch(/Error\b|timed out|Failed to fetch|Request failed/);
}

describe('commute editor messages: address search failures (#598)', () => {
  const others: [string, () => unknown][] = [
    ['google_unavailable (key set, Google slow)',
      () => new ApiRequestError(503, 'Google did not answer in time.', undefined, undefined, 'google_unavailable')],
    ['a browser timeout', () => new ApiRequestError(0, 'Request timed out after 8000 ms', undefined, 'timeout')],
    ['a network failure', () => new ApiRequestError(0, 'Failed to fetch', undefined, 'network')],
    ['a 500 with no JSON body', () => new ApiRequestError(500, 'Request failed (500)')],
    ['an error that is not from the API client', () => new TypeError('fetch failed')],
  ];

  for (const [name, make] of others) {
    it(`${name}: one plain sentence with Retry, and Retry searches again`, async () => {
      const f = openEditor();
      await failSearch(f, make());

      expect(textOf(f.status().firstChild as Element)).toBe(NOT_ANSWERING_TEXT);
      expect(textOf(f.status())).toBe(`${NOT_ANSWERING_TEXT}Retry`); // the sentence and the button, nothing else
      expect(NOT_ANSWERING_TEXT).toBe('Address search is not answering. Try again.');
      expect(f.status().getAttribute('role')).toBe('status');
      expectNoRawError(textOf(f.editor()));
      expect(textOf(f.editor())).not.toContain('Google key');

      // Retry sends the same query again; the answer can be picked.
      click(button(f.status(), 'Retry'));
      await advance(DEFAULT_DEBOUNCE_MS);
      expect(f.calls).toHaveLength(2);
      expect(f.calls[1].query).toBe(QUERY);
      f.calls[1].resolve([HARLEM]);
      await settle();
      expect(buttons(f.form(), 'Retry')).toHaveLength(0);
      click(f.options()[0]);
      expect(f.homeLabel()).toBe('Home: Harlem');
    }, T);
  }

  it('google_key_missing: the key sentence, no Retry', async () => {
    const f = openEditor();
    await failSearch(f, new ApiRequestError(503, 'GOOGLE_MAPS_SERVER_KEY is not set.', undefined, undefined, 'google_key_missing'));
    expect(textOf(f.status())).toBe(UNAVAILABLE_TEXT);
    expect(UNAVAILABLE_TEXT).toContain('needs the Google key on the server');
    expect(buttons(f.form(), 'Retry')).toHaveLength(0);
    expectNoRawError(textOf(f.editor()));
  }, T);

  it('a 503 with no code keeps the key sentence (as before)', async () => {
    const f = openEditor();
    await failSearch(f, new ApiRequestError(503, 'Request failed (503)'));
    expect(textOf(f.status())).toBe(UNAVAILABLE_TEXT);
    expect(buttons(f.form(), 'Retry')).toHaveLength(0);
    expectNoRawError(textOf(f.editor()));
  }, T);
});

describe('commute editor messages: the home is shown once (#598)', () => {
  it('"Home:" appears once with the editor open, while searching and after a pick; Change keeps its name', async () => {
    const f = openEditor();
    expect(count(textOf(f.editor()), 'Home:')).toBe(1);
    expect(count(textOf(f.form().querySelector('.cf-home')!), HOME)).toBe(1);
    expect(f.homeLabel()).toBe(`Home: ${HOME}`);

    // The control is named by its text and sits in the group the home labels.
    const change = button(f.form(), 'Change');
    expect(change.getAttribute('aria-label')).toBeNull();
    expect(change.disabled).toBe(false);
    const group = change.closest('[role="group"]')!;
    expect(textOf(document.getElementById(group.getAttribute('aria-labelledby')!)!)).toBe(`Home: ${HOME}`);
    expect(textOf(f.search())).toBe('Change');

    // Searching: the saved home is still named once, above the search.
    await startSearch(f);
    f.calls[0].resolve([HARLEM, HAMILTON]);
    await settle();
    expect(count(textOf(f.editor()), 'Home:')).toBe(1);
    expect(f.homeLabel()).toBe(`Home: ${HOME}`);

    // After a pick by keyboard: the new home once, and Change again.
    press('ArrowDown', f.input());
    press('Enter', f.input());
    expect(f.homeLabel()).toBe('Home: Harlem');
    expect(count(textOf(f.editor()), 'Home:')).toBe(1);
    expect(count(textOf(f.editor()), 'Harlem')).toBe(1);
    expect(textOf(f.search())).toBe('Change');
    expect(f.editor().innerHTML).not.toContain(HARLEM.label); // never the street address
  }, T);
});

describe('commute editor messages: a locked run (#598)', () => {
  it('the address search prints no sentence; the form prints one that names "Start new planning cycle"', () => {
    const f = openEditor();
    f.poll(nowLocked);

    expect(textOf(f.search())).toBe('Change');
    expect(button(f.form(), 'Change').disabled).toBe(true);
    expect(f.form().querySelector('.addr-search__locked')).toBeNull();

    expect(textOf(f.message())).toBe(LOCKED_MESSAGE);
    expect(f.message().getAttribute('role')).toBe('alert');
    expect(LOCKED_MESSAGE).toContain('"Start new planning cycle" in the simulator');
    const formText = textOf(f.form());
    expect(count(formText, 'planning cycle')).toBe(1);
    expect(count(formText, 'read-only')).toBe(1);
    expect(textOf(f.c)).not.toContain('Setup drawer');
    expect(textOf(f.c)).not.toContain('Planning is locked');
  }, T);

  it('a search that was open when the run locked closes without a sentence of its own', async () => {
    const f = openEditor();
    await startSearch(f);
    f.calls[0].resolve([HARLEM]);
    await settle();
    expect(f.options()).toHaveLength(1);

    f.poll(nowLocked);
    expect(f.options()).toHaveLength(0);
    expect(textOf(f.search())).toBe('Change');
    expect(textOf(f.message())).toBe(LOCKED_MESSAGE);
    expect(f.homeLabel()).toBe(`Home: ${HOME}`);
  }, T);

  it('"Setup drawer" appears nowhere in employee/v2/', () => {
    const root = join(process.cwd(), 'client/src/components/employee/v2');
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => /\.(tsx?|css)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/Setup\s+drawer/i);
    }
  });
});

describe('commute editor messages: nothing in the home control works during a save (#598)', () => {
  /** Opens the search with one result, changes the detour and presses Save; the save stays pending. */
  async function saveWithOpenSearch() {
    const f = openEditor();
    const pending = deferred<CommuteResponse>();
    f.api.saveCommute = vi.fn(() => pending.promise);
    await startSearch(f);
    f.calls[0].resolve([HARLEM, HAMILTON]);
    await settle();
    typeInto(f.detour(), '20');
    click(f.saveButton());
    expect(f.api.saveCommute).toHaveBeenCalledTimes(1);
    return { f, pending, req: vi.mocked(f.api.saveCommute).mock.calls[0][0] };
  }

  it('the input, Cancel and the result list are off while pending, with no locked text; they work again after a failure', async () => {
    const { f, pending, req } = await saveWithOpenSearch();
    expect(req.home).toEqual({ homeId: dashboard.home.id });

    // Pending: the browser disables every control of the home group through its fieldset.
    const group = f.form().querySelector<HTMLFieldSetElement>('fieldset.cf-home')!;
    expect(group.disabled).toBe(true);
    expect(f.input().matches(':disabled')).toBe(true);
    expect(button(f.search(), 'Cancel').matches(':disabled')).toBe(true);
    expect(f.input().readOnly).toBe(false); // off, but not in the locked (read-only) look
    expect(textOf(f.editor())).not.toContain(LOCKED_MESSAGE);
    expect(textOf(f.editor())).not.toContain('planning cycle');

    // The result list stays as it was, but a click on an option picks nothing and changes nothing.
    expect(f.options()).toHaveLength(2);
    click(f.options()[0]);
    click(button(f.search(), 'Cancel'));
    expect(f.options()).toHaveLength(2);
    expect(f.input().value).toBe(QUERY);
    expect(f.homeLabel()).toBe(`Home: ${HOME}`);
    expect(f.api.saveCommute).toHaveBeenCalledTimes(1);

    // The save fails: everything works again, and the same option can now be picked.
    pending.reject(new ApiRequestError(503, 'Google did not answer in time.', undefined, undefined, 'google_unavailable'));
    await settle();
    expect(group.disabled).toBe(false);
    expect(f.input().matches(':disabled')).toBe(false);
    expect(f.options()).toHaveLength(2);
    typeInto(f.input(), `${QUERY} `); // typing works again (a new search starts)
    await advance(DEFAULT_DEBOUNCE_MS);
    expect(f.calls).toHaveLength(2);
    f.calls[1].resolve([HARLEM]);
    await settle();
    click(f.options()[0]);
    expect(f.homeLabel()).toBe('Home: Harlem');

    // And the new home is what the next save sends.
    f.api.saveCommute = vi.fn(async (r: PutCommuteRequest) => commuteAnswer(r));
    click(f.saveButton());
    expect(vi.mocked(f.api.saveCommute).mock.calls[0][0].home)
      .toEqual({ neighborhood: 'Harlem', lat: HARLEM.lat, lng: HARLEM.lng });
    await settle();
  }, T);

  it('Change is off while pending and opens the search again after a failure', async () => {
    const f = openEditor();
    const pending = deferred<CommuteResponse>();
    f.api.saveCommute = vi.fn(() => pending.promise);
    typeInto(f.detour(), '20');
    click(f.saveButton());

    const change = button(f.form(), 'Change');
    expect(change.matches(':disabled')).toBe(true);
    click(change);
    expect(f.form().querySelector('[role="combobox"]')).toBeNull();
    expect(textOf(f.search())).toBe('Change'); // no locked sentence, no other text
    expect(textOf(f.editor())).not.toContain('planning cycle');

    pending.reject(new ApiRequestError(0, 'Failed to fetch', undefined, 'network'));
    await settle();
    expect(button(f.form(), 'Change').matches(':disabled')).toBe(false);
    click(button(f.form(), 'Change'));
    expect(f.input().matches(':disabled')).toBe(false);
    expect(f.detour().value).toBe('20'); // the draft is kept
  }, T);

  it('a search answer that arrives during the save is shown but cannot be picked until the save settles', async () => {
    const f = openEditor();
    const pending = deferred<CommuteResponse>();
    f.api.saveCommute = vi.fn(() => pending.promise);
    await startSearch(f); // the search is still pending
    typeInto(f.detour(), '20');
    click(f.saveButton());

    f.calls[0].resolve([HAMILTON]);
    await settle();
    expect(f.options()).toHaveLength(1);
    click(f.options()[0]);
    expect(f.homeLabel()).toBe(`Home: ${HOME}`);
    expect(f.options()).toHaveLength(1);

    pending.reject(new Error('The server could not save the commute.'));
    await settle();
    click(f.options()[0]);
    expect(f.homeLabel()).toBe('Home: Hamilton Heights');
  }, T);
});
