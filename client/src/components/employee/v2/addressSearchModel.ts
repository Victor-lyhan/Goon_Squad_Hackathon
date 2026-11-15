// Pure state for the MVP II home address search (#331). Tested in Node.
// Local types on purpose: the shared/v2 contracts land in a parallel issue and match these shapes.

export type AddressResult = { label: string; neighborhood: string; lat: number; lng: number };
export type SearchFn = (query: string, signal: AbortSignal) => Promise<AddressResult[]>;
/** What the editor keeps: never the street address (SPEC MVP II rule 6). */
export type HomeChoice = { neighborhood: string; lat: number; lng: number };

export type SearchStatus = 'idle' | 'typing' | 'searching' | 'results' | 'empty' | 'error' | 'unavailable';

export interface AddressSearchState {
  /** What the user typed. Lives only in this component's state, never derived from polled props (pass 43). */
  query: string;
  status: SearchStatus;
  results: AddressResult[];
  /** Index into results, or -1 when nothing is highlighted. */
  highlight: number;
  /** The query the in-flight search was started with; responses for any other query are stale. */
  pendingQuery: string | null;
  /** Set only in the error status. */
  message: string | null;
  /** Bumped by Retry so the component searches the same query again. */
  attempt: number;
}

/** A failed search, already classified (see describeSearchError). */
export type SearchFailure = { kind: 'aborted' } | { kind: 'unavailable' } | { kind: 'error'; message: string };

export type AddressSearchAction =
  | { type: 'input'; query: string }
  | { type: 'searchStart'; query: string }
  | { type: 'searchSuccess'; query: string; results: AddressResult[] }
  | { type: 'searchFailure'; query: string; failure: SearchFailure }
  | { type: 'highlight'; delta: 1 | -1 }
  | { type: 'retry' }
  | { type: 'close' }
  | { type: 'choose' }
  | { type: 'clear' };

export const MIN_QUERY_LENGTH = 3;
export const DEFAULT_DEBOUNCE_MS = 350;

export const EMPTY_TEXT = 'No address found. Try a street and number in New York City.';
/** The search cannot run at all (#916: what failed and what to do, with no word about how it is set up). */
export const UNAVAILABLE_TEXT = 'Address search is not available right now. Keep your saved home, or try again later.';
export const SEARCHING_TEXT = 'Searching…';
export const SHORT_QUERY_TEXT = 'Type at least 3 characters to search.';
/** Every other failure: the search refused, slow or down, a timeout, no network (#598). Shown with Retry. */
export const NOT_ANSWERING_TEXT = 'Address search is not answering. Try again.';

export const initialSearchState: AddressSearchState = {
  query: '', status: 'idle', results: [], highlight: -1, pendingQuery: null, message: null, attempt: 0,
};

/** True when the query is long enough to search. */
export const isSearchable = (query: string): boolean => query.trim().length >= MIN_QUERY_LENGTH;

/** The list is open (aria-expanded) only while there are results to pick from. */
export const isOpen = (state: AddressSearchState): boolean => state.status === 'results' && state.results.length > 0;

const settled: Pick<AddressSearchState, 'results' | 'highlight' | 'pendingQuery' | 'message'> = {
  results: [], highlight: -1, pendingQuery: null, message: null,
};

export function addressSearchReducer(state: AddressSearchState, action: AddressSearchAction): AddressSearchState {
  switch (action.type) {
    case 'input':
      return {
        ...state, ...settled, query: action.query,
        status: isSearchable(action.query) ? 'typing' : 'idle',
      };
    case 'searchStart':
      if (action.query !== state.query || !isSearchable(action.query)) return state;
      return { ...state, ...settled, status: 'searching', pendingQuery: action.query };
    case 'searchSuccess':
      if (state.status !== 'searching' || action.query !== state.pendingQuery) return state;
      return {
        ...state, ...settled, results: action.results,
        status: action.results.length > 0 ? 'results' : 'empty',
      };
    case 'searchFailure':
      if (action.failure.kind === 'aborted') return state;
      if (state.status !== 'searching' || action.query !== state.pendingQuery) return state;
      if (action.failure.kind === 'unavailable') return { ...state, ...settled, status: 'unavailable' };
      return { ...state, ...settled, status: 'error', message: action.failure.message };
    case 'highlight': {
      const n = state.results.length;
      if (!isOpen(state)) return state;
      const from = state.highlight < 0 ? (action.delta > 0 ? -1 : n) : state.highlight;
      return { ...state, highlight: (from + action.delta + n) % n };
    }
    case 'retry':
      if (!isSearchable(state.query)) return state;
      return { ...state, ...settled, status: 'typing', attempt: state.attempt + 1 };
    case 'close':
      // Esc: hide the list and stop any pending search; the typed text stays.
      return { ...state, ...settled, status: 'idle' };
    case 'choose':
    case 'clear':
      // The typed address is dropped as soon as a home is chosen.
      return { ...initialSearchState, attempt: state.attempt };
  }
}

