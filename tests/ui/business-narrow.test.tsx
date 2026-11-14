import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const ui = read('client/src/ui/ui.css');
const global = read('client/src/styles/global.css');

describe('kit CSS at narrow widths', () => {
  it('tracking drawer is full width below 600px', () => {
    expect(ui).toMatch(/@media \(max-width:599px\)\{\s*\.ui-drawer\{width:100vw/);
  });
  it('has focus-visible and reduced motion', () => {
    expect(global).toContain(':focus-visible');
    expect(ui).toMatch(/prefers-reduced-motion:reduce\)\{[^@]*\.ui-drawer[^@]*animation:none/);
  });
});
