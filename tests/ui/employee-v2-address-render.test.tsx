import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AddressSearch, AddressSearchView, runSearch } from '../../client/src/components/employee/v2/AddressSearch';
import {
  EMPTY_TEXT, NOT_ANSWERING_TEXT, UNAVAILABLE_TEXT, addressSearchReducer as reduce, describeSearchError, initialSearchState,
  type AddressResult, type AddressSearchAction, type AddressSearchState, type HomeChoice,
} from '../../client/src/components/employee/v2/addressSearchModel';

const R: AddressResult[] = [
  { label: '31-10 Steinway St, Queens, NY 11103', neighborhood: 'Astoria', lat: 40.7605, lng: -73.9174 },
  { label: '310 Grand St, Brooklyn, NY 11211', neighborhood: 'Williamsburg', lat: 40.7128, lng: -73.9573 },
];
const Q = '31 steinway';
const run = (actions: AddressSearchAction[]) => actions.reduce(reduce, initialSearchState);
const typed: AddressSearchAction = { type: 'input', query: Q };
const started: AddressSearchAction = { type: 'searchStart', query: Q };
const fail = (err: unknown): AddressSearchAction => ({ type: 'searchFailure', query: Q, failure: describeSearchError(err) });

const states: Record<string, AddressSearchState> = {
  idle: initialSearchState,
  searching: run([typed, started]),
  results: run([typed, started, { type: 'searchSuccess', query: Q, results: R }, { type: 'highlight', delta: 1 }, { type: 'highlight', delta: 1 }]),
  empty: run([typed, started, { type: 'searchSuccess', query: Q, results: [] }]),
  error: run([typed, started, fail(Object.assign(new Error('Geocoding failed (500).'), { status: 500 }))]),
  unavailable: run([typed, started, fail(Object.assign(new Error('no key'), { status: 503 }))]),
};
const home: HomeChoice = { neighborhood: 'Astoria', lat: 40.7605, lng: -73.9174 };

const render = (state: AddressSearchState, opts: { value?: HomeChoice | null; editing?: boolean; disabled?: boolean } = {}) => {
  const html = renderToStaticMarkup(
    <AddressSearchView id="t" state={state} value={opts.value ?? null} editing={opts.editing ?? false} disabled={opts.disabled} />,
  );
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"') };
};
const combobox = (html: string) => html.match(/<input[^>]*role="combobox"[^>]*>/)?.[0] ?? '';

describe('AddressSearch static states', () => {
  it('idle: a labelled combobox, collapsed, controlling a hidden listbox', () => {
    const { html } = render(states.idle);
    const input = combobox(html);
    expect(html).toContain('<label class="addr-search__label" for="t-input">Home address</label>');
    expect(input).toContain('id="t-input"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('aria-controls="t-list"');
    expect(input).not.toContain('aria-activedescendant');
    expect(html).toMatch(/<ul id="t-list" role="listbox"[^>]*hidden=""/);
    expect(html).not.toContain('role="option"');
  });

  it('searching: collapsed with a live status', () => {
    const { html, text } = render(states.searching);
    expect(combobox(html)).toContain('aria-expanded="false"');
    expect(combobox(html)).toContain(`value="${Q}"`);
    expect(html).toContain('role="status"');
    expect(text).toContain('Searching');
  });

  it('results: expanded, options, highlighted option is the active descendant', () => {
    const { html, text } = render(states.results);
    const input = combobox(html);
    expect(input).toContain('aria-expanded="true"');
    expect(input).toContain('aria-activedescendant="t-opt-1"');
    expect(html).toMatch(/<ul id="t-list" role="listbox"(?![^>]*hidden)/);
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html).toMatch(/id="t-opt-1" role="option" aria-selected="true"/);
    expect(html).toMatch(/id="t-opt-0" role="option" aria-selected="false"/);
    expect(text).toContain('Williamsburg');
    expect(text).toContain('310 Grand St');
  });

  it('empty: collapsed with the no-address message', () => {
    const { html, text } = render(states.empty);
    expect(combobox(html)).toContain('aria-expanded="false"');
    expect(text).toContain(EMPTY_TEXT);
    expect(html).not.toContain('role="option"');
  });

  it('error: the message and a Retry button', () => {
    const { html, text } = render(states.error);
    expect(combobox(html)).toContain('aria-expanded="false"');
    expect(text).toContain(NOT_ANSWERING_TEXT);
    expect(text).not.toContain('500'); // the raw message never shows (#598)
    expect(html).toMatch(/<button type="button"[^>]*>Retry<\/button>/);
  });

  it('unavailable: the Google key message, no Retry', () => {
    const { html, text } = render(states.unavailable);
    expect(combobox(html)).toContain('aria-expanded="false"');
    expect(text).toContain(UNAVAILABLE_TEXT);
    expect(html).not.toContain('Retry');
  });

  it('chosen: shows Change only, never the address; the form around it prints the home once (#598)', () => {
    // Even with a stale typed query in state, the chosen view shows no address.
    const { html, text } = render(states.results, { value: home });
    expect(text).not.toContain('Home:');
    expect(text).not.toContain('Astoria');
    expect(html).toMatch(/<button type="button"[^>]*>Change<\/button>/);
    expect(html).not.toContain('role="combobox"');
    for (const r of R) expect(html).not.toContain(r.label);
    expect(html).not.toContain(Q);
    expect(html).not.toContain('Steinway');
  });

  it('changing a saved home shows the search again with a Cancel button', () => {
    const { html } = render(initialSearchState, { value: home, editing: true });
    expect(html).toContain('role="combobox"');
    expect(html).toContain('>Cancel</button>');
  });

  it('disabled: read-only input, no list and no sentence of its own (#598)', () => {
    const { html, text } = render(states.results, { disabled: true });
    const input = combobox(html);
    expect(input).toContain('readOnly=""');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('value=""');
    expect(html).not.toContain('role="option"');
    expect(text.replace(/\s+/g, ' ').trim()).toBe('Home address');
  });

  it('disabled with a saved home: Change is disabled', () => {
    const { html, text } = render(initialSearchState, { value: home, disabled: true });
    expect(html).toMatch(/<button type="button"[^>]*disabled=""[^>]*>Change<\/button>/);
    expect(text.replace(/\s+/g, ' ').trim()).toBe('Change');
  });
});

