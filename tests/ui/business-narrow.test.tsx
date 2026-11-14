import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const ui = read('client/src/ui/ui.css');
const global = read('client/src/styles/global.css');

describe('kit CSS at narrow widths', () => {
  it('has focus-visible and reduced motion', () => {
    expect(global).toContain(':focus-visible');
    expect(ui).toMatch(/prefers-reduced-motion:reduce\)\{[^@]*\.ui-spinner\{animation:none/);
  });
});
