// #955: the homepage quotes the study ("See the numbers" with one big headline figure). The browser never
// computes a metric (AGENTS.md), so the figures are copy in Landing.tsx, and this test is what keeps that copy
// true: it reads the committed study page (client/public/study.html, written by `npm run study`) and fails
// when the homepage no longer says what the page's own headline tiles say.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Numbers, STUDY_FIGURE, STUDY_FIGURE_TEXT, STUDY_HEADLINE, STUDY_HREF, STUDY_NOTE,
} from '../../client/src/pages/Landing';
import { headlineTiles } from '../../scripts/study/page';

const study = readFileSync('client/public/study.html', 'utf8');
const tiles = headlineTiles(study);
const tile = (label: string) => tiles.find((t) => t.label === label);
/** "77.0% less" -> 77; anything else (also "… more") is not a saving and gives NaN. */
const lessPercent = (value: string | undefined) => {
  const m = /^(\d+(?:\.\d+)?)% less$/.exec(value ?? '');
  return m ? Math.round(Number(m[1])) : Number.NaN;
};
const text = (html: string) => html.replace(/<[^>]+>/g, '');

describe('the homepage\'s headline figure is the study page\'s own (#955)', () => {
  it('the study page has the two tiles the homepage quotes, each a saving', () => {
    expect(tiles.map((t) => t.label)).toEqual(expect.arrayContaining(['CO₂', 'Cost to the sender']));
    expect(tile('CO₂')!.value).toMatch(/^\d+\.\d% less$/);
    expect(tile('Cost to the sender')!.value).toMatch(/^\d+\.\d% less$/);
    // Both are per package, against the courier: what the homepage's words say.
    expect(tile('CO₂')!.detail).toMatch(/^Relay .+ vs courier .+ per package$/);
    expect(tile('Cost to the sender')!.detail).toMatch(/^Relay .+ vs courier .+ per package$/);
    expect(study).toContain('a standard next-day courier');
  });

  it('the big figure is the CO₂ tile, rounded to a whole percent', () => {
    expect(STUDY_HEADLINE.co2LessPercent).toBe(lessPercent(tile('CO₂')!.value));
    expect(STUDY_FIGURE).toBe(`${lessPercent(tile('CO₂')!.value)}%`);
    expect(STUDY_FIGURE_TEXT).toBe('less CO2 per package than a next-day courier');
  });

  it('the line under it gives the cost tile, rounded the same way, and the study\'s number of simulations', () => {
    expect(STUDY_HEADLINE.costLessPercent).toBe(lessPercent(tile('Cost to the sender')!.value));
    const simulations = /([\d,]+) simulations/.exec(text(study))?.[1];
    expect(simulations).toMatch(/^\d{1,3}(,\d{3})*$/);
    expect(STUDY_HEADLINE.simulations).toBe(simulations);
    // One row of the committed CSV per simulation (and the header row).
    const rows = readFileSync('client/public/study/runs.csv', 'utf8').trimEnd().split('\n').length - 1;
    expect(rows).toBe(Number(simulations!.replace(/,/g, '')));
    expect(STUDY_NOTE).toBe(`And ${STUDY_HEADLINE.costLessPercent}% less cost to the sender. Averages over ${simulations} simulations.`);
  });

  it('the section shows exactly these numbers and links to the page they come from', () => {
    const html = renderToStaticMarkup(<Numbers />);
    expect(text(html).match(/\d[\d,.]*%?/g)).toEqual([
      STUDY_FIGURE, '2', `${STUDY_HEADLINE.costLessPercent}%`, STUDY_HEADLINE.simulations,
    ]);
    expect(html).toContain(`href="${STUDY_HREF}"`);
    expect(STUDY_HREF).toBe('/study.html');
  });

  it('the reader of a saving refuses anything that is not one', () => {
    expect(lessPercent('77.0% less')).toBe(77);
    expect(lessPercent('54.8% less')).toBe(55);
    expect(lessPercent('20.0% more')).toBeNaN();
    expect(lessPercent(undefined)).toBeNaN();
  });
});
