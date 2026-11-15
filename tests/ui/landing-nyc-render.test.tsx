import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing from '../../client/src/pages/Landing';
import { nycSummaryFrom, nycSummaryFromError, type NycSummary } from '../../client/src/pages/landingModel';
import { ApiRequestError } from '../../client/src/api/v2';
import { businesses, employees, simulator } from './landing-nyc-sample';

/** The line the header's top right held until #854 (the homepage lost it in #833). */
const OLD_ENV_TEXT = 'Real NYC locations · simulated deliveries';

const page = (props: Parameters<typeof Landing>[0]) =>
  renderToStaticMarkup(<MemoryRouter><Landing {...props} /></MemoryRouter>);

const workspaceLinks = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)]
    .filter((x) => /class="workspace-entry"/.test(x[1]))
    .map((x) => /href="([^"]*)"/.exec(x[1])?.[1]);
/** The line under the two entries after a failed load; null when the page shows none. */
const noteOf = (html: string) => /<p class="landing-note" role="status">([^<]*)<\/p>/.exec(html)?.[1] ?? null;
/** The page's text without the drawing (its only digits would be in the SVG's coordinates, which are attributes anyway). */
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '');

const ready = nycSummaryFrom(businesses, employees, simulator);
const unavailable = nycSummaryFromError(new ApiRequestError(503, 'x', undefined, 'http', 'travel_data_missing'));

describe('the homepage with sample /api/v2 responses', () => {
  const h = page({ dataset: 'nyc', initialSummary: ready });

  it('shows no stats line and no number of the run: the footer is gone (#833)', () => {
    expect(h).not.toContain('op-summary');
    expect(text(h).replace(/\D/g, '')).toBe('123'); // the step numbers of "How it works", nothing counted
    expect(text(h)).not.toMatch(/businesses|commuters|packages matched/);
    expect(noteOf(h)).toBeNull();
    expect(h).not.toMatch(/NaN|undefined/);
  });

  it('links Business and Employee to the main paths (#548), and has no Simulator entry: the button is the way in', () => {
    expect(workspaceLinks(h)).toEqual([`/business/${businesses.businesses[0].id}`, '/employee/emp-7']);
    expect(h).not.toContain('aria-disabled="true"');
    expect(h).not.toContain('href="/nyc');
    expect(h).not.toContain('Open workspace');
  });

  it('never says hub or a synthetic city, and has no Guided demo link (#652)', () => {
    expect(h).not.toMatch(/hub/i);
    expect(h).not.toContain('Synthetic city');
    expect(h).not.toContain('Guided demo');
    expect(h).not.toContain('/help');
  });

  it('does not say the environment line, and has no footer (#724, #833)', () => {
    expect(h).not.toContain(OLD_ENV_TEXT);
    expect(h).not.toContain('<footer');
    const copy = /<div class="landing-hero-copy">([\s\S]*?)<\/div>/.exec(h)![1];
    expect(copy.match(/<h1[ >]/g)).toHaveLength(1);
    expect(copy).not.toMatch(/<p[ >]/);
    // in every state, also after a failed load
    for (const s of [{ status: 'loading' }, { status: 'error' }, unavailable] as NycSummary[]) {
      expect(page({ initialSummary: s }), s.status).not.toContain(OLD_ENV_TEXT);
    }
  });

  it('no longer shows a Relay points number or its note: the strip is one line (#652)', () => {
    expect(h).not.toMatch(/relay points/i);
    expect(h).not.toContain('every network business');
  });

  it('never mentions demo accounts (no MVP 1 directory load)', () => {
    expect(h).not.toContain('demo accounts');
  });
});

describe('the homepage states', () => {
  it('503: one line under the entries, the button and both entries still visible', () => {
    expect(unavailable).toEqual({ status: 'unavailable' });
    const h = page({ dataset: 'nyc', initialSummary: unavailable });
    expect(noteOf(h)).toBe('NYC travel data is not loaded on this server yet.');
    expect(h).not.toMatch(/NaN|undefined/);
    expect(h).toContain('Watch a package');
    expect(h.match(/class="workspace-entry is-disabled"/g)).toHaveLength(2);
    expect(workspaceLinks(h)).toEqual([]);
  });

  it('a non-503 failure is the plain error line, not the 503 one', () => {
    const err = nycSummaryFromError(new ApiRequestError(500, 'boom'));
    expect(err).toEqual({ status: 'error' });
    const h = page({ dataset: 'nyc', initialSummary: err });
    expect(noteOf(h)).toBe('Accounts unavailable');
    expect(h).not.toContain('NYC travel data is not loaded');
  });

  it('loading: no line, Business and Employee not links yet', () => {
    const loading: NycSummary = { status: 'loading' };
    for (const h of [page({ dataset: 'nyc', initialSummary: loading }), page({ dataset: 'nyc' })]) {
      expect(noteOf(h)).toBeNull();
      expect(workspaceLinks(h)).toEqual([]);
      expect(h.match(/aria-disabled="true"/g)).toHaveLength(2);
    }
  });
});
