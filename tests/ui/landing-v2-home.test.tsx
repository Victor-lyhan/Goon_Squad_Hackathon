import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing, {
  HOW_STEPS, HOW_TITLE, HowItWorks, LANDING_TITLE, LandingTitle, LoadNote, STUDY_HREF, STUDY_LABEL, WORKSPACES,
} from '../../client/src/pages/Landing';
import { HERO_LEGEND } from '../../client/src/pages/LandingHeroMap';
import type { NycSummary } from '../../client/src/pages/landingModel';

const page = (props: Parameters<typeof Landing>[0]) =>
  renderToStaticMarkup(<MemoryRouter><Landing {...props} /></MemoryRouter>);

const workspaceLinks = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)]
    .filter((x) => /class="workspace-entry"/.test(x[1]))
    .map((x) => ({ href: /href="([^"]*)"/.exec(x[1])?.[1], body: x[2] }));
const text = (html: string) => html.replace(/<[^>]+>/g, '');
/** The title alone. React puts a preload hint for the logo in front of a fragment's markup; it is not part of the h1. */
const titleMarkup = () => renderToStaticMarkup(<LandingTitle />).replace(/^<link rel="preload" as="image" [^>]*>/, '');

describe('homepage content (#833)', () => {
  const summary: NycSummary = {
    status: 'ready',
    businessIds: ['biz-a', 'biz-b'], employeeIds: ['emp-a', 'emp-b'], watchPackageId: 'shp-3',
  };
  const html = page({ initialSummary: summary });
  const copy = /<div class="landing-hero-copy">([\s\S]*?)<\/div>/.exec(html)![1];

  it('has the title as its only h1, first in the text column, with no logo of its own next to it (#853)', () => {
    expect(LANDING_TITLE).toBe('Relay: packages ride the commute, cheaper and greener');
    expect(copy.startsWith(titleMarkup())).toBe(true);
    expect(copy.startsWith('<h1 id="landing-title" ')).toBe(true);
    // The only picture of the page is the one inside the title: the separate logo above it is gone.
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(/<h1[\s\S]*?<\/h1>/.exec(html)![0]).toContain('<img ');
    expect(html).not.toContain('class="landing-logo"');
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('<section class="landing-hero" aria-labelledby="landing-title">');
    // nothing else next to the title but the button and the two entries: no paragraph, no environment line
    expect(copy).not.toMatch(/<p[ >]/);
    expect(text(copy)).toBe(`${LANDING_TITLE}Watch a package${WORKSPACES.map((w) => `${w.title}${w.text}→`).join('')}`);
  });

  it('the hero is one centered column that holds the text and the map, and nothing else (#853)', () => {
    const hero = /<section class="landing-hero"[^>]*>([\s\S]*?)<\/section>/.exec(html)![1];
    expect(hero.startsWith('<div class="landing-hero-inner"><div class="landing-hero-copy">')).toBe(true);
    expect(hero.endsWith('</ul></div></div>')).toBe(true); // the map's key, the map, the column
    expect(hero.match(/class="landing-hero-(inner|copy|map)"/g)).toEqual([
      'class="landing-hero-inner"', 'class="landing-hero-copy"', 'class="landing-hero-map"',
    ]);
  });

  it('has the parts in order: the title, the button, Business and Employee, the map, How it works, See the numbers', () => {
    const at = ['<h1', 'class="watch-button"', 'class="workspaces"', 'class="landing-hero-map"', 'class="landing-how"', 'class="numbers-button"']
      .map((part) => html.indexOf(part));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('is two sections, the hero and "How it works": no footer, no stats line, no environment line', () => {
    expect(html.match(/<section /g)).toHaveLength(2);
    expect(html).not.toContain('Real NYC locations · simulated deliveries');
    expect(html).not.toContain('<footer');
    expect(html).not.toContain('op-summary');
    expect(html).not.toMatch(/packages matched|commuters/);
    expect(html.endsWith(`${STUDY_LABEL}</a></section></div>`)).toBe(true);
  });

  it('has exactly two smaller entries, Business then Employee, each one link with a short line', () => {
    expect(WORKSPACES.map((w) => w.key)).toEqual(['business', 'employee']);
    const links = workspaceLinks(html);
    expect(links).toHaveLength(2);
    expect(links[0].href).toBe('/business/biz-a');
    expect(links[1].href).toBe('/employee/emp-a');
    ['Business', 'Employee'].forEach((t, i) => {
      expect(links[i].body).toContain(`<span class="workspace-title">${t}</span>`);
      expect(text(links[i].body)).toBe(`${t}${WORKSPACES[i].text}→`);
      expect(WORKSPACES[i].text.length).toBeLessThanOrEqual(40);
    });
    expect(html.match(/<a /g)).toHaveLength(4); // the button, the two entries and "See the numbers", nothing else
  });

  it('contains none of the removed content or broken values', () => {
    for (const gone of ['Guided demo', '/help', 'Open workspace', '03 / SIMULATOR', 'Run the demo', 'Current city', 'The numbers', 'Live numbers']) {
      expect(html, gone).not.toContain(gone);
    }
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('takes no helpPath prop and exports no HELP_PATH (#652)', () => {
    const src = readFileSync('client/src/pages/Landing.tsx', 'utf8');
    expect(src).not.toMatch(/helpPath|HELP_PATH|Guided demo/);
    // @ts-expect-error the prop is gone
    page({ helpPath: '/somewhere' });
  });
});

describe('the title with the logo as its R (#853)', () => {
  const h1 = titleMarkup();

  it('draws the logo in place of the R, directly before "elay:", inside one word', () => {
    expect(h1).toBe(
      `<h1 id="landing-title" aria-label="${LANDING_TITLE}">`
      + '<span class="landing-title-word">'
      + '<img class="landing-title-logo" src="/brand/relay-logo.png" alt="" width="40" height="40"/>'
      + '<span class="ui-sr-only">R</span>elay:</span>'
      + ' packages ride the commute, cheaper and greener</h1>',
    );
  });

  it('a screen reader hears "Relay": the logo is decorative, the R is in the text, and the label is the whole title', () => {
    expect(/<img [^>]*>/.exec(h1)![0]).toContain(' alt=""');
    expect(h1).not.toMatch(/aria-hidden|role=/); // nothing of the title is taken away from a screen reader
    expect(text(h1)).toBe(LANDING_TITLE); // the text of the heading is still the title, letter for letter
    expect(/aria-label="([^"]*)"/.exec(h1)![1]).toBe(LANDING_TITLE);
    // The hidden letter is the kit's visually hidden class: in the page, not shown, and not display: none.
    const sr = /\.ui-sr-only\{([^}]*)\}/.exec(readFileSync('client/src/ui/ui.css', 'utf8'))![1];
    expect(sr).toMatch(/position:absolute/);
    expect(sr).toMatch(/width:1px;height:1px/);
    expect(sr).toMatch(/clip:rect\(0 0 0 0\)/);
    expect(sr).not.toMatch(/display:\s*none|visibility/);
    expect(readFileSync('client/src/pages/Landing.tsx', 'utf8')).toMatch(/import '\.\.\/ui\/ui\.css'/);
  });

  it('shows no letter R next to the logo: the title would read "RRelay"', () => {
    const shown = h1.replace(/<span class="ui-sr-only">[^<]*<\/span>/, '');
    expect(text(shown)).toBe(LANDING_TITLE.slice(1));
  });
});

describe('"How it works" (#833)', () => {
  const h = renderToStaticMarkup(<HowItWorks />);

  it('is one short section: an h2, three steps of one sentence each, then the button to the study page', () => {
    expect(HOW_TITLE).toBe('How it works');
    expect(h.startsWith('<section class="landing-how" aria-labelledby="landing-how-title"><h2 id="landing-how-title">How it works</h2>')).toBe(true);
    expect(HOW_STEPS).toEqual([
      'A business sends a package.',
      'An employee already commuting picks it up, or hands it off overnight at a relay point.',
      'It arrives the next morning.',
    ]);
    for (const step of HOW_STEPS) {
      expect(step.match(/[.!?]/g), step).toHaveLength(1);
      expect(step.length, step).toBeLessThanOrEqual(90); // one line at desktop widths
    }
    expect(h.match(/<li>/g)).toHaveLength(3);
    expect(h).toContain('<ol class="landing-steps">');
    const steps = [...h.matchAll(/<li><span class="landing-step-n" aria-hidden="true">(\d)<\/span><span class="landing-step-text">([^<]*)<\/span><\/li>/g)];
    expect(steps.map((m) => m[1])).toEqual(['1', '2', '3']);
    expect(steps.map((m) => m[2])).toEqual(HOW_STEPS);
  });

  it('ends with "See the numbers", a plain link to /study.html', () => {
    expect(STUDY_LABEL).toBe('See the numbers');
    expect(STUDY_HREF).toBe('/study.html');
    expect(h.endsWith('<a class="numbers-button" href="/study.html">See the numbers</a></section>')).toBe(true);
    expect(h.match(/<a /g)).toHaveLength(1);
  });

  it('never says hub, and names no number of a run', () => {
    expect(text(h)).not.toMatch(/hub/i);
    expect(text(h).replace(/\D/g, '')).toBe('123');
  });
});

describe('the states of the load', () => {
  it('loading: Business and Employee not clickable, the button still a link, no note', () => {
    const h = page({});
    expect(h).not.toMatch(/NaN|undefined/);
    expect(h).not.toContain('href="/business/');
    expect(h).not.toContain('href="/employee/');
    expect(h.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(workspaceLinks(h)).toEqual([]);
    expect(h).not.toContain('landing-note');
    expect(h).toMatch(/<a [^>]*class="watch-button"[^>]*href="\/simulator"|<a [^>]*href="\/simulator"[^>]*class="watch-button"/);
  });

  it('a failed load says why in one line; ready and loading say nothing', () => {
    const note = (status: NycSummary['status']) => renderToStaticMarkup(<LoadNote status={status} />);
    expect(note('ready')).toBe('');
    expect(note('loading')).toBe('');
    expect(note('error')).toBe('<p class="landing-note" role="status">Accounts unavailable</p>');
    expect(note('unavailable')).toBe('<p class="landing-note" role="status">NYC travel data is not loaded on this server yet.</p>');
  });
});

describe('the map key', () => {
  it('names the four marks of the drawing in words', () => {
    expect(HERO_LEGEND.map((x) => x.text)).toEqual(['Commuter A', 'Commuter B', 'Relay point', 'Package']);
  });
});

describe('landing.css rules', () => {
  const css = readFileSync('client/src/styles/landing.css', 'utf8');
  const narrow = [...css.matchAll(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/g)]
    .filter((x) => Number(x[1]) >= 390)
    .map((x) => x[2]).join('\n');

  it('stacks the two entries in one column and gives both buttons the full width at 390 px', () => {
    expect(narrow).toMatch(/\.workspaces \{ grid-template-columns: 1fr; \}/);
    expect(narrow).toMatch(/\.watch-button \{ display: flex; \}/);
    expect(narrow).toMatch(/\.numbers-button \{ display: flex; \}/);
  });
  it('the button is large, light on the dark hero, and has a visible focus ring of its own', () => {
    expect(css).toMatch(/\.watch-button \{[^}]*min-height: 56px/);
    expect(css).toMatch(/\.watch-button \{[^}]*font-size: var\(--text-lg, 18px\)/);
    expect(css).toMatch(/\.watch-button \{[^}]*background: var\(--panel, #FFFFFF\)/);
    expect(css).toMatch(/\.watch-button \{[^}]*\bcolor: var\(--text, #171C24\)/);
    const ring = /\.watch-button:focus-visible \{([^}]*)\}/.exec(css)![1];
    expect(ring).toMatch(/outline: 3px solid var\(--panel, #FFFFFF\)/);
    expect(ring).toMatch(/outline-offset: 3px/);
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  });
  it('the entries are smaller than the button', () => {
    expect(css).toMatch(/\.workspace-title \{[^}]*font-size: var\(--text-md, 14px\)/);
    expect(css).not.toMatch(/\.workspace-entry \{[^}]*min-height/);
  });
  it('"See the numbers" is a button of the accent color, at least 44 px high', () => {
    expect(css).toMatch(/\.numbers-button \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.numbers-button \{[^}]*background: var\(--accent, #1D5075\)/);
    expect(css).toMatch(/\.numbers-button:focus-visible \{[^}]*outline: 3px solid var\(--text, #171C24\)/);
  });
  it('no radius over 6px (docs/mvp3.md P4), no shadows, no gradients', () => {
    for (const [, v] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      const px = [...v.matchAll(/(\d+(?:\.\d+)?)px/g)].map((x) => Number(x[1]));
      expect(px.every((n) => n <= 6)).toBe(true);
      expect(v).not.toMatch(/%|rem|em\b/);
    }
    expect(css).not.toContain('box-shadow');
    expect(css).not.toContain('gradient');
    expect(css).toContain(':focus-visible');
  });
});