/** Strips the street address: only the neighborhood and coordinates leave this control. */
export const toHomeChoice = (r: AddressResult): HomeChoice => ({ neighborhood: r.neighborhood, lat: r.lat, lng: r.lng });

/** The home the user would get by choosing `index` (default: the highlighted option), or null. */
export function pickHome(state: AddressSearchState, index: number = state.highlight): HomeChoice | null {
  if (!isOpen(state)) return null;
  const r = state.results[index];
  return r ? toHomeChoice(r) : null;
}

/**
 * Classifies anything a SearchFn rejects with (#598, DECISIONS pass 61). Aborts are silent. The "not
 * available" sentence is only for a 503 with code `google_key_missing` (or a 503 with no code at all). Everything
 * else (`google_unavailable`, a browser timeout, no network, any other answer) is one plain sentence with
 * Retry: the raw message ("Request timed out after 8000 ms", "Request failed (500)") is never shown.
 */
export function describeSearchError(err: unknown, signal?: AbortSignal): SearchFailure {
  if (signal?.aborted) return { kind: 'aborted' };
  const e = (typeof err === 'object' && err !== null ? err : {}) as {
    name?: unknown; status?: unknown; kind?: unknown; code?: unknown; body?: { code?: unknown } | null;
  };
  if (e.name === 'AbortError' || e.kind === 'abort') return { kind: 'aborted' };
  const code = e.code ?? e.body?.code;
  if (e.status === 503 && (code === 'google_key_missing' || code === undefined || code === null)) {
    return { kind: 'unavailable' };
  }
  return { kind: 'error', message: NOT_ANSWERING_TEXT };
}

/** Text for the live status line under the input, or null when nothing needs saying. */
export function statusText(state: AddressSearchState): string | null {
  switch (state.status) {
    case 'searching': return SEARCHING_TEXT;
    case 'empty': return EMPTY_TEXT;
    case 'error': return state.message ?? NOT_ANSWERING_TEXT;
    case 'unavailable': return UNAVAILABLE_TEXT;
    case 'results': {
      const n = state.results.length;
      return `${n} ${n === 1 ? 'address' : 'addresses'} found. Use the arrow keys to choose.`;
    }
    case 'idle':
      return state.query.trim().length > 0 && !isSearchable(state.query) ? SHORT_QUERY_TEXT : null;
    default: return null;
  }
}

/** What a key press in the search input does (#478). Pure, so the keyboard map is tested in Node. */
export type KeyIntent =
  | { kind: 'highlight'; delta: 1 | -1 }
  | { kind: 'choose'; index: number }
  | { kind: 'close' }
  | { kind: 'cancel' }
  /** Enter with nothing highlighted: swallowed so it never submits the surrounding form. */
  | { kind: 'swallow' }
  | { kind: 'none' };

export function keyIntent(
  state: AddressSearchState, key: string, ctx: { hasValue: boolean; editing: boolean },
): KeyIntent {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp':
      return isOpen(state) ? { kind: 'highlight', delta: key === 'ArrowDown' ? 1 : -1 } : { kind: 'none' };
    case 'Enter':
      return isOpen(state) && state.highlight >= 0 ? { kind: 'choose', index: state.highlight } : { kind: 'swallow' };
    case 'Escape':
      if (isOpen(state) || state.status !== 'idle') return { kind: 'close' };
      return ctx.hasValue && ctx.editing ? { kind: 'cancel' } : { kind: 'swallow' };
    default:
      return { kind: 'none' };
  }
}
