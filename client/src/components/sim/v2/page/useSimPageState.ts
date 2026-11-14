/**
 * The simulator page's state outside the body (#459): the selection lives in the URL
 * (`?package=`, `?employee=`, `?business=`, DECISIONS pass 47) with `&play=1` to start a journey
 * (#648), the keyboard map runs on the window, and the page knows whether it is below 900 px. The
 * logic is in `simPageState.ts`; this file only plugs it into React Router and the browser.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SimBodyKeys } from '../compose/SimPageBody';
import type { SimulatorV2 } from '../live/useSimulatorV2';
import type { Selection } from '../network/selectionModel';
import {
  attachSimKeys, autoPlayFromSearch, isNarrow, isNewRun, locationForSelection, locationWithoutAutoPlay,
  selectionFromSearch, watchNarrow,
  type MatchMediaFn, type SimKeyContext, type SimKeyTarget,
} from './simPageState';

export type SimPageState = {
  /**
   * Read from the URL on every render; an ID missing from the run is passed on as is. After a change
   * of run it is null (the old run's selection is being removed from the URL, #579).
   */
  selection: Selection;
  /** Pushes a history entry (Back undoes it) and keeps every other query param. */
  setSelection: (selection: Selection) => void;
  /** `play=1` is in the URL (#648): the body starts the journey once it is loaded. */
  autoPlay: boolean;
  /** Takes the `play` key out of the URL with a replace (no history entry); the body calls it once Play was asked for. */
  clearAutoPlay: () => void;
};

/**
 * The selection in the URL, plus a setter that navigates. Only the query string changes, so it works on any path.
 *
 * #579: when `runId` (the polled run) changes, the selection of the old run is removed from the URL
 * with `replace`, so Back does not return to it: IDs are numbered per run, so an old `?package=shp-3`
 * would open another package. Until the router shows the new URL (its updates may run in a
 * transition), the stale query string reads as no selection, so the old one is never drawn on the
 * new run. The first run is not a change: a deep link keeps its selection.
 */
export function useUrlSelection(runId: string | null = null): SimPageState {
  const location = useLocation();
  const navigate = useNavigate();
  const { pathname, search, hash } = location;

  const [shownRunId, setShownRunId] = useState(runId);
  /** The query string that holds the old run's selection, until the URL leaves it. */
  const [staleSearch, setStaleSearch] = useState<string | null>(null);
  if (runId !== null && runId !== shownRunId) {
    // Adjusted during render: React renders again at once, before any child sees the old selection.
    setShownRunId(runId);
    if (isNewRun(shownRunId, runId) && selectionFromSearch(search) !== null) setStaleSearch(search);
  }
  const stale = staleSearch !== null && staleSearch === search;
  const selection = stale ? null : selectionFromSearch(search);

  useLayoutEffect(() => {
    if (staleSearch === null) return;
    if (!stale) {
      setStaleSearch(null); // the URL moved on (the replace below, or the user)
      return;
    }
    const to = locationForSelection(null, { pathname, search, hash });
    if (to) navigate(to, { replace: true });
  }, [stale, staleSearch, pathname, search, hash, navigate]);

  const setSelection = useCallback(
    (next: Selection) => {
      const to = locationForSelection(next, { pathname, search, hash });
      if (to) navigate(to); // a push: Back undoes the selection
    },
    [pathname, search, hash, navigate],
  );

  // A stale URL (the old run's selection is being removed) asks for nothing.
  const autoPlay = !stale && autoPlayFromSearch(search);
  const clearAutoPlay = useCallback(() => {
    const to = locationWithoutAutoPlay({ pathname, search, hash });
    if (to) navigate(to, { replace: true });
  }, [pathname, search, hash, navigate]);
  return { selection, setSelection, autoPlay, clearAutoPlay };
}

/** The window as the key map's target; a DOM KeyboardEvent carries everything the map reads. */
function windowKeyTarget(): SimKeyTarget | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as SimKeyTarget;
}

/**
 * What the body gives the keys (#496, #648), filled while it is mounted: Esc asks `stopJourney`
 * first (it pauses a running journey and says whether it did); Space calls `togglePlay`, the
 * handler of the one Play/Pause button.
 */
export type SimKeysRef = { current: SimBodyKeys | null };

/**
 * Esc and Space on the page. The listener is attached once, reads the latest selection and poll
 * through a ref, and is removed on unmount. Space does what the Play/Pause button does; the server
 * decides the result.
 */
export function useSimKeys(sim: SimulatorV2, page: SimPageState, keysRef?: SimKeysRef): void {
  const latest = useRef<{ ctx: SimKeyContext; page: SimPageState }>({
    ctx: { selection: page.selection, data: sim }, page,
  });
  latest.current = { ctx: { selection: page.selection, data: sim }, page };

  useEffect(() => {
    const target = windowKeyTarget();
    if (!target) return undefined;
    return attachSimKeys(target, {
      context: () => latest.current.ctx,
      select: (s) => latest.current.page.setSelection(s),
      togglePlay: () => keysRef?.current?.togglePlay(),
      escape: () => keysRef?.current?.stopJourney() ?? false,
    });
    // The ref object is the page's own and never changes.
  }, []);
}

/** URL selection plus the keyboard map: everything the page needs around `SimPageBody`. */
export function useSimPageState(sim: SimulatorV2, keysRef?: SimKeysRef): SimPageState {
  const page = useUrlSelection(sim.sim?.runId ?? null);
  useSimKeys(sim, page, keysRef);
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
