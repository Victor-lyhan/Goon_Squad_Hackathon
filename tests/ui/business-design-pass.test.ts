// Business page design pass (#940): the New delivery box is the one bold element; the rest is quiet and on
// an 8 px rhythm, with one button height. Styling only, so these read the stylesheets.
// Since #956 (the night-shift transit look) the bold element is the sentence box as an ink panel with the
// one large orange button; the rhythm, the button height and the quiet rest are as #940 left them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'client/src/components/business/v2/';
const read = (file: string) => readFileSync(DIR + file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const nd = read('newDelivery.css');
const page = read('page/businessPage.css');
const list = read('businessWorkspace.css');
const activity = read('activity/activity.css');
const all = { 'newDelivery.css': nd, 'businessPage.css': page, 'businessWorkspace.css': list, 'activity.css': activity };

/** The first rule with exactly this selector, before any @media block. */
function rule(css: string, selector: string): string {
  const base = css.split('@media')[0];
  const at = base.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return base.slice(at, base.indexOf('}', at));
}

describe('Business page design pass (#940)', () => {
  it('the sentence box is the one bold element: the only ink panel, 32 px of padding, the sentence set large, one large orange button', () => {
    const box = rule(nd, '.nd-request');
    expect(box).toMatch(/background: var\(--ns-ink, #0B0F17\);/);
    expect(box).toMatch(/color: var\(--ns-paper, #F4F2EC\);/);
    expect(box).toMatch(/padding: var\(--space-8, 32px\);/);
    expect(box).toMatch(/max-width: 880px;/);
    // The sentence is in the heading face at the sentence size; the title above it is larger still.
    const text = rule(nd, '.nd-request__text');
    expect(text).toMatch(/font-family: var\(--ns-display, 'Archivo Variable', 'Inter', system-ui, sans-serif\);/);
    expect(text).toMatch(/font-size: var\(--ns-size-sentence, 26px\);/);
    expect(text).toMatch(/caret-color: var\(--ns-signal, #FF6A1A\);/);
    expect(rule(nd, '.nd-request .nd-title')).toMatch(/font-size: var\(--ns-size-figure, 32px\);/);
    // Its orange button is the page's large one: 48 px tall, 18 px text.
    expect(rule(nd, '.nd-request .nd-btn')).toMatch(/height: 48px;/);
    const read = rule(nd, '.nd-request .nd-btn--primary');
    expect(read).toMatch(/background: var\(--ns-signal, #FF6A1A\);/);
    expect(read).toMatch(/font-size: var\(--text-lg, 18px\);/);
    // No other rule of the page fills a box with ink but the marks of a state that is chosen (the pressed
    // direction, the option in the form) and the small station dots and rules.
    const inkFills = Object.entries(all).flatMap(([file, css]) =>
      [...css.split('@media')[0].matchAll(/([^{}]+)\{[^}]*background: var\(--ns-ink, #0B0F17\)/g)].map((m) => `${file}: ${m[1].trim()}`));
    expect(inkFills.sort()).toEqual([
      'activity.css: .ba-header::after',
      'activity.css: .ba-header::before',
      "businessWorkspace.css: .bw-segmented__btn[aria-pressed='true']",
      'businessWorkspace.css: .bw-status--success::before',
      "newDelivery.css: .nd-option__choose[aria-pressed='true']",
      'newDelivery.css: .nd-request',
      'newDelivery.css: .nd-route::after',
    ]);
    // The confirmation form after it is a white sheet with a hairline: its title is smaller than the box's.
    const form = rule(nd, '.nd');
    expect(form).toMatch(/border: 1px solid var\(--ns-line, #DCD8CE\);/);
    expect(form).toMatch(/padding: var\(--space-6, 24px\);/);
    expect(form).toMatch(/max-width: 880px;/);
    expect(rule(nd, '.nd-title')).toMatch(/font-size: var\(--text-xl, 28px\);/);
    // Only the business's name is set larger than the box's title, and it is not a panel.
    for (const [file, css] of Object.entries(all)) {
      const sizes = [...css.matchAll(/--ns-size-(name|figure|sentence)/g)].map((m) => m[1]);
      if (file === 'activity.css') expect([...new Set(sizes)], file).toEqual(['name']);
      else if (file === 'businessPage.css') expect([...new Set(sizes)].sort(), file).toEqual(['figure', 'name', 'sentence']); // the palette block
      else if (file !== 'newDelivery.css') expect(sizes, file).toEqual([]);
    }
    // The Options card above the form has no box of its own: a 2 px ink rule, then hairline rows.
    expect(rule(nd, '.nd-options')).not.toMatch(/\sborder[\w-]*:|background:/);
    expect(rule(nd, '.nd-options__list')).toMatch(/border-top: 2px solid var\(--ns-ink, #0B0F17\);/);
    expect(rule(nd, '.nd-option')).toMatch(/border-bottom: 1px solid var\(--ns-line, #DCD8CE\);/);
  });

  it('orange is the main action (New delivery, Read my request, Find a delivery match) and small marks only, and the toolbar\'s button steps back while the box is open', () => {
    const fills = Object.entries(all).flatMap(([file, css]) =>
      [...css.matchAll(/([^{}]+)\{[^}]*background: var\(--ns-signal, #FF6A1A\)/g)].map((m) => `${file}: ${m[1].trim()}`));
    expect(fills.sort()).toEqual([
      'activity.css: .ba-note__new::before', // the 8 px dot of a row that just arrived
      'businessWorkspace.css: .bw-btn--primary',
      'businessWorkspace.css: .bw-status--info::before', // the 8 px dot of a package on its way
      'newDelivery.css: .nd-btn--primary',
      'newDelivery.css: .nd-option__tag--fastest', // the small Fastest badge of an option (the human's colour for it, #960)
      'newDelivery.css: .nd-request .nd-btn--primary',
      'newDelivery.css: .nd-request .nd-from::before', // the 8 px dot of the package at the sender
    ]);
    // With New delivery open, the toolbar's button (which opens what is open) is an outline: it is drawn
    // without the primary class, so the box's own button is the only orange one.
    const toolbar = readFileSync(`${DIR}ShipmentsToolbar.tsx`, 'utf8');
    expect(toolbar).toContain("className={props.newDeliveryOpen ? 'bw-btn bw-toolbar__new' : 'bw-btn bw-btn--primary bw-toolbar__new'}");
    expect(readFileSync(`${DIR}page/BusinessPageView.tsx`, 'utf8')).toContain('newDeliveryOpen={newOpen}');
  });

  it('the box and the cards around it share one width, so their edges line up with the toolbar and the table', () => {
    const widths = [...nd.split('@media')[0].matchAll(/max-width: (\d+)px;/g)].map((m) => m[1]);
    expect(widths).toEqual(['880', '880', '880', '880']);
  });

  it('no label is set in tracked capitals', () => {
    for (const [file, css] of Object.entries(all)) expect(css, file).not.toMatch(/text-transform:\s*uppercase/);
  });

  it('every button and control of the page is 36 px tall on a wide screen', () => {
    for (const sel of ['.bw-input', '.bw-segmented__btn', '.bw-btn']) expect(rule(list, sel), sel).toMatch(/height: 36px;/);
    expect(rule(nd, '.nd-btn')).toMatch(/height: 36px;/);
    expect(rule(nd, '.nd-input')).toMatch(/height: 36px;/);
    expect(rule(page, '.bp-btn')).toMatch(/min-height: 36px;/);
    expect(rule(activity, '.ba-notes__more')).toMatch(/min-height: 36px;/);
    // One look: semibold text, 16 px at the sides, the same hover.
    for (const [css, sel] of [[list, '.bw-btn'], [nd, '.nd-btn'], [page, '.bp-btn'], [activity, '.ba-notes__more']] as const) {
      expect(rule(css, sel), sel).toMatch(/padding: 0 var\(--space-4, 16px\);/);
      expect(rule(css, sel), sel).toMatch(/font-weight: 600;/);
      expect(css, sel).toContain(`${sel}:hover { border-color: var(--ns-muted, #5A5F6B); }`);
    }
  });

  it('the gaps between the parts of the page are 8, 16 or 24 px', () => {
    expect(rule(page, '.bp-layout')).toMatch(/gap: var\(--space-6, 24px\);\s*margin-top: var\(--space-6, 24px\);/);
    expect(rule(page, '.bp-main, .bp-side')).toMatch(/gap: var\(--space-4, 16px\);/);
    expect(rule(list, '.bw-toolbar')).toMatch(/gap: var\(--space-2, 8px\) var\(--space-4, 16px\);\s*padding: 0 0 var\(--space-4, 16px\);/);
    expect(rule(activity, '.ba-header')).toMatch(/padding: var\(--space-2, 8px\) 0 var\(--space-6, 24px\);/);
    // The Notifications heading and the toolbar start on one line: neither has space above it.
    expect(rule(activity, '.ba-notes__title')).toMatch(/padding: 0 0 var\(--space-2, 8px\);/);
    // Table columns share one 16 px gutter; a row of the timetable has 12 px above and below (#956).
    expect(list).toMatch(/\.bw-table th,\s*\.bw-table td \{\s*padding: var\(--space-3, 12px\) var\(--space-4, 16px\);/);
  });

  it('secondary text is quiet and the states are plain', () => {
    expect(rule(list, '.bw-toolbar__label')).toMatch(/font-weight: 500;/);
    expect(rule(list, '.bw-table th')).toMatch(/font-weight: 500;/);
    // "Held here overnight" is plain words in ink: no box around it and, since #956, no colour of its own.
    expect(activity).toContain('.ba-note__tag { padding: 0; }');
    expect(rule(activity, '.ba-note__new,\n.ba-note__tag')).toMatch(/color: var\(--ns-text, #14171F\);/);
    expect(rule(activity, '.ba-note__new,\n.ba-note__tag')).not.toMatch(/background|border/);
    // The notifications are the quiet column (#956): grey sentences under a small grey heading.
    expect(rule(activity, '.ba-notes')).toMatch(/color: var\(--ns-muted, #5A5F6B\);/);
    expect(rule(activity, '.ba-notes__title')).toMatch(/font-size: var\(--text-sm, 13px\);[\s\S]*color: var\(--ns-muted, #5A5F6B\);/);
    // Loading is a line of quiet text with no box; the error and not-found boxes keep 24 px of padding.
    expect(rule(page, 'p.bp-state')).toMatch(/border-color: transparent; background: none; color: var\(--ns-muted, #5A5F6B\);/);
    expect(rule(page, '.bp-state, .bp-missing')).toMatch(/padding: var\(--space-6, 24px\);/);
    expect(rule(list, '.bw-empty')).toMatch(/padding: var\(--space-6, 24px\);/);
  });
});
