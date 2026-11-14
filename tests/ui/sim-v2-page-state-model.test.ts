// #459: the pure page state of the simulator: URL <-> selection, `play=1` (#648), the keys applied
// to the page (with and without a focused control), the listener's add/remove, and the 900 px query.
import { createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../client/src/components/sim/v2/network/selectionModel';
import {
  NARROW_QUERY, attachSimKeys, autoPlayFromSearch, isNarrow, locationForSelection, locationWithoutAutoPlay,
  sameSelection, searchForSelection, selectionFromSearch, simKeyEffect, simKeyState, watchNarrow,
  type MediaQueryLike, type SimKeyContext, type SimKeyboardEvent, type SimLocation,
} from '../../client/src/components/sim/v2/page/simPageState';
import type { SimulatorResponse } from '../../shared/v2/api';
import { makeSim } from './sim-v2-network-fixture';

// ---------- URL -> selection ----------
describe('selectionFromSearch', () => {
  it('reads each of the three kinds', () => {
    expect(selectionFromSearch('?package=shp-2')).toEqual({ kind: 'package', id: 'shp-2' });
    expect(selectionFromSearch('?employee=emp-1')).toEqual({ kind: 'employee', id: 'emp-1' });
    expect(selectionFromSearch('?business=biz-etsy')).toEqual({ kind: 'business', id: 'biz-etsy' });
    expect(selectionFromSearch('')).toBeNull();
    expect(selectionFromSearch('?speed=fast')).toBeNull();
  });

  it('with two params the first in package, employee, business order wins', () => {
    expect(selectionFromSearch('?employee=emp-1&package=shp-2')).toEqual({ kind: 'package', id: 'shp-2' });
    expect(selectionFromSearch('?business=biz-etsy&package=shp-2')).toEqual({ kind: 'package', id: 'shp-2' });
    expect(selectionFromSearch('?business=biz-etsy&employee=emp-1')).toEqual({ kind: 'employee', id: 'emp-1' });
  });

  it('keeps an ID the run does not know: the body shows it as not in the current scenario', () => {
    expect(selectionFromSearch('?package=shp-from-an-old-run')).toEqual({ kind: 'package', id: 'shp-from-an-old-run' });
    expect(selectionFromSearch('?employee=emp-404')).toEqual({ kind: 'employee', id: 'emp-404' });
  });
});

// ---------- selection -> URL ----------
describe('searchForSelection / locationForSelection', () => {
  it('writes the selection and keeps every other param', () => {
    expect(searchForSelection({ kind: 'employee', id: 'emp-1' }, '?speed=fast&debug=1')).toBe('?employee=emp-1&speed=fast&debug=1');
    expect(searchForSelection({ kind: 'package', id: 'shp-2' }, '?employee=emp-1&debug=1')).toBe('?package=shp-2&debug=1');
  });

  it('clearing drops every selection param (Back to network) but keeps the rest', () => {
    expect(searchForSelection(null, '?package=shp-2&debug=1')).toBe('?debug=1');
    expect(searchForSelection(null, '?package=shp-2')).toBe('');
    // A stale or shadowed selection is cleared too: none of the three keys survives.
    expect(searchForSelection(null, '?package=shp-404&employee=emp-1')).toBe('');
  });

  it('returns null when the URL already shows that selection (no duplicate history entry)', () => {
    expect(searchForSelection({ kind: 'package', id: 'shp-2' }, '?package=shp-2&debug=1')).toBeNull();
    expect(searchForSelection(null, '?debug=1')).toBeNull();
    expect(searchForSelection(null, '')).toBeNull();
  });

  it('keeps the path and hash: works at /nyc/simulator now and at /simulator after the cutover', () => {
    const at = (pathname: string): SimLocation => ({ pathname, search: '?x=1', hash: '#h' });
    expect(locationForSelection({ kind: 'business', id: 'biz-etsy' }, at('/nyc/simulator')))
      .toEqual({ pathname: '/nyc/simulator', search: '?business=biz-etsy&x=1', hash: '#h' });
    expect(locationForSelection({ kind: 'business', id: 'biz-etsy' }, at('/simulator'))?.pathname).toBe('/simulator');
    expect(locationForSelection(null, at('/simulator'))).toBeNull();
  });

  it('sameSelection compares kind and id', () => {
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection({ kind: 'package', id: 'a' }, { kind: 'package', id: 'a' })).toBe(true);
    expect(sameSelection({ kind: 'package', id: 'a' }, { kind: 'employee', id: 'a' })).toBe(false);
    expect(sameSelection({ kind: 'package', id: 'a' }, null)).toBe(false);
  });
});

