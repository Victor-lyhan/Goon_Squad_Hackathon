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
export const UNAVAILABLE_TEXT = 'Address search needs the Google key on the server. Your saved home is unchanged.';
export const SEARCHING_TEXT = 'Searching…';
export const SHORT_QUERY_TEXT = 'Type at least 3 characters to search.';
export const GENERIC_ERROR_TEXT = 'Address search failed. Try again.';

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

/** Classifies anything a SearchFn rejects with. Aborts are silent; HTTP 503 means no Google key on the server. */
export function describeSearchError(err: unknown, signal?: AbortSignal): SearchFailure {
  if (signal?.aborted) return { kind: 'aborted' };
  const e = err as { name?: unknown; status?: unknown; kind?: unknown; message?: unknown } | null;
  if (e && (e.name === 'AbortError' || e.kind === 'abort')) return { kind: 'aborted' };
  if (e && e.status === 503) return { kind: 'unavailable' };
  const message = e && typeof e.message === 'string' && e.message.trim() ? e.message : GENERIC_ERROR_TEXT;
  return { kind: 'error', message };
}

/** Text for the live status line under the input, or null when nothing needs saying. */
export function statusText(state: AddressSearchState): string | null {
  switch (state.status) {
    case 'searching': return SEARCHING_TEXT;
    case 'empty': return EMPTY_TEXT;
    case 'error': return state.message ?? GENERIC_ERROR_TEXT;
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
