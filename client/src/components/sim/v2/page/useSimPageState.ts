/**
 * The MVP II simulator page's state outside the body (#459): the selection lives in the URL
 * (`?package=`, `?employee=`, `?business=`, DECISIONS pass 47), the keyboard map runs on the window,
 * and the page knows whether it is below 900 px. The logic is in `simPageState.ts`; this file only
 * plugs it into React Router and the browser.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SimulatorV2 } from '../live/useSimulatorV2';
import type { Selection } from '../network/selectionModel';
import {
  attachSimKeys, isNarrow, locationForSelection, selectionFromSearch, watchNarrow,
  type MatchMediaFn, type SimKeyContext, type SimKeyTarget,
} from './simPageState';

export type SimPageState = {
  /** Read from the URL on every render; an ID missing from the run is passed on as is. */
  selection: Selection;
  /** Pushes a history entry (Back undoes it) and keeps every other query param. */
  setSelection: (selection: Selection) => void;
};

/** The selection in the URL, plus a setter that navigates. Only the query string changes, so it works on any path. */
export function useUrlSelection(): SimPageState {
  const location = useLocation();
  const navigate = useNavigate();
  const selection = selectionFromSearch(location.search);
  const { pathname, search, hash } = location;
  const setSelection = useCallback(
    (next: Selection) => {
      const to = locationForSelection(next, { pathname, search, hash });
      if (to) navigate(to); // a push: Back undoes the selection
    },
    [pathname, search, hash, navigate],
  );
  return { selection, setSelection };
}

/** The window as the key map's target; a DOM KeyboardEvent carries everything the map reads. */
function windowKeyTarget(): SimKeyTarget | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as SimKeyTarget;
}

/**
 * Esc, Space and the next-event key on the page. The listener is attached once, reads the latest
 * selection and poll through a ref, and is removed on unmount. Play, pause and next event go to
 * the data hook's `control`; the server decides the result.
 */
/** The body's Esc hook (#496): stops a running Play journey and says whether it did. */
export type EscapeRef = { current: (() => boolean) | null };

export function useSimKeys(sim: SimulatorV2, page: SimPageState, escapeRef?: EscapeRef): void {
  const latest = useRef<{ ctx: SimKeyContext; page: SimPageState; control: SimulatorV2['control'] }>({
    ctx: { selection: page.selection, data: sim }, page, control: sim.control,
  });
  latest.current = { ctx: { selection: page.selection, data: sim }, page, control: sim.control };

  useEffect(() => {
    const target = windowKeyTarget();
    if (!target) return undefined;
    return attachSimKeys(target, {
      context: () => latest.current.ctx,
      select: (s) => latest.current.page.setSelection(s),
      control: (req) => void latest.current.control(req),
      escape: () => escapeRef?.current?.() ?? false,
    });
    // The ref object is the page's own and never changes.
  }, []);
}

/** URL selection plus the keyboard map: everything the page needs around `SimPageBody`. */
export function useSimPageState(sim: SimulatorV2, escapeRef?: EscapeRef): SimPageState {
  const page = useUrlSelection();
  useSimKeys(sim, page, escapeRef);
  return page;
}

export function browserMatchMedia(): MatchMediaFn | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  return (q) => window.matchMedia(q);
}

/** True below 900 px. Read synchronously on the first render, so a phone never mounts the map. */
export function useNarrowScreen(matchMedia: MatchMediaFn | undefined = browserMatchMedia()): boolean {
  const [narrow, setNarrow] = useState(() => isNarrow(matchMedia));
  useEffect(() => {
    setNarrow(isNarrow(matchMedia));
    return watchNarrow(matchMedia, setNarrow);
    // Subscribed once: the browser's matchMedia is a new wrapper per render and the query never changes.
  }, []);
  return narrow;
}