describe('history: selecting pushes, Back undoes it (real memory router)', () => {
  it('Back returns to the previous selection, then to the network view; Forward redoes it', async () => {
    const router = createMemoryRouter([{ path: '/nyc/simulator', element: null }], {
      initialEntries: ['/nyc/simulator?debug=1'],
    });
    const current = () => router.state.location;
    const select = async (s: Selection) => {
      const to = locationForSelection(s, current());
      if (to) await router.navigate(to); // what useUrlSelection does: a push, never a replace
    };
    const shown = () => selectionFromSearch(current().search);

    await select({ kind: 'employee', id: 'emp-1' });
    await select({ kind: 'package', id: 'shp-2' });
    await select({ kind: 'package', id: 'shp-2' }); // same selection: no new entry
    expect(shown()).toEqual({ kind: 'package', id: 'shp-2' });
    expect(current().search).toBe('?package=shp-2&debug=1');

    await router.navigate(-1);
    expect(shown()).toEqual({ kind: 'employee', id: 'emp-1' });
    await router.navigate(-1);
    expect(shown()).toBeNull();
    expect(current().search).toBe('?debug=1');
    await router.navigate(1);
    expect(shown()).toEqual({ kind: 'employee', id: 'emp-1' });
    router.dispose();
  });
});

// ---------- play=1 (#648) ----------
describe('play=1 in the URL', () => {
  const at = (search: string): SimLocation => ({ pathname: '/simulator', search, hash: '#h' });

  it('asks for Play only with the value 1', () => {
    expect(autoPlayFromSearch('?package=shp-2&play=1')).toBe(true);
    expect(autoPlayFromSearch('?play=1&package=shp-2')).toBe(true);
    for (const s of ['?package=shp-2', '', '?package=shp-2&play=0', '?package=shp-2&play=true', '?package=shp-2&play=', '?player=1']) {
      expect(autoPlayFromSearch(s), s).toBe(false);
    }
  });

  it('the selection is read as without it', () => {
    expect(selectionFromSearch('?package=shp-2&play=1')).toEqual({ kind: 'package', id: 'shp-2' });
    expect(selectionFromSearch('?play=1')).toBeNull();
  });

  it('removing it keeps the path, the hash and every other key in order', () => {
    expect(locationWithoutAutoPlay(at('?package=shp-2&play=1'))).toEqual(at('?package=shp-2'));
    expect(locationWithoutAutoPlay(at('?package=shp-2&play=1&debug=1'))).toEqual(at('?package=shp-2&debug=1'));
    expect(locationWithoutAutoPlay(at('?play=1'))).toEqual(at(''));
    // Any value goes, also one that asks nothing, and a repeated key.
    expect(locationWithoutAutoPlay(at('?play=0&package=shp-2&play=1'))).toEqual(at('?package=shp-2'));
  });

  it('nothing to remove: null, so the page does not navigate', () => {
    for (const s of ['', '?package=shp-2', '?package=a%20b&x=1', '?player=1']) expect(locationWithoutAutoPlay(at(s)), s).toBeNull();
  });

  it('is a replace, not a push: Back leaves the simulator instead of starting the journey again', async () => {
    const router = createMemoryRouter([{ path: '*', element: null }], { initialEntries: ['/', '/simulator?package=shp-2&play=1'] });
    const to = locationWithoutAutoPlay(router.state.location);
    await router.navigate(to!, { replace: true }); // what useUrlSelection's clearAutoPlay does
    expect(router.state.location.search).toBe('?package=shp-2');
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/');
    router.dispose();
  });

  it('picking another package before the key is removed keeps it; picking after does not start again', () => {
    expect(searchForSelection({ kind: 'package', id: 'shp-1' }, '?package=shp-2&play=1')).toBe('?package=shp-1&play=1');
    expect(searchForSelection({ kind: 'package', id: 'shp-1' }, '?package=shp-2')).toBe('?package=shp-1');
  });
});

