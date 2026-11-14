// MVP II home address search (#331): replaces clicking a grid node in the commute editor.
// ARIA combobox pattern; debounced, abortable search through an injected SearchFn.
// Only { neighborhood, lat, lng } ever leaves this control (SPEC MVP II rule 6).
// #598: the control prints neither the home nor a locked sentence. The commute form around it does both,
// once: its group label reads "Home: <neighborhood>" and its message says why a locked run is read-only.
import { useCallback, useEffect, useId, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import {
  DEFAULT_DEBOUNCE_MS, addressSearchReducer, describeSearchError, initialSearchState, isOpen, keyIntent, pickHome, statusText,
  type AddressResult, type AddressSearchAction, type AddressSearchState, type HomeChoice, type SearchFn,
} from './addressSearchModel';
import './AddressSearch.css';

export interface AddressSearchProps {
  search: SearchFn;
  value: HomeChoice | null;
  onChoose(home: HomeChoice): void;
  disabled?: boolean;
  debounceMs?: number;
}

export interface AddressSearchViewProps {
  id: string;
  state: AddressSearchState;
  value: HomeChoice | null;
  /** True while the search input is shown although a home is already saved. */
  editing: boolean;
  disabled?: boolean;
  onInput?(query: string): void;
  onKeyDown?(e: KeyboardEvent<HTMLInputElement>): void;
  onPick?(index: number): void;
  onRetry?(): void;
  onChange?(): void;
  onCancel?(): void;
}

/** Stateless markup for every state; static-render tests use it directly. */
export function AddressSearchView({
  id, state, value, editing, disabled = false, onInput, onKeyDown, onPick, onRetry, onChange, onCancel,
}: AddressSearchViewProps) {
  const inputId = `${id}-input`;
  const listId = `${id}-list`;
  const statusId = `${id}-status`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const open = !disabled && isOpen(state);
  const showSearch = value === null || (editing && !disabled);
  const message = disabled ? null : statusText(state);
  const tone = state.status === 'error' || state.status === 'unavailable' ? ' addr-search__status--problem' : '';

  return (
    <div className="addr-search">
      {value !== null && !showSearch && (
        <div className="addr-search__chosen">
          <button type="button" className="addr-search__btn" onClick={onChange} disabled={disabled}>Change</button>
        </div>
      )}
      {showSearch && (
        <>
          <label className="addr-search__label" htmlFor={inputId}>Home address</label>
          <div className="addr-search__field">
            <input
              id={inputId}
              className="addr-search__input"
              type="text"
              role="combobox"
              autoComplete="off"
              spellCheck={false}
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={open && state.highlight >= 0 ? optionId(state.highlight) : undefined}
              aria-describedby={statusId}
              placeholder="Street and number, New York"
              value={disabled ? '' : state.query}
              readOnly={disabled}
              aria-readonly={disabled || undefined}
              onChange={(e) => onInput?.(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus={editing && value !== null}
            />
            {value !== null && editing && (
              <button type="button" className="addr-search__btn" onClick={onCancel}>Cancel</button>
            )}
          </div>
          <ul id={listId} role="listbox" aria-label="Matching addresses" className="addr-search__list" hidden={!open}>
            {open && state.results.map((r, i) => (
              <li
                key={`${i}-${r.lat},${r.lng}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === state.highlight}
                className={`addr-search__option${i === state.highlight ? ' addr-search__option--active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick?.(i)}
              >
                <span className="addr-search__option-label">{r.label}</span>
                <span className="addr-search__option-hood">{r.neighborhood}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div id={statusId} className={`addr-search__status${tone}`} role="status" aria-live="polite">
        {message}
        {state.status === 'error' && !disabled && (
          <button type="button" className="addr-search__btn" onClick={onRetry}>Retry</button>
        )}
      </div>
    </div>
  );
}

/**
 * Runs one search and reports its outcome for `query` (the query it was started with, so the reducer
 * can drop stale responses). An aborted search dispatches nothing (pass 14: aborts are silent).
 */
export async function runSearch(
  search: SearchFn, query: string, signal: AbortSignal, dispatch: (a: AddressSearchAction) => void,
): Promise<void> {
  try {
    const results: AddressResult[] = await search(query.trim(), signal);
    if (!signal.aborted) dispatch({ type: 'searchSuccess', query, results });
  } catch (err) {
    const failure = describeSearchError(err, signal);
    if (failure.kind !== 'aborted') dispatch({ type: 'searchFailure', query, failure });
  }
}

export function AddressSearch({ search, value, onChoose, disabled = false, debounceMs = DEFAULT_DEBOUNCE_MS }: AddressSearchProps) {
  const id = `addr-${useId().replace(/:/g, '')}`;
  const [state, dispatch] = useReducer(addressSearchReducer, initialSearchState);
  const [editing, setEditing] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  // Latest props in refs, so a parent re-render (e.g. a 1 s poll) never restarts the debounce.
  const searchRef = useRef(search);
  searchRef.current = search;
  const onChooseRef = useRef(onChoose);
  onChooseRef.current = onChoose;

  const abortInFlight = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => abortInFlight, [abortInFlight]);

  const { status, query, attempt } = state;
  useEffect(() => {
    if (status !== 'typing' || disabled) return;
    const timer = setTimeout(() => {
      abortInFlight();
      const controller = new AbortController();
      controllerRef.current = controller;
      dispatch({ type: 'searchStart', query });
      void runSearch(searchRef.current, query, controller.signal, dispatch).finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
      });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [status, query, attempt, disabled, debounceMs, abortInFlight]);

  const choose = (index: number) => {
    const home = pickHome(state, index);
    if (!home) return;
    abortInFlight();
    dispatch({ type: 'choose' });
    setEditing(false);
    onChooseRef.current(home);
  };

  const onInput = (next: string) => {
    abortInFlight();
    dispatch({ type: 'input', query: next });
  };

  const cancel = () => {
    abortInFlight();
    dispatch({ type: 'clear' });
    setEditing(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const intent = keyIntent(state, e.key, { hasValue: value !== null, editing });
    if (intent.kind === 'none') return;
    e.preventDefault();
    if (intent.kind === 'highlight') dispatch({ type: 'highlight', delta: intent.delta });
    else if (intent.kind === 'choose') choose(intent.index);
    else if (intent.kind === 'close') { abortInFlight(); dispatch({ type: 'close' }); }
    else if (intent.kind === 'cancel') cancel();
  };

  return (
    <AddressSearchView
      id={id}
      state={state}
      value={value}
      editing={editing}
      disabled={disabled}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPick={choose}
      onRetry={() => dispatch({ type: 'retry' })}
      onChange={() => setEditing(true)}
      onCancel={cancel}
    />
  );
}