describe('AddressSearch component', () => {
  const search = async () => R;
  it('renders idle without a value and never calls search during render', () => {
    let calls = 0;
    const html = renderToStaticMarkup(<AddressSearch search={async () => { calls += 1; return R; }} value={null} onChoose={() => {}} />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(calls).toBe(0);
  });

  it('renders Change, not the search, when the value prop holds a home', () => {
    const html = renderToStaticMarkup(<AddressSearch search={search} value={home} onChoose={() => {}} />);
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain('>Change</button>');
  });
});

describe('AddressSearch.css', () => {
  const css = readFileSync('client/src/components/employee/v2/AddressSearch.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('keeps corners square: no radius over 4px', () => {
    const radii = [...css.matchAll(/border-radius\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) {
      for (const px of r.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px[1])).toBeLessThanOrEqual(4);
      expect(r).not.toMatch(/%|rem|em\b/);
    }
  });

  it('has no box-shadow other than a 1px focus ring, and no gradients', () => {
    const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    for (const s of shadows) expect(s).toMatch(/^0 0 0 1px /);
    expect(css).not.toMatch(/gradient/);
  });

  it('reads tokens with fallbacks and has a 390 px rule with 40 px+ touch targets', () => {
    expect(css).toContain('var(--accent, #1D5075)');
    expect(css).toContain('var(--radius, 4px)');
    expect(css).toMatch(/@media \(max-width: 390px\)/);
    expect(css).toMatch(/min-height: 4\dpx/);
  });
});

describe('runSearch', () => {
  const collect = () => { const out: AddressSearchAction[] = []; return { out, dispatch: (a: AddressSearchAction) => { out.push(a); } }; };

  it('reports results for the query it was started with and sends the trimmed text', async () => {
    const { out, dispatch } = collect();
    let sent = '';
    await runSearch(async (q) => { sent = q; return R; }, '  31 steinway ', new AbortController().signal, dispatch);
    expect(sent).toBe('31 steinway');
    expect(out).toEqual([{ type: 'searchSuccess', query: '  31 steinway ', results: R }]);
  });

  it('is silent when aborted, before or after the response', async () => {
    const { out, dispatch } = collect();
    const ctrl = new AbortController();
    const p = runSearch((_q, signal) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }), Q, ctrl.signal, dispatch);
    ctrl.abort();
    await p;
    const late = new AbortController();
    await runSearch(async () => { late.abort(); return R; }, Q, late.signal, dispatch);
    expect(out).toEqual([]);
  });

  it('turns rejections and synchronous throws into failures', async () => {
    const { out, dispatch } = collect();
    await runSearch(async () => { throw Object.assign(new Error('no key'), { status: 503 }); }, Q, new AbortController().signal, dispatch);
    await runSearch(() => { throw new Error('bad'); }, Q, new AbortController().signal, dispatch);
    expect(out).toEqual([
      { type: 'searchFailure', query: Q, failure: { kind: 'unavailable' } },
      { type: 'searchFailure', query: Q, failure: { kind: 'error', message: NOT_ANSWERING_TEXT } },
    ]);
  });
});