// ---------- Keys ----------
const simWith = (over: Partial<SimulatorResponse> = {}, clock: Partial<SimulatorResponse['clock']> = {}): SimulatorResponse => {
  const s = makeSim();
  return { ...s, ...over, clock: { ...s.clock, ...clock } };
};
const ctx = (selection: Selection, sim: SimulatorResponse | null = simWith()): SimKeyContext =>
  ({ selection, data: { sim } });
const body = { tagName: 'BODY' };
const key = (k: string, target: { tagName?: string; type?: string; isContentEditable?: boolean } | null = body) => ({ key: k, target });
const isEsc = (k: string) => k === 'Escape' || k === 'Esc';
const pkg: Selection = { kind: 'package', id: 'shp-2' };
const emp: Selection = { kind: 'employee', id: 'emp-1' };

describe('simKeyState', () => {
  it('a package selection is journey mode; the playing flag comes from the polled clock', () => {
    expect(simKeyState(ctx(pkg))).toEqual({ mode: 'journey', playing: true, hasSelection: true });
    expect(simKeyState(ctx(emp, simWith({}, { playing: false })))).toEqual({ mode: 'network', playing: false, hasSelection: true });
    expect(simKeyState(ctx(null, null))).toEqual({ mode: 'network', playing: false, hasSelection: false });
  });
});

