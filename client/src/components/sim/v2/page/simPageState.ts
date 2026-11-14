/**
 * Pure parts of the MVP II simulator page state (#459): the selection read from and written to the
 * URL (DECISIONS pass 47), the keyboard map applied to the page, the listener wiring and the
 * desktop-only media query. No React and no window reads, so Node tests drive every branch;
 * `useSimPageState.ts` only plugs these into React Router and `window`.
 *
 * Nothing about a delivery is computed here: a key either changes the selection (the URL) or sends
 * the same SimControlRequest the playback buttons send, through the data hook's `control`.
 */
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import { SIM_WINDOW } from '../compose/simPageView';
import { playbackRequest, toPlaybackView } from '../controls/controlsModel';
import type { SimDataState } from '../live/simDataModel';
import type { Selection } from '../network/selectionModel';
import { isControlTarget, simKeyAction, type SimKeyEvent, type SimKeyState } from './keyMap';
import { parseSimUrl, simUrlFor } from './urlState';

// ---------- URL <-> selection ----------

/** The selection a query string asks for. Unknown IDs are kept: the body shows them as "not in the current scenario". */
export function selectionFromSearch(search: string): Selection {
  return parseSimUrl(search).selection;
}

export function sameSelection(a: Selection, b: Selection): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

/**
 * The query string to navigate to for `next`, keeping every other param of `currentSearch`,
 * or null when the URL already shows that selection (so no duplicate history entry is pushed).
 */
export function searchForSelection(next: Selection, currentSearch: string): string | null {
  if (sameSelection(selectionFromSearch(currentSearch), next)) return null;
  return simUrlFor(next, currentSearch);
}

export type SimLocation = { pathname: string; search: string; hash: string };

/**
 * Where selecting `next` navigates: the same path and hash with the new query string, or null when
 * nothing changes. The page pushes it (never replaces), so Back returns to the previous selection.
 */
export function locationForSelection(next: Selection, current: SimLocation): SimLocation | null {
  const search = searchForSelection(next, current.search);
  return search === null ? null : { pathname: current.pathname, search, hash: current.hash };
}

// ---------- Keys ----------

/** What the page does for one key press. */
export type SimKeyEffect =
  | { kind: 'select'; selection: Selection }
  | { kind: 'control'; request: SimControlRequest };

export type SimKeyContext = {
  selection: Selection;
  data: Pick<SimDataState, 'sim' | 'busy'>;
};

export function simKeyState({ selection, data }: SimKeyContext): SimKeyState {
  return {
    mode: selection?.kind === 'package' ? 'journey' : 'network',
    playing: data.sim?.clock.playing ?? false,
    hasSelection: selection !== null,
  };
}

/**
 * The effect of a key press, or null. Esc changes the selection (works before the first poll too);
 * Space and the next-event key send the request the matching playback button sends, and do nothing
 * while that button would be disabled (no run yet, an action open, nothing left to play).
 */
export function simKeyEffect(event: SimKeyEvent, ctx: SimKeyContext): SimKeyEffect | null {
  const action = simKeyAction(event, simKeyState(ctx));
  if (action === null) return null;
  if (action === 'exit_journey' || action === 'clear_selection') return { kind: 'select', selection: null };

  const sim = ctx.data.sim;
  if (!sim) return null;
  const disabled = toPlaybackView(sim.clock, SIM_WINDOW, sim.nextEventMin, ctx.data.busy).disabled;
  if (action === 'toggle_play') {
    return disabled.play ? null : { kind: 'control', request: playbackRequest('playPause', sim.clock) };
  }
  return disabled.nextEvent ? null : { kind: 'control', request: playbackRequest('nextEvent', sim.clock) };
}

/** The DOM KeyboardEvent parts the listener uses. */
export type SimKeyboardEvent = SimKeyEvent & { preventDefault: () => void };

export type SimKeyTarget = {
  addEventListener: (type: 'keydown', listener: (e: SimKeyboardEvent) => void, options: { capture: boolean }) => void;
  removeEventListener: (type: 'keydown', listener: (e: SimKeyboardEvent) => void, options: { capture: boolean }) => void;
};

export type SimKeyHandlers = {
  /** Read at key time, so the listener is attached once and still sees the latest poll and selection. */
  context: () => SimKeyContext;
  select: (selection: Selection) => void;
  control: (request: SimControlRequest) => void;
  /**
   * Asked first on Esc (#496): returns true when it used the key (a running Play journey stopped),
   * so the first Esc stops the journey and the next one goes back to the network. It is asked from
   * a focused button too (the Stop button has focus after a click), never from a text field.
   */
  escape?: () => boolean;
};

const isEscape = (key: string) => key === 'Escape' || key === 'Esc';

/** A control that keeps Esc for itself (typing, choosing); a button is not one. */
const isTextField = (target: SimKeyEvent['target']) =>
  isControlTarget(target) && (target?.tagName ?? '').toUpperCase() !== 'BUTTON';

/**
 * Attaches the page's keydown listener to `target` (the window) and returns the function that
 * removes it (the effect's cleanup on unmount).
 *
 * The page's key map is the one owner of these keys. `SimWorkspace` (under the body) has its own
 * window Esc listener from before the key map, which skips an event whose default is prevented.
 * So this listener runs in the capture phase (before that bubble listener) and prevents the default
 * of every key it handles: Esc changes the URL once, not twice, and Space does not scroll the page.
 * Esc on a focused button is claimed the same way without an action, so it does nothing (a button
 * has no Esc default to lose); Esc in an input, select or textarea is left alone.
 */
export function attachSimKeys(target: SimKeyTarget, h: SimKeyHandlers): () => void {
  const listener = (e: SimKeyboardEvent) => {
    if (h.escape && isEscape(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextField(e.target) && h.escape()) {
      e.preventDefault();
      return;
    }
    const effect = simKeyEffect(e, h.context());
    if (!effect) {
      if (isEscape(e.key) && (e.target?.tagName ?? '').toUpperCase() === 'BUTTON') e.preventDefault();
      return;
    }
    e.preventDefault();
    if (effect.kind === 'select') h.select(effect.selection);
    else h.control(effect.request);
  };
  target.addEventListener('keydown', listener, { capture: true });
  return () => target.removeEventListener('keydown', listener, { capture: true });
}

// ---------- Desktop-only notice ----------

/** Same breakpoint as page.css: below 900 px the simulator shows the desktop-only notice. */
export const NARROW_QUERY = '(max-width: 899.98px)';

export type MediaQueryLike = {
  matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};
export type MatchMediaFn = (query: string) => MediaQueryLike;

/** True below 900 px. Without matchMedia (server render, old test environments) the page counts as wide. */
export function isNarrow(matchMedia: MatchMediaFn | undefined): boolean {
  return matchMedia ? matchMedia(NARROW_QUERY).matches : false;
}

/** Calls `onChange(narrow)` when the window crosses 900 px; returns the unsubscribe function. */
export function watchNarrow(matchMedia: MatchMediaFn | undefined, onChange: (narrow: boolean) => void): () => void {
  if (!matchMedia) return () => {};
  const mql = matchMedia(NARROW_QUERY);
  const listener = () => onChange(mql.matches);
  mql.addEventListener?.('change', listener);
  return () => mql.removeEventListener?.('change', listener);
}
