// #652: the homepage's one large button, "Watch a package". It links to the simulator on the story package
// ("Navy Yard grinder burrs", found by its label in the GET /api/v2/simulator answer) with play=1; without
// that label, to the first relay package by createdSeq; with no relay, and while the answer is loading or
// failed, to the plain simulator. No ID is written in the app code.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing, { WATCH_LABEL } from '../../client/src/pages/Landing';
import {
  WATCH_PACKAGE_LABEL, nycSummaryFrom, watchPackageHref, watchPackageId, type NycSummary,
} from '../../client/src/pages/landingModel';
import { parseSimUrl } from '../../client/src/components/sim/v2/page/urlState';
import {
  businesses, employees, plan, randomSimulator, shipment, simulator, simulatorWith, storySimulator,
} from './landing-nyc-sample';

const summaryOf = (sim: typeof simulator) => nycSummaryFrom(businesses, employees, sim);
const page = (initialSummary?: NycSummary) =>
  renderToStaticMarkup(<MemoryRouter><Landing initialSummary={initialSummary} /></MemoryRouter>);
/** The href of the one link with the button's class; `&amp;` of the markup read back as `&`. */
const buttonHref = (html: string) => {
  const links = [...html.matchAll(/<a ([^>]*class="watch-button"[^>]*)>/g)];
  expect(links).toHaveLength(1);
  return /href="([^"]*)"/.exec(links[0][1])![1].replace(/&amp;/g, '&');
};

describe('watchPackageId: which package the button opens', () => {
  it('the shipment labeled "Navy Yard grinder burrs", although an earlier relay exists', () => {
    expect(WATCH_PACKAGE_LABEL).toBe('Navy Yard grinder burrs');
    expect(watchPackageId(storySimulator)).toBe('shp-3');
  });

  it('the label wins whatever the ID is, so a renumbered run still opens the story package', () => {
    const sim = simulatorWith(
      [shipment('shp-40', 'Tea', 1), shipment('shp-41', WATCH_PACKAGE_LABEL, 2)],
      [plan('shp-40', 'relay'), plan('shp-41', 'relay')],
    );
    expect(watchPackageId(sim)).toBe('shp-41');
  });

  it('without that label: the first relay package by createdSeq, not by list order and never a direct', () => {
    expect(watchPackageId(randomSimulator)).toBe('shp-12');
  });

  it('two packages with the label: the earlier createdSeq', () => {
    const sim = simulatorWith([shipment('shp-9', WATCH_PACKAGE_LABEL, 9), shipment('shp-4', WATCH_PACKAGE_LABEL, 4)], []);
    expect(watchPackageId(sim)).toBe('shp-4');
  });

  it('a label that only looks alike is not the story package', () => {
    const sim = simulatorWith([shipment('shp-1', 'navy yard grinder burrs', 1), shipment('shp-2', 'Navy Yard grinder burrs 2', 2)], []);
    expect(watchPackageId(sim)).toBeNull();
  });

  it('no plans, only direct plans, or a relay plan of a shipment that is not listed: none', () => {
    expect(watchPackageId(simulator)).toBeNull();
    expect(watchPackageId(simulatorWith([shipment('shp-1', 'Tea', 1)], []))).toBeNull();
    expect(watchPackageId(simulatorWith([shipment('shp-1', 'Tea', 1)], [plan('shp-1', 'direct')]))).toBeNull();
    expect(watchPackageId(simulatorWith([shipment('shp-1', 'Tea', 1)], [plan('shp-gone', 'relay')]))).toBeNull();
  });

  it('does not reorder the answer it reads', () => {
    const order = randomSimulator.shipments.map((s) => s.id);
    watchPackageId(randomSimulator);
    expect(randomSimulator.shipments.map((s) => s.id)).toEqual(order);
  });
});

describe('watchPackageHref', () => {
  it('a run with the Navy Yard package: /simulator?package=<its id>&play=1', () => {
    expect(watchPackageHref(summaryOf(storySimulator))).toBe('/simulator?package=shp-3&play=1');
  });
  it('a run without it but with a relay: the first relay package', () => {
    expect(watchPackageHref(summaryOf(randomSimulator))).toBe('/simulator?package=shp-12&play=1');
  });
  it('a run with no plans: the plain simulator', () => {
    expect(watchPackageHref(summaryOf(simulator))).toBe('/simulator');
  });
  it('while loading, after an error and after a 503: the plain simulator', () => {
    for (const s of [{ status: 'loading' }, { status: 'error' }, { status: 'unavailable' }] as NycSummary[]) {
      expect(watchPackageHref(s), s.status).toBe('/simulator');
    }
  });
  it('encodes the ID, and the simulator reads the link back as that package’s journey', () => {
    const odd = summaryOf(simulatorWith([shipment('shp 1&x=2', WATCH_PACKAGE_LABEL, 1)], []));
    const href = watchPackageHref(odd);
    expect(href).toBe('/simulator?package=shp%201%26x%3D2&play=1');
    expect(parseSimUrl(href.slice(href.indexOf('?')))).toEqual({ selection: { kind: 'package', id: 'shp 1&x=2' }, mode: 'journey' });
    expect(new URLSearchParams(href.slice(href.indexOf('?'))).get('play')).toBe('1');
  });
});

describe('the button on the page', () => {
  it.each<[string, NycSummary | undefined, string]>([
    ['a run with the Navy Yard package', summaryOf(storySimulator), '/simulator?package=shp-3&play=1'],
    ['a run without it but with a relay', summaryOf(randomSimulator), '/simulator?package=shp-12&play=1'],
    ['a run with no plans', summaryOf(simulator), '/simulator'],
    ['while loading (no summary yet)', undefined, '/simulator'],
    ['while loading', { status: 'loading' }, '/simulator'],
    ['after a failed load', { status: 'error' }, '/simulator'],
    ['after a 503', { status: 'unavailable' }, '/simulator'],
  ])('%s: a link named "Watch a package" to the right place', (_name, summary, href) => {
    const h = page(summary);
    expect(buttonHref(h)).toBe(href);
    const body = /<a [^>]*class="watch-button"[^>]*>([\s\S]*?)<\/a>/.exec(h)![1];
    expect(body.replace(/<svg[\s\S]*?<\/svg>/, '')).toBe(WATCH_LABEL); // the icon is hidden from the name
    expect(body).toMatch(/<svg [^>]*aria-hidden="true"/);
    expect(h).not.toMatch(/<a [^>]*class="watch-button"[^>]*(aria-disabled|tabindex)/); // always in the tab order
  });

  it('is the first link of the page, before Business and Employee', () => {
    const h = page(summaryOf(storySimulator));
    const classes = [...h.matchAll(/<a [^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(classes).toEqual(['watch-button', 'workspace-entry', 'workspace-entry', 'landing-more-link']);
  });
});

describe('no package ID in the homepage code', () => {
  it.each(['client/src/pages/Landing.tsx', 'client/src/pages/landingModel.ts'])('%s names no shipment ID', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/shp-/);
  });
});