describe('simKeyEffect', () => {
  it('Esc leaves the journey, then clears a network selection, then does nothing', () => {
    expect(simKeyEffect(key('Escape'), ctx(pkg))).toEqual({ kind: 'select', selection: null });
    expect(simKeyEffect(key('Escape'), ctx(emp))).toEqual({ kind: 'select', selection: null });
    expect(simKeyEffect(key('Escape'), ctx({ kind: 'business', id: 'biz-etsy' }))).toEqual({ kind: 'select', selection: null });
    expect(simKeyEffect(key('Escape'), ctx(null))).toBeNull();
  });

  it('Esc works before the first poll and on a stale selection', () => {
    expect(simKeyEffect(key('Escape'), ctx({ kind: 'package', id: 'shp-404' }, null))).toEqual({ kind: 'select', selection: null });
  });

  it('Space presses the one Play/Pause button, with or without a package (#648)', () => {
    expect(simKeyEffect(key(' '), ctx(null))).toEqual({ kind: 'toggle_play' });
    expect(simKeyEffect(key(' '), ctx(pkg, simWith({}, { playing: false })))).toEqual({ kind: 'toggle_play' });
    expect(simKeyEffect(key('Spacebar'), ctx(emp))).toEqual({ kind: 'toggle_play' });
    // What the press does (and whether the button is disabled) is the body's handler's to say.
    expect(simKeyEffect(key(' '), ctx(null, simWith({}, { playing: false, timeMin: 2160 })))).toEqual({ kind: 'toggle_play' });
  });

  it('Space does nothing before the first poll: there is no button yet', () => {
    expect(simKeyEffect(key(' '), ctx(null, null))).toBeNull();
    expect(simKeyEffect(key(' '), ctx(pkg, null))).toBeNull();
  });

  it('"." does nothing any more, from anywhere (#648)', () => {
    for (const sel of [null, pkg, emp]) {
      expect(simKeyEffect(key('.'), ctx(sel))).toBeNull();
      expect(simKeyEffect(key('.', { tagName: 'BUTTON' }), ctx(sel))).toBeNull();
      expect(simKeyEffect(key('.', { tagName: 'SELECT' }), ctx(sel))).toBeNull();
    }
  });

  it('nothing fires while the focus is in a text field; a button keeps only its Space (#511, #607)', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'input']) {
      for (const k of ['Escape', ' ']) {
        for (const sel of [pkg, emp]) expect(simKeyEffect(key(k, { tagName }), ctx(sel))).toBeNull();
      }
    }
    for (const tagName of ['BUTTON', 'button']) {
      for (const sel of [pkg, emp]) {
        expect(simKeyEffect(key('Escape', { tagName }), ctx(sel))).toEqual({ kind: 'select', selection: null });
        expect(simKeyEffect(key(' ', { tagName }), ctx(sel))).toBeNull();
      }
    }
    expect(simKeyEffect(key(' ', { tagName: 'DIV', isContentEditable: true }), ctx(null))).toBeNull();
  });

  it('a checkbox and the focus dropdown do not keep Esc; the dropdown does not keep Space (#607)', () => {
    const checkbox = { tagName: 'INPUT', type: 'checkbox' };
    const dropdown = { tagName: 'SELECT', type: 'select-one' };
    for (const target of [checkbox, dropdown]) {
      expect(simKeyEffect(key('Escape', target), ctx(pkg))).toEqual({ kind: 'select', selection: null });
      expect(simKeyEffect(key('Escape', target), ctx(emp))).toEqual({ kind: 'select', selection: null });
    }
    expect(simKeyEffect(key(' ', dropdown), ctx(pkg))).toEqual({ kind: 'toggle_play' });
    expect(simKeyEffect(key(' ', checkbox), ctx(pkg))).toBeNull(); // Space toggles the checkbox, not playback
    expect(simKeyEffect(key('Escape', { tagName: 'INPUT', type: 'text' }), ctx(pkg))).toBeNull();
    expect(simKeyEffect(key(' ', { tagName: 'INPUT', type: 'search' }), ctx(pkg))).toBeNull();
  });

  it('other keys and modified keys do nothing', () => {
    expect(simKeyEffect(key('a'), ctx(pkg))).toBeNull();
    expect(simKeyEffect({ ...key(' '), metaKey: true }, ctx(pkg))).toBeNull();
    expect(simKeyEffect({ ...key(' '), repeat: true }, ctx(pkg))).toBeNull();
  });
});

