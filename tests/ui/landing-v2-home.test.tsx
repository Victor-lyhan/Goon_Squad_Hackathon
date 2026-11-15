import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing, {
  HOW_STEPS, HOW_TITLE, HowItWorks, LANDING_SUBLINE, LANDING_TITLE, LandingTitle, LoadNote, Numbers, STUDY_FIGURE,
  STUDY_FIGURE_TEXT, STUDY_HREF, STUDY_LABEL, STUDY_NOTE, TITLE_LINES, WATCH_NOTE_ID, WATCH_NOTE_NARROW, WORKSPACES,
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
    // #955: the title is short enough to be set very large; what was its second half is the sentence under it.
    expect(LANDING_TITLE).toBe('Relay: packages ride the commute');
    expect(LANDING_SUBLINE).toBe('Cheaper and greener than a courier, because the drive was already happening.');
    expect(copy.startsWith(titleMarkup())).toBe(true);
    expect(copy.startsWith('<h1 id="landing-title" ')).toBe(true);
    // The only picture of the page is the one inside the title: the separate logo above it is gone.
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(/<h1[\s\S]*?<\/h1>/.exec(html)![0]).toContain('<img ');
    expect(html).not.toContain('class="landing-logo"');
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('<section class="landing-hero" aria-labelledby="landing-title">');
    // nothing else next to the title but its one sentence (#955), the button and the two entries: no
    // environment line, and the second paragraph is the line under the button that only a window below
    // 900 px shows (#908, tests/ui/demo-path-sim-half-polish.test.tsx has its CSS)
    expect(copy.match(/<p[ >]/g)).toEqual(['<p ', '<p ']);
    expect(copy).toContain(`</h1><p class="landing-sub">${LANDING_SUBLINE}</p><a class="watch-button"`);
    expect(copy).toContain(`<p class="watch-note" id="${WATCH_NOTE_ID}">`);
    expect(text(copy)).toBe(`${LANDING_TITLE}${LANDING_SUBLINE}Watch a package${WATCH_NOTE_NARROW}${WORKSPACES.map((w) => `${w.title}${w.text}`).join('')}`);
  });

  it('the hero holds the centered column with the text, then the map outside it, and nothing else (#853, #869)', () => {
    const hero = /<section class="landing-hero"[^>]*>([\s\S]*?)<\/section>/.exec(html)![1];
    expect(hero.startsWith('<div class="landing-hero-inner"><div class="landing-hero-copy">')).toBe(true);
    expect(hero.match(/class="landing-hero-(inner|copy|map)"/g)).toEqual([
      'class="landing-hero-inner"', 'class="landing-hero-copy"', 'class="landing-hero-map"',
    ]);
    // The column holds the text only. The map is the hero's own second child, so it is not held in by the
    // column's width or padding and can run to the hero's edges.
    expect(hero).toContain('</ul></div></div><div class="landing-hero-map">'); // the entries, the text, the column
    expect(hero.endsWith('</ul></div>')).toBe(true); // the map's key, the map
    const column = hero.slice(0, hero.indexOf('<div class="landing-hero-map">'));
    expect(column).not.toMatch(/<svg class="hero-map"|hero-legend/);
  });

  it('has the parts in order: the title, its sentence, the button, Business and Employee, the map, How it works, the figure, See the numbers', () => {
    const at = ['<h1', 'class="landing-sub"', 'class="watch-button"', 'class="workspaces"', 'class="landing-hero-map"', 'class="landing-how"', 'class="landing-numbers"', 'class="landing-figure"', 'class="numbers-button"']
      .map((part) => html.indexOf(part));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('is three sections, the hero, "How it works" and the study\'s figure: no footer, no stats line, no environment line', () => {
    expect(html.match(/<section class="[a-z-]+"/g)).toEqual(['<section class="landing-hero"', '<section class="landing-how"', '<section class="landing-numbers"']);
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
      expect(text(links[i].body)).toBe(`${t}${WORKSPACES[i].text}`); // no arrow after it (#879)
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
      + ' <span class="landing-title-line">packages ride</span>'
      + ' <span class="landing-title-line">the commute</span></h1>',
    );
  });

  it('is three lines, each one box, with a space between them so the heading\'s text is still the sentence (#955)', () => {
    expect(TITLE_LINES).toEqual(['Relay:', 'packages ride', 'the commute']);
    expect(LANDING_TITLE).toBe(TITLE_LINES.join(' '));
    expect(h1.match(/<span class="landing-title-(word|line)">/g)).toHaveLength(TITLE_LINES.length);
    // No <br>: a screen reader and a copy of the text get one sentence, and the boxes break the lines.
    expect(h1).not.toContain('<br');
    // No line is longer than the one the size was measured for (tests/ui/landing-nyc-css.test.ts).
    for (const line of TITLE_LINES) expect(line.length, line).toBeLessThanOrEqual('packages ride'.length);
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

  it('is one short section: an h2 and three steps of one sentence each, as an ordered list', () => {
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
    // #955: the steps are stations on a route line that landing.css draws; the markup is the list alone.
    // It is an <ol>, so a screen reader still counts the steps, and no numeral is printed beside them.
    const steps = [...h.matchAll(/<li><span class="landing-step-text">([^<]*)<\/span><\/li>/g)];
    expect(steps.map((m) => m[1])).toEqual(HOW_STEPS);
    expect(h.endsWith('</li></ol></section>')).toBe(true);
    expect(h).not.toContain('landing-step-n');
    expect(h).not.toContain('<a ');
  });

  it('never says hub, and names no number at all', () => {
    expect(text(h)).not.toMatch(/hub/i);
    expect(text(h).replace(/\D/g, '')).toBe('');
  });
});

describe('the study\'s figure and "See the numbers" (#955)', () => {
  const h = renderToStaticMarkup(<Numbers />);

  it('is a section whose heading is the figure and the words that finish its sentence', () => {
    expect(h.startsWith('<section class="landing-numbers" aria-labelledby="landing-numbers-title"><h2 id="landing-numbers-title">')).toBe(true);
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(h)![1]!;
    expect(h2).toBe(
      `<span class="landing-figure">${STUDY_FIGURE}</span>`
      + ' <span class="landing-figure-text">less CO<sub>2</sub> per package than a next-day courier</span>',
    );
    // Read as text it is one sentence, with a space after the figure.
    expect(text(h2)).toBe(`${STUDY_FIGURE} ${STUDY_FIGURE_TEXT}`);
    expect(STUDY_FIGURE).toMatch(/^\d{1,2}%$/);
    expect(STUDY_FIGURE_TEXT).toBe('less CO2 per package than a next-day courier');
  });

  it('then one line with the second result and the size of the study, in plain words', () => {
    expect(h).toContain(`</h2><p class="landing-numbers-note">${STUDY_NOTE}</p>`);
    expect(STUDY_NOTE).toMatch(/^And \d{1,2}% less cost to the sender\. Averages over [\d,]+ simulations\.$/);
    expect(h.match(/<p[ >]/g)).toHaveLength(1);
  });

  it('ends with "See the numbers", a plain link to /study.html', () => {
    expect(STUDY_LABEL).toBe('See the numbers');
    expect(STUDY_HREF).toBe('/study.html');
    expect(h.endsWith('<a class="numbers-button" href="/study.html">See the numbers</a></section>')).toBe(true);
    expect(h.match(/<a /g)).toHaveLength(1);
  });

  it('never says hub, and names no number of a run: only the study\'s three', () => {
    expect(text(h)).not.toMatch(/hub/i);
    expect(text(h).match(/\d[\d,.]*%?/g)).toEqual([STUDY_FIGURE, '2', '55%', '3,024']);
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

  it('puts the two entries side by side only where both fit, else in one column, and gives all three the full width at 390 px', () => {
    // #955: side by side where each has 17.5em (its text on one line), else one under the other (#869).
    const entries = /\.workspaces \{([^}]*)\}/.exec(css)![1];
    expect(entries).toMatch(/grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 17\.5em\), 1fr\)\);/);
    expect(entries).toMatch(/max-width: 36rem;/);
    // The button is at least 300 px wide wherever 300 px fit, at every width (#879), not only from 600 px up.
    expect(/\.watch-button \{([^}]*)\}/.exec(css)![1]).toMatch(/min-width: min\(300px, 100%\);/);
    expect(css).not.toMatch(/@media \(min-width/);
    expect(css.match(/\.workspaces \{[^}]*grid-template-columns/g)).toHaveLength(1);
    expect(narrow).toMatch(/\.workspaces \{ max-width: none; \}/);
    expect(narrow).toMatch(/\.watch-button \{ display: flex; \}/);
    expect(narrow).toMatch(/\.numbers-button \{ display: flex; \}/);
  });
  it('the button is large, the package\'s orange on the ink hero, and has a visible focus ring of its own', () => {
    // #955: 64 px high with a 19 px label in Archivo's wide cut, at every width.
    expect(css).toMatch(/\.watch-button \{[^}]*min-height: 64px/);
    expect(css).toMatch(/\.watch-button \{[^}]*font-size: 19px/);
    expect(css).toMatch(/\.watch-button \{[^}]*font-stretch: 112%/);
    // Orange with ink text (7:1, tests/ui/kit-v2-tokens-mvp3.test.ts); lighter under the pointer.
    expect(css).toMatch(/\.watch-button \{[^}]*background: var\(--hero-package, #FF6A1A\)/);
    expect(css).toMatch(/\.watch-button \{[^}]*\bcolor: var\(--hero-ground, #0B0F17\)/);
    expect(css).toMatch(/\.watch-button:hover \{ background: var\(--signal-hover, #FF8748\); border-color: var\(--signal-hover, #FF8748\); \}/);
    // The play mark takes the text's ink: no rule gives it a color of its own.
    expect(css).toMatch(/\.watch-button-icon \{ flex: none; \}/);
    const ring = /\.watch-button:focus-visible \{([^}]*)\}/.exec(css)![1];
    expect(ring).toMatch(/outline: 3px solid var\(--hero-light, #F4F2EC\)/);
    expect(ring).toMatch(/outline-offset: 3px/);
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  });
  it('the entries are smaller than the button', () => {
    expect(css).toMatch(/\.workspace-title \{[^}]*font-size: 15px/); // the button's label is 19 px
    expect(css).not.toMatch(/\.workspace-entry \{[^}]*min-height/);
  });
  it('"See the numbers" is the page\'s second action: ink on paper, not orange, at least 44 px high', () => {
    expect(css).toMatch(/\.numbers-button \{[^}]*min-height: 48px/);
    expect(css).toMatch(/\.numbers-button \{[^}]*background: var\(--paper-text, #14171F\)/);
    expect(css).toMatch(/\.numbers-button \{[^}]*\bcolor: var\(--paper, #F4F2EC\)/);
    expect(css).toMatch(/\.numbers-button:focus-visible \{[^}]*outline: 3px solid var\(--paper-text, #14171F\)/);
  });
  it('orange is the package and the primary button, nothing else (#955)', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const orange = [...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /--hero-package|--signal|#FF6A1A|#FF8748/i.test(m[2]!) && !/--hero-package:/.test(m[2]!))
      .map((m) => m[1]!.trim());
    expect(orange.sort()).toEqual(['.hero-key-package', '.hero-package', '.hero-relay-ring', '.hero-trail', '.watch-button', '.watch-button:hover']);
  });
  it('no radius over 6px (docs/mvp3.md P4), no shadows, and no gradient but the mask of the map (#869)', () => {
    for (const [, v] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      const px = [...v.matchAll(/(\d+(?:\.\d+)?)px/g)].map((x) => Number(x[1]));
      expect(px.every((n) => n <= 6)).toBe(true);
      expect(v).not.toMatch(/%|rem|em\b/);
    }
    expect(css).not.toContain('box-shadow');
    // A mask paints nothing: it only fades the drawing into the hero's flat ground.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules.replace(/(-webkit-)?mask-image: linear-gradient\([^;]*;/g, '')).not.toContain('gradient');
    expect(rules).not.toMatch(/background[a-z-]*:[^;]*gradient/);
    expect(css).toContain(':focus-visible');
  });
});
