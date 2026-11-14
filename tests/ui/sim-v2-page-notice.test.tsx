import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY_TEXT, DesktopOnlyNotice } from '../../client/src/components/sim/v2/page/DesktopOnlyNotice';

const DIR = 'client/src/components/sim/v2/page';
const css = readFileSync(join(DIR, 'page.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the first `@media <query> { ... }` block, matched by brace depth. */
function mediaBlocks(src: string): { query: string; body: string }[] {
  const out: { query: string; body: string }[] = [];
  const re = /@media([^{]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    out.push({ query: m[1].trim(), body: src.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

const outside = (src: string) => {
  let rest = src;
  for (const b of mediaBlocks(src)) rest = rest.replace(b.body, '');
  return rest;
};

describe('DesktopOnlyNotice render', () => {
  it('shows the notice text and a link to /', () => {
    const html = renderToStaticMarkup(<DesktopOnlyNotice />);
    expect(html).toContain('class="sim-desktop-notice"');
    expect(html).toContain(
      'The simulator needs a wider screen. Open Relay on a desktop, or use the Business and Employee workspaces on this device.',
    );
    expect(html).toContain(DESKTOP_ONLY_TEXT);
    expect(html).toMatch(/<a href="\/">[^<]+<\/a>/);
    expect(html).not.toContain('sim-desktop-content');
  });

  it('wraps the workspace so the stylesheet can hide it on narrow screens', () => {
    const html = renderToStaticMarkup(
      <DesktopOnlyNotice>
        <div data-testid="ws">WS</div>
      </DesktopOnlyNotice>,
    );
    expect(html).toMatch(/<div class="sim-desktop-content"><div data-testid="ws">WS<\/div><\/div>/);
    expect(html.indexOf('sim-desktop-notice')).toBeLessThan(html.indexOf('sim-desktop-content'));
  });

  it('does not read window while rendering', () => {
    const src = readFileSync(join(DIR, 'DesktopOnlyNotice.tsx'), 'utf8');
    expect(src).not.toMatch(/\bwindow\b|matchMedia|innerWidth/);
  });
});

describe('page.css', () => {
  const blocks = mediaBlocks(css);

  it('has one max-width media query just below 900 px', () => {
    const widths = blocks.map((b) => b.query.match(/\(max-width:\s*([\d.]+)px\)/)?.[1]).filter(Boolean);
    expect(widths).toHaveLength(1);
    const w = Number(widths[0]);
    expect(w).toBeGreaterThanOrEqual(899);
    expect(w).toBeLessThan(900);
  });

  it('hides the notice by default (900 px and above) and shows it below', () => {
    expect(outside(css)).toMatch(/\.sim-desktop-notice\s*\{\s*display:\s*none;?\s*\}/);
    const narrow = blocks.find((b) => /max-width/.test(b.query))!.body;
    expect(narrow).toMatch(/\.sim-desktop-notice\s*\{[^}]*display:\s*block/);
    expect(narrow).toMatch(/\.sim-desktop-content\s*\{[^}]*display:\s*none/);
  });

  it('never hides the workspace outside the narrow query', () => {
    expect(outside(css)).not.toContain('.sim-desktop-content');
  });

  it('follows the design rules: radius at most 4 px, tokens with fallbacks, no shadow or gradient', () => {
    expect(css).not.toMatch(/var\(--[a-z0-9-]+\)/);
    expect(css).not.toMatch(/box-shadow|gradient/i);
    for (const [, v] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of v.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(4);
    }
  });
});

describe('sim/v2/page folder copy', () => {
  it('never says "hub" or "synthetic"', () => {
    for (const f of readdirSync(DIR)) {
      const text = readFileSync(join(DIR, f), 'utf8');
      expect(text, f).not.toMatch(/hub|synthetic/i);
    }
  });
});