describe('attachSimKeys', () => {
  type FakeEvent = SimKeyboardEvent & { defaultPrevented: boolean; preventDefault: ReturnType<typeof vi.fn> };
  /** A window with capture and bubble keydown listeners, dispatched capture first like the DOM. */
  function fakeWindow() {
    const capture = new Set<(e: SimKeyboardEvent) => void>();
    const bubble = new Set<(e: FakeEvent) => void>();
    return {
      listeners: capture,
      bubble,
      addEventListener: (_t: 'keydown', l: (e: SimKeyboardEvent) => void, o: { capture: boolean }) => {
        expect(o.capture).toBe(true);
        capture.add(l);
      },
      removeEventListener: (_t: 'keydown', l: (e: SimKeyboardEvent) => void, o: { capture: boolean }) => {
        expect(o.capture).toBe(true);
        capture.delete(l);
      },
      press(k: string, target: { tagName?: string; type?: string } = body): FakeEvent {
        const e = { key: k, target, defaultPrevented: false } as FakeEvent;
        e.preventDefault = vi.fn(() => { e.defaultPrevented = true; });
        for (const l of capture) l(e);
        for (const l of bubble) l(e);
        return e;
      },
    };
  }

  it("runs before SimWorkspace's own Esc listener, so one Esc changes the selection once", () => {
    const win = fakeWindow();
    const select = vi.fn();
    // SimWorkspace's listener: bubble phase, skips a prevented event, ignores only typing targets.
    const workspaceEsc = vi.fn();
    win.bubble.add((e) => {
      const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target?.tagName ?? '').toUpperCase());
      if (isEsc(e.key) && !e.defaultPrevented && !typing) workspaceEsc();
    });
    attachSimKeys(win, { context: () => ctx(pkg), select, togglePlay: vi.fn() });

    win.press('Escape');
    expect(select).toHaveBeenCalledTimes(1);
    expect(workspaceEsc).not.toHaveBeenCalled();

    // Esc on a focused button (#511): the page leaves the journey once; the workspace does not act too.
    const onButton = win.press('Escape', { tagName: 'BUTTON' });
    expect(onButton.preventDefault).toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(2);
    expect(workspaceEsc).not.toHaveBeenCalled();

    // Esc in a text field keeps its own default (clearing a search box).
    expect(win.press('Escape', { tagName: 'INPUT' }).preventDefault).not.toHaveBeenCalled();
  });

  it('routes Esc to select and Space to the Play/Pause handler, reads the latest context, and is removed on unmount', () => {
    const win = fakeWindow();
    let current = ctx(pkg);
    const select = vi.fn();
    const togglePlay = vi.fn();
    const detach = attachSimKeys(win, { context: () => current, select, togglePlay });
    expect(win.listeners.size).toBe(1);

    const esc = win.press('Escape');
    expect(select).toHaveBeenCalledWith(null);
    expect(esc.preventDefault).toHaveBeenCalled();
    expect(togglePlay).not.toHaveBeenCalled();

    const space = win.press(' ');
    expect(togglePlay).toHaveBeenCalledTimes(1);
    expect(space.preventDefault).toHaveBeenCalled(); // the page does not scroll

    current = ctx(null, null); // a newer state, no reattach: no run, so no button
    expect(win.press(' ').preventDefault).not.toHaveBeenCalled();
    expect(togglePlay).toHaveBeenCalledTimes(1);

    current = ctx(null);
    win.press(' ');
    expect(togglePlay).toHaveBeenCalledTimes(2);

    detach();
    expect(win.listeners.size).toBe(0);
    win.press(' ');
    expect(togglePlay).toHaveBeenCalledTimes(2);
  });

  it('"." is not a page key any more: nothing is called and its default is kept (#648)', () => {
    const win = fakeWindow();
    const select = vi.fn();
    const togglePlay = vi.fn();
    const escape = vi.fn(() => true);
    attachSimKeys(win, { context: () => ctx(pkg), select, togglePlay, escape });
    for (const target of [body, { tagName: 'BUTTON' }, { tagName: 'SELECT' }, { tagName: 'INPUT', type: 'text' }]) {
      expect(win.press('.', target).preventDefault).not.toHaveBeenCalled();
    }
    expect(select).not.toHaveBeenCalled();
    expect(togglePlay).not.toHaveBeenCalled();
    expect(escape).not.toHaveBeenCalled();
  });

  it('a key from a text field is left to the field (no action; Esc and Space keep their default)', () => {
    const win = fakeWindow();
    const select = vi.fn();
    const togglePlay = vi.fn();
    const escape = vi.fn(() => true);
    attachSimKeys(win, { context: () => ctx(pkg), select, togglePlay, escape });
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'INPUT', type: 'search' }, { tagName: 'TEXTAREA' }]) {
      for (const k of [' ', 'Escape']) expect(win.press(k, target).preventDefault).not.toHaveBeenCalled();
    }
    expect(select).not.toHaveBeenCalled();
    expect(togglePlay).not.toHaveBeenCalled();
    expect(escape).not.toHaveBeenCalled();
  });

  it('Space on a focused button or checkbox is left to it; Esc from them leaves the journey (#511, #607)', () => {
    const win = fakeWindow();
    const select = vi.fn();
    const togglePlay = vi.fn();
    attachSimKeys(win, { context: () => ctx(pkg), select, togglePlay });
    const targets = [{ tagName: 'BUTTON' }, { tagName: 'INPUT', type: 'checkbox' }];
    for (const target of targets) expect(win.press(' ', target).preventDefault).not.toHaveBeenCalled();
    expect(togglePlay).not.toHaveBeenCalled(); // the Play/Pause button's own Space is its click
    for (const target of targets) expect(win.press('Escape', target).preventDefault).toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledWith(null);
  });

  it('from the focus dropdown, Esc and Space act once and are claimed (#607)', () => {
    const win = fakeWindow();
    const select = vi.fn();
    const togglePlay = vi.fn();
    // SimWorkspace's listener, with the same rule for text fields (workspaceModel uses the key map's).
    const workspaceEsc = vi.fn();
    win.bubble.add((e) => { if (isEsc(e.key) && !e.defaultPrevented) workspaceEsc(); });
    let current = ctx(pkg);
    attachSimKeys(win, { context: () => current, select, togglePlay });
    const dropdown = { tagName: 'SELECT', type: 'select-one' };
    expect(win.press('Escape', dropdown).preventDefault).toHaveBeenCalled();
    expect(win.press(' ', dropdown).preventDefault).toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(1);
    expect(togglePlay).toHaveBeenCalledTimes(1);
    // With nothing selected Esc has nothing to do, and is still claimed from a control.
    current = ctx(null);
    expect(win.press('Escape', dropdown).preventDefault).toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(1);
    expect(workspaceEsc).not.toHaveBeenCalled();
  });

  it('Esc asks the journey first: a running one takes the key, and the next Esc changes the selection (#496)', () => {
    const win = fakeWindow();
    const select = vi.fn();
    const togglePlay = vi.fn();
    let running = true;
    const escape = vi.fn(() => { const was = running; running = false; return was; });
    attachSimKeys(win, { context: () => ctx(pkg), select, togglePlay, escape });
    expect(win.press('Escape', { tagName: 'BUTTON' }).preventDefault).toHaveBeenCalled(); // focus on the Pause button
    expect(select).not.toHaveBeenCalled();
    win.press('Escape');
    expect(select).toHaveBeenCalledTimes(1);
    // Space never asks it: pausing a running journey is the button's own action.
    win.press(' ');
    expect(escape).toHaveBeenCalledTimes(2);
    expect(togglePlay).toHaveBeenCalledTimes(1);
  });
});

