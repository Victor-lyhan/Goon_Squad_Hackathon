import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (p: string) => strip(readFileSync(p, 'utf8'));

const fontsCss = read('client/src/styles/fonts.css');
const globalCss = read('client/src/styles/global.css');

const IMPORT_RE = /@import\s+['"]([^'"]+)['"]\s*;/g;
const imports = [...fontsCss.matchAll(IMPORT_RE)].map((m) => m[1]);

type Family = 'sans' | 'mono';
const PKG: Record<Family, string> = { sans: '@fontsource/ibm-plex-sans', mono: '@fontsource/ibm-plex-mono' };

function importedWeights(family: Family): Set<number> {
  const re = new RegExp(`^${PKG[family]}/latin-(\\d{3})\\.css$`);
  const out = new Set<number>();
  for (const p of imports) {
    const m = re.exec(p);
    if (m) out.add(Number(m[1]));
  }
  return out;
}

const cssIn = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => join(dir, f));
const STYLESHEETS = [...cssIn('client/src/ui'), ...cssIn('client/src/styles')];

/** Every declaration block (text between a `{` and the next `}` with no nested braces) that sets a numeric font-weight. */
function weightUses(file: string): { family: Family; weight: number; block: string }[] {
  const css = read(file);
  const uses: { family: Family; weight: number; block: string }[] = [];
  for (const m of css.matchAll(/\{([^{}]*)\}/g)) {
    const block = m[1];
    const family: Family = /font-family\s*:[^;]*(--font-mono|monospace)/.test(block) ? 'mono' : 'sans';
    for (const w of block.matchAll(/font-weight\s*:\s*(\d+)/g)) uses.push({ family, weight: Number(w[1]), block: block.trim() });
  }
  return uses;
}

describe('MVP II self-hosted IBM Plex fonts (#408)', () => {
  it('imports only latin subsets of the two Plex packages', () => {
    expect(imports.length).toBeGreaterThan(0);
    for (const p of imports) expect(p).toMatch(/^@fontsource\/ibm-plex-(sans|mono)\/latin-\d{3}\.css$/);
  });

  it('imports Sans 400/500/600 and Mono 400/500', () => {
    expect([...importedWeights('sans')].sort()).toEqual([400, 500, 600]);
    expect([...importedWeights('mono')].sort()).toEqual([400, 500]);
  });

  it('every imported file exists in node_modules and uses font-display: swap', () => {
    for (const p of imports) {
      const file = join('node_modules', p);
      expect(existsSync(file), file).toBe(true);
      const css = readFileSync(file, 'utf8');
      expect(css).toMatch(/font-display:\s*swap/);
      expect(css).toMatch(/\.woff2/);
    }
  });

  it('global.css imports fonts.css (after tokens.css)', () => {
    const lines = globalCss.trim().split('\n');
    expect(lines[0]).toMatch(/^@import\s+['"]\.\/tokens\.css['"];/);
    expect(globalCss).toMatch(/@import\s+['"]\.\/fonts\.css['"];/);
  });

  it('every font-weight in client/src/ui and client/src/styles is an imported weight for its family', () => {
    const sans = importedWeights('sans');
    const mono = importedWeights('mono');
    const bad: string[] = [];
    let count = 0;
    for (const file of STYLESHEETS) {
      for (const u of weightUses(file)) {
        count++;
        const ok = (u.family === 'mono' ? mono : sans).has(u.weight);
        if (!ok) bad.push(`${file}: ${u.family} ${u.weight} in { ${u.block} }`);
      }
    }
    expect(count).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it('no stylesheet or index.html references an external font host', () => {
    const EXTERNAL = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|@import\s+(url\()?['"]?https?:/;
    for (const file of [...STYLESHEETS, 'client/index.html']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(EXTERNAL);
    }
  });
});
