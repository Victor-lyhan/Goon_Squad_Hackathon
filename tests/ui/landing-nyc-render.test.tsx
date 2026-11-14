import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing, { type SummaryFacts } from '../../client/src/pages/Landing';
import { nycSummaryFrom, nycSummaryFromError, type NycSummary } from '../../client/src/pages/landingModel';
import { ApiRequestError } from '../../client/src/api/v2';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { snapshotAt } from '../../server/domain/simulation';
import { businesses, employees, simulator } from './landing-nyc-sample';

const page = (props: Parameters<typeof Landing>[0]) =>
  renderToStaticMarkup(<MemoryRouter><Landing {...props} /></MemoryRouter>);

const workspaceLinks = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)]
    .filter((x) => /class="workspace-entry"/.test(x[1]))
    .map((x) => /href="([^"]*)"/.exec(x[1])?.[1]);
const summaryOf = (html: string) => /<section class="op-summary"[\s\S]*?<\/section>/.exec(html)![0];
const values = (html: string) => [...html.matchAll(/<dd class="op-summary-value">([^<]*)<\/dd>/g)].map((x) => x[1]);

const ready = nycSummaryFrom(businesses, employees, simulator);
const unavailable = nycSummaryFromError(new ApiRequestError(503, 'x', undefined, 'http', 'travel_data_missing'));

describe('default dataset is unchanged', () => {
  const run = createInitialRun(loadDefaultScenario());
  const { businesses: b, employees: e, hubs } = run.scenario;
  const m = snapshotAt(run, run.clock.timeMin).metrics;
  const facts: SummaryFacts = {
    status: 'ready', businesses: b.length, commuters: e.length, relayPoints: hubs.length, matched: m.matched, requested: m.requested,
  };
  it('dataset="synthetic" renders exactly what no prop renders', () => {
    for (const props of [{}, { initial: { businesses: b, employees: e }, initialFacts: facts }]) {
      expect(page({ ...props, dataset: 'synthetic' })).toBe(page(props));
    }
  });
  it('keeps the MVP 1 links and footer', () => {
    const h = page({ initial: { businesses: b, employees: e }, initialFacts: facts });
    expect(workspaceLinks(h)).toEqual([`/business/${encodeURIComponent(b[0].id)}`, `/employee/${encodeURIComponent(e[0].id)}`, '/simulator']);
    expect(h).toContain('Simulated environment. No real deliveries are made.');
    expect(h).not.toContain('Real NYC locations');
  });
});

describe('dataset="nyc" with sample /api/v2 responses', () => {
  const h = page({ dataset: 'nyc', initialSummary: ready });

  it('shows the four numbers: businesses, commuters, relay points = businesses, matched / requested from metrics', () => {
    expect(values(h)).toEqual(['5', '3', '5', '19 / 24']);
    expect(summaryOf(h)).toContain('Relay points');
    expect(h).not.toMatch(/NaN|undefined/);
  });

  it('links the entries to the main paths (#548)', () => {
    expect(workspaceLinks(h)).toEqual([`/business/${businesses.businesses[0].id}`, '/employee/emp-7', '/simulator']);
    expect(h.match(/Open workspace/g)).toHaveLength(3);
    expect(h).not.toContain('aria-disabled="true"');
    expect(h).not.toContain('href="/nyc');
  });

  it('says relay point, never hub, and labels the data as real NYC locations', () => {
    expect(h).toContain('relay point');
    expect(h).not.toMatch(/hub/i);
    expect(h).toContain('<p class="landing-indicator">Real NYC locations · simulated deliveries</p>');
    expect(h).toMatch(/<footer class="landing-footer"><span>Real NYC locations · simulated deliveries<\/span>/);
    expect(h).not.toContain('Synthetic city');
    expect(h).toMatch(/<a [^>]*href="\/help"[^>]*>Guided demo<\/a>/);
  });

  it('never mentions demo accounts (no MVP 1 directory load)', () => {
    expect(h).not.toContain('demo accounts');
  });
});

describe('dataset="nyc" states', () => {
  it('503: one line, no numbers, no dashes, entries still visible', () => {
    expect(unavailable).toEqual({ status: 'unavailable' });
    const h = page({ dataset: 'nyc', initialSummary: unavailable });
    const s = summaryOf(h);
    expect(s).toContain('NYC travel data is not loaded on this server yet.');
    expect(s.replace(/<[^>]+>/g, '')).toBe('NYC travel data is not loaded on this server yet.');
    expect(s).not.toMatch(/\d|–|NaN|<dd/);
    expect(h).not.toMatch(/NaN|undefined/);
    expect(h.match(/Open workspace/g)).toHaveLength(3);
    expect(workspaceLinks(h)).toEqual(['/simulator']);
  });

  it('a non-503 failure is the plain error line, not the 503 one', () => {
    const err = nycSummaryFromError(new ApiRequestError(500, 'boom'));
    expect(err).toEqual({ status: 'error' });
    const h = page({ dataset: 'nyc', initialSummary: err });
    expect(h).toContain('Live numbers unavailable');
    expect(h).not.toContain('NYC travel data is not loaded');
  });

  it('loading: placeholders marked busy, Simulator still a link, no numbers', () => {
    const loading: NycSummary = { status: 'loading' };
    for (const h of [page({ dataset: 'nyc', initialSummary: loading }), page({ dataset: 'nyc' })]) {
      expect(h).toContain('aria-busy="true"');
      expect(h).toContain('is-placeholder');
      expect(summaryOf(h)).not.toMatch(/\d/);
      expect(workspaceLinks(h)).toEqual(['/simulator']);
      expect(h.match(/Open workspace/g)).toHaveLength(3);
    }
  });
});
