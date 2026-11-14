// #459: the pure page state of the MVP II simulator: URL <-> selection, the keys applied to the
// page (with and without a focused control), the listener's add/remove, and the 900 px query.
import { createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../client/src/components/sim/v2/network/selectionModel';
import {
  NARROW_QUERY, attachSimKeys, isNarrow, locationForSelection, sameSelection, searchForSelection,
  selectionFromSearch, simKeyEffect, simKeyState, watchNarrow,
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

// ---------- Keys ----------
const simWith = (over: Partial<SimulatorResponse> = {}, clock: Partial<SimulatorResponse['clock']> = {}): SimulatorResponse => {
  const s = makeSim();
  return { ...s, ...over, clock: { ...s.clock, ...clock } };
};
const ctx = (selection: Selection, sim: SimulatorResponse | null = simWith(), busy = false): SimKeyContext =>
  ({ selection, data: { sim, busy } });
const body = { tagName: 'BODY' };
const key = (k: string, target: { tagName?: string; isContentEditable?: boolean } | null = body) => ({ key: k, target });
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

  it('Space toggles play and pause from the polled clock', () => {
    expect(simKeyEffect(key(' '), ctx(null))).toEqual({ kind: 'control', request: { action: 'pause' } });
    expect(simKeyEffect(key(' '), ctx(pkg, simWith({}, { playing: false })))).toEqual({ kind: 'control', request: { action: 'play' } });
  });

  it('the next-event key sends next_event', () => {
    expect(simKeyEffect(key('.'), ctx(null))).toEqual({ kind: 'control', request: { action: 'next_event' } });
    expect(simKeyEffect(key('.'), ctx(pkg))).toEqual({ kind: 'control', request: { action: 'next_event' } });
  });

  it('Space and next event do nothing while the matching button is disabled', () => {
    expect(simKeyEffect(key(' '), ctx(null, null))).toBeNull(); // no run yet
    expect(simKeyEffect(key('.'), ctx(null, null))).toBeNull();
    expect(simKeyEffect(key(' '), ctx(null, simWith(), true))).toBeNull(); // an action is open
    expect(simKeyEffect(key('.'), ctx(null, simWith(), true))).toBeNull();
    expect(simKeyEffect(key('.'), ctx(null, simWith({ nextEventMin: null })))).toBeNull();
    expect(simKeyEffect(key(' '), ctx(null, simWith({}, { playing: false, timeMin: 2160 })))).toBeNull(); // finished
    // Pausing stays possible at the end.
    expect(simKeyEffect(key(' '), ctx(null, simWith({}, { playing: true, timeMin: 2160 })))).toEqual({ kind: 'control', request: { action: 'pause' } });
  });

  it('nothing fires while the focus is in an input, select, textarea or button (Esc from a button does, #511)', () => {
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'input', 'button']) {
      const button = tagName.toUpperCase() === 'BUTTON';
      for (const k of ['Escape', ' ', '.']) {
        const fires = button && k === 'Escape';
        for (const sel of [pkg, emp]) {
          if (fires) expect(simKeyEffect(key(k, { tagName }), ctx(sel))).toEqual({ kind: 'select', selection: null });
          else expect(simKeyEffect(key(k, { tagName }), ctx(sel))).toBeNull();
        }
      }
    }
    expect(simKeyEffect(key(' ', { tagName: 'DIV', isContentEditable: true }), ctx(null))).toBeNull();
  });

  it('other keys and modified keys do nothing', () => {
    expect(simKeyEffect(key('a'), ctx(pkg))).toBeNull();
    expect(simKeyEffect({ ...key('.'), metaKey: true }, ctx(pkg))).toBeNull();
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
      press(k: string, target: { tagName?: string } = body): FakeEvent {
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
    attachSimKeys(win, { context: () => ctx(pkg), select, control: vi.fn() });

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

  it('routes keys to select and control, reads the latest context, and is removed on unmount', () => {
    const win = fakeWindow();
    let current = ctx(pkg);
    const select = vi.fn();
    const control = vi.fn();
    const detach = attachSimKeys(win, { context: () => current, select, control });
    expect(win.listeners.size).toBe(1);

    const esc = win.press('Escape');
    expect(select).toHaveBeenCalledWith(null);
    expect(esc.preventDefault).toHaveBeenCalled();

    const space = win.press(' ');
    expect(control).toHaveBeenLastCalledWith({ action: 'pause' });
    expect(space.preventDefault).toHaveBeenCalled(); // the page does not scroll

    current = ctx(null, simWith({}, { playing: false })); // a newer poll, no reattach
    win.press(' ');
    expect(control).toHaveBeenLastCalledWith({ action: 'play' });
    win.press('.');
    expect(control).toHaveBeenLastCalledWith({ action: 'next_event' });

    detach();
    expect(win.listeners.size).toBe(0);
    win.press('.');
    expect(control).toHaveBeenCalledTimes(3);
  });

  it('a key from a focused control is left to the control (no action; Space and . keep their default)', () => {
    const win = fakeWindow();
    const select = vi.fn();
    const control = vi.fn();
    attachSimKeys(win, { context: () => ctx(pkg), select, control });
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']) {
      for (const k of [' ', '.']) expect(win.press(k, { tagName }).preventDefault).not.toHaveBeenCalled();
      win.press('Escape', { tagName });
    }
    // Only the Esc from the button leaves the journey (#511); the text fields keep theirs.
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(null);
    expect(control).not.toHaveBeenCalled();
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