// ---------- 900 px ----------
describe('isNarrow / watchNarrow', () => {
  function fakeMedia(matches: boolean) {
    const listeners = new Set<() => void>();
    const mql: MediaQueryLike & { listeners: Set<() => void> } = {
      matches,
      listeners,
      addEventListener: (_t, l) => void listeners.add(l),
      removeEventListener: (_t, l) => void listeners.delete(l),
    };
    const queries: string[] = [];
    const matchMedia = (q: string) => { queries.push(q); return mql; };
    return { mql, matchMedia, queries };
  }

  it('uses the same breakpoint as page.css; no matchMedia counts as wide', () => {
    const m = fakeMedia(true);
    expect(isNarrow(m.matchMedia)).toBe(true);
    expect(m.queries).toEqual([NARROW_QUERY]);
    expect(NARROW_QUERY).toBe('(max-width: 899.98px)');
    expect(isNarrow(fakeMedia(false).matchMedia)).toBe(false);
    expect(isNarrow(undefined)).toBe(false);
  });

  it('reports a resize across 900 px and unsubscribes', () => {
    const m = fakeMedia(false);
    const seen: boolean[] = [];
    const stop = watchNarrow(m.matchMedia, (n) => seen.push(n));
    m.mql.matches = true;
    for (const l of m.mql.listeners) l();
    expect(seen).toEqual([true]);
    stop();
    expect(m.mql.listeners.size).toBe(0);
    expect(() => watchNarrow(undefined, () => {})()).not.toThrow();
  });
});
