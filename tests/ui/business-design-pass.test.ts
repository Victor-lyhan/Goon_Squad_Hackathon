// Business page design pass (#940): the New delivery box is the one bold element; the rest is quiet and on
// an 8 px rhythm, with one button height. Styling only, so these read the stylesheets.
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
  it('the New delivery box is the one bold element: primary border, left stripe, 24 px padding, the largest title', () => {
    for (const box of ['.nd', '.nd-request']) {
      const r = rule(nd, box);
      expect(r, box).toMatch(/border: 1px solid var\(--accent, #1D5075\);/);
      expect(r, box).toMatch(/border-left-width: 3px;/);
      expect(r, box).toMatch(/padding: var\(--space-6, 24px\);/);
      expect(r, box).toMatch(/max-width: 880px;/);
    }
    expect(rule(nd, '.nd-title')).toMatch(/font-size: var\(--text-xl, 28px\);/);
    expect(rule(nd, '.nd-request__text')).toMatch(/font-size: var\(--text-lg, 18px\);/);
    // Nothing else on the page is set at the largest size, and no other panel has the primary colour's border
    // (the small "New" mark of a notification is filled with it, which is not a panel).
    for (const [file, css] of Object.entries(all)) {
      if (file === 'newDelivery.css') continue;
      expect(css, file).not.toMatch(/--text-xl/);
      expect(css.replace(/\.ba-note__new \{[^}]*\}/, ''), file).not.toMatch(/border: 1px solid var\(--accent,/);
    }
    // The Options card above the box stays a hairline panel.
    expect(rule(nd, '.nd-options')).toMatch(/border: 1px solid var\(--border, #E3E3DE\);/);
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
      expect(css, sel).toContain(`${sel}:hover { border-color: var(--muted, #5B6472); }`);
    }
  });

  it('the gaps between the parts of the page are 8, 16 or 24 px', () => {
    expect(rule(page, '.bp-layout')).toMatch(/gap: var\(--space-6, 24px\);\s*margin-top: var\(--space-6, 24px\);/);
    expect(rule(page, '.bp-main, .bp-side')).toMatch(/gap: var\(--space-4, 16px\);/);
    expect(rule(list, '.bw-toolbar')).toMatch(/gap: var\(--space-2, 8px\) var\(--space-4, 16px\);\s*padding: 0 0 var\(--space-4, 16px\);/);
    expect(rule(activity, '.ba-header')).toMatch(/padding: var\(--space-2, 8px\) 0 var\(--space-6, 24px\);/);
    // The Notifications heading and the toolbar start on one line: neither has space above it.
    expect(rule(activity, '.ba-notes__title')).toMatch(/padding: 0 0 var\(--space-2, 8px\);/);
    // Table columns share one 16 px gutter.
    expect(list).toMatch(/\.bw-table th,\s*\.bw-table td \{\s*padding: var\(--space-2, 8px\) var\(--space-4, 16px\);/);
  });

  it('secondary text is quiet and the states are plain', () => {
    expect(rule(list, '.bw-toolbar__label')).toMatch(/font-weight: 500;/);
    expect(rule(list, '.bw-table th')).toMatch(/font-weight: 500;/);
    // "Held here overnight" is plain coloured words: no box around it.
    expect(activity).toContain('.ba-note__tag { padding: 0; color: var(--warn, #8A5A00); }');
    // Loading is a line of quiet text with no box; the error and not-found boxes keep 24 px of padding.
    expect(rule(page, 'p.bp-state')).toMatch(/border-color: transparent; background: none; color: var\(--muted, #5B6472\);/);
    expect(rule(page, '.bp-state, .bp-missing')).toMatch(/padding: var\(--space-6, 24px\);/);
    expect(rule(list, '.bw-empty')).toMatch(/padding: var\(--space-6, 24px\);/);
  });
});
