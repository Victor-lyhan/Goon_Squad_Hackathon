import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing from '../../client/src/pages/Landing';
import { nycSummaryFrom, nycSummaryFromError, type NycSummary } from '../../client/src/pages/landingModel';
import { ENV_LABELS } from '../../client/src/ui/shellModel';
import { ApiRequestError } from '../../client/src/api/v2';
import { businesses, employees, simulator } from './landing-nyc-sample';

const page = (props: Parameters<typeof Landing>[0]) =>
  renderToStaticMarkup(<MemoryRouter><Landing {...props} /></MemoryRouter>);

const workspaceLinks = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)]
    .filter((x) => /class="workspace-entry"/.test(x[1]))
    .map((x) => /href="([^"]*)"/.exec(x[1])?.[1]);
const summaryOf = (html: string) => /<section class="op-summary"[\s\S]*?<\/section>/.exec(html)![0];
const text = (html: string) => html.replace(/<[^>]+>/g, '');
const values = (html: string) => [...html.matchAll(/<span class="op-summary-value">([^<]*)<\/span>/g)].map((x) => x[1]);

const ready = nycSummaryFrom(businesses, employees, simulator);
const unavailable = nycSummaryFromError(new ApiRequestError(503, 'x', undefined, 'http', 'travel_data_missing'));

describe('the homepage with sample /api/v2 responses', () => {
  const h = page({ dataset: 'nyc', initialSummary: ready });

  it('shows the stats as one line: businesses, commuters, matched of requested from the metrics', () => {
    expect(values(h)).toEqual(['5', '3', '19', '24']);
    expect(text(summaryOf(h))).toBe('5 businesses3 commuters19 of 24 packages matched'); // the dots between are CSS
    expect(summaryOf(h).match(/<li>/g)).toHaveLength(3);
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

  it('does not repeat the environment line: the header says it, the page has no footer (#724, was #610)', () => {
    expect(h).not.toContain(ENV_LABELS.nyc);
    expect(h).not.toContain('<footer');
    const intro = /<section class="landing-intro">([\s\S]*?)<\/section>/.exec(h)![1];
    expect(intro.match(/<h1>/g)).toHaveLength(1);
    expect(intro).not.toMatch(/<p[ >]/);
    // in every state, also while the numbers are missing
    for (const s of [{ status: 'loading' }, { status: 'error' }, unavailable] as NycSummary[]) {
      expect(page({ initialSummary: s }), s.status).not.toContain(ENV_LABELS.nyc);
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
  it('503: one line, no numbers, no dashes, the button and both entries still visible', () => {
    expect(unavailable).toEqual({ status: 'unavailable' });
    const h = page({ dataset: 'nyc', initialSummary: unavailable });
    const s = summaryOf(h);
    expect(s).toContain('NYC travel data is not loaded on this server yet.');
    expect(text(s)).toBe('NYC travel data is not loaded on this server yet.');
    expect(s).not.toMatch(/\d|–|NaN|<li/);
    expect(h).not.toMatch(/NaN|undefined/);
    expect(h).toContain('Watch a package');
    expect(h.match(/class="workspace-entry is-disabled"/g)).toHaveLength(2);
    expect(workspaceLinks(h)).toEqual([]);
  });

  it('a non-503 failure is the plain error line, not the 503 one', () => {
    const err = nycSummaryFromError(new ApiRequestError(500, 'boom'));
    expect(err).toEqual({ status: 'error' });
    const h = page({ dataset: 'nyc', initialSummary: err });
    expect(text(summaryOf(h))).toBe('Live numbers unavailable');
    expect(h).not.toContain('NYC travel data is not loaded');
  });

  it('loading: one line of placeholders marked busy, no numbers, Business and Employee not links yet', () => {
    const loading: NycSummary = { status: 'loading' };
    for (const h of [page({ dataset: 'nyc', initialSummary: loading }), page({ dataset: 'nyc' })]) {
      expect(h).toContain('aria-busy="true"');
      expect(h).toContain('is-placeholder');
      expect(summaryOf(h)).not.toMatch(/\d/);
      expect(text(summaryOf(h))).toBe('– businesses– commuters– of – packages matched');
      expect(workspaceLinks(h)).toEqual([]);
      expect(h.match(/aria-disabled="true"/g)).toHaveLength(2);
    }
  });
});
