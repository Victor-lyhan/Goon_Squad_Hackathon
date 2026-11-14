/**
 * Pure parts of the simulator page state (#459): the selection read from and written to the
 * URL (DECISIONS pass 47), `play=1` (#648), the keyboard map applied to the page, the listener
 * wiring and the desktop-only media query. No React and no window reads, so Node tests drive every
 * branch; `useSimPageState.ts` only plugs these into React Router and `window`.
 *
 * Nothing about a delivery is computed here: a key either changes the selection (the URL) or
 * presses the page's one Play/Pause button (#648).
 */
import type { SimDataState } from '../live/simDataModel';
import type { Selection } from '../network/selectionModel';
import { isControlTarget, isTextTarget, simKeyAction, type SimKeyEvent, type SimKeyState } from './keyMap';
import { hasAutoPlayKey, parseSimUrl, simUrlFor, wantsAutoPlay, withoutAutoPlay } from './urlState';

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

// ---------- `play=1` (#648) ----------

/** True when the URL asks to start the journey: `?package=<id>&play=1`. */
export function autoPlayFromSearch(search: string): boolean {
  return wantsAutoPlay(search);
}

/**
 * Where the page goes once Play was asked for: the same path, hash and query string without the
 * `play` key, or null when the key is not there. The page replaces (never pushes), so Back does not
 * return to a URL that starts the journey again.
 */
export function locationWithoutAutoPlay(current: SimLocation): SimLocation | null {
  if (!hasAutoPlayKey(current.search)) return null;
  return { pathname: current.pathname, search: withoutAutoPlay(current.search), hash: current.hash };
}

// ---------- Run change (#579) ----------

/**
 * True when the polled `runId` is another run than the one the page last showed. The first run the
 * page sees (`shown` null) is not a change, so a deep link keeps its selection; no poll yet
 * (`polled` null) is not one either. A new `version` of the same run never reaches this.
 */
export function isNewRun(shown: string | null, polled: string | null): boolean {
  return shown !== null && polled !== null && polled !== shown;
}

// ---------- Keys ----------

/** What the page does for one key press. */
export type SimKeyEffect =
  | { kind: 'select'; selection: Selection }
  | { kind: 'toggle_play' };

export type SimKeyContext = {
  selection: Selection;
  data: Pick<SimDataState, 'sim'>;
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
 * Space presses the one Play/Pause button, so it does what the button does (the picked package's
 * journey, or the server clock) and nothing while the button is disabled; before the first poll
 * there is no button, so no effect. Which focused elements keep a key for themselves is the key
 * map's rule (`simKeyAction`).
 */
export function simKeyEffect(event: SimKeyEvent, ctx: SimKeyContext): SimKeyEffect | null {
  const action = simKeyAction(event, simKeyState(ctx));
  if (action === null) return null;
  if (action === 'exit_journey' || action === 'clear_selection') return { kind: 'select', selection: null };
  return ctx.data.sim ? { kind: 'toggle_play' } : null;
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
  /** Space: the body's handler of the one Play/Pause button (#648). */
  togglePlay: () => void;
  /**
   * Asked first on Esc (#496): returns true when it used the key (a running journey was paused),
   * so the first Esc stops the journey and the next one goes back to the network. It is asked from
   * a focused button, checkbox or dropdown too (the Pause button has focus after a click), never
   * from a text field.
   */
  escape?: () => boolean;
};

const isEscape = (key: string) => key === 'Escape' || key === 'Esc';

/**
 * Attaches the page's keydown listener to `target` (the window) and returns the function that
 * removes it (the effect's cleanup on unmount).
 *
 * The page's key map is the one owner of these keys. `SimWorkspace` (under the body) has its own
 * window Esc listener from before the key map, which skips an event whose default is prevented.
 * So this listener runs in the capture phase (before that bubble listener) and prevents the default
 * of every key it handles: Esc changes the URL once, not twice, and Space does not scroll the page.
 * Esc on a focused button, checkbox or dropdown works like Esc anywhere else (#511, #607:
 * after a click the focus is on that control, and Esc must still leave the journey); when it has
 * nothing to do there it is still claimed, so the workspace listener does not act on it. Esc in a
 * text field (`isTextTarget`) is left alone.
 */
export function attachSimKeys(target: SimKeyTarget, h: SimKeyHandlers): () => void {
  const listener = (e: SimKeyboardEvent) => {
    if (h.escape && isEscape(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextTarget(e.target) && h.escape()) {
      e.preventDefault();
      return;
    }
    const effect = simKeyEffect(e, h.context());
    if (!effect) {
      if (isEscape(e.key) && isControlTarget(e.target) && !isTextTarget(e.target)) e.preventDefault();
      return;
    }
    e.preventDefault();
    if (effect.kind === 'select') h.select(effect.selection);
    else h.togglePlay();
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
