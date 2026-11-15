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
/** Inter for UI, IBM Plex Mono for times, IDs, distances and prices (docs/mvp3.md P4, #651). */
const PKG: Record<Family, string> = { sans: '@fontsource/inter', mono: '@fontsource/ibm-plex-mono' };

function importedWeights(family: Family): Set<number> {
  const re = new RegExp(`^${PKG[family]}/latin-(\\d{3})\\.css$`);
  const out = new Set<number>();
  for (const p of imports) {
    const m = re.exec(p);
    if (m) out.add(Number(m[1]));
  }
  return out;
}

/** Every .css file under client/src, at any depth (#737: not only ui/ and styles/). */
const walkCss = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walkCss(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : []);
const STYLESHEETS = walkCss('client/src').sort();

// ---------- which font and which weight a rule draws its text in ----------

type Rule = { selectors: string[]; decls: Map<string, string> };

/** The innermost `selector { declarations }` blocks of a stylesheet (rules inside @media included). */
function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  for (const m of strip(css).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@')) continue; // @font-face and the like describe a font, they do not use one
    const decls = new Map<string, string>();
    for (const d of m[2].split(';')) {
      const k = d.indexOf(':');
      if (k > 0) decls.set(d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim());
    }
    out.push({ selectors: prelude.split(',').map((s) => s.trim()).filter(Boolean), decls });
  }
  return out;
}

const MONO_RE = /--font-mono|monospace|IBM Plex Mono/;
/** The family a rule sets itself (`font-family`, or a `font` shorthand that is not `inherit`), if any. */
function ownFamily(r: Rule): Family | null {
  const value = r.decls.get('font-family') ?? r.decls.get('font');
  if (!value || /^(inherit|unset)$/.test(value)) return null;
  return MONO_RE.test(value) ? 'mono' : 'sans';
}

/** A selector as compounds of simple selectors: `.a.b > .c:hover` is [['.a', '.b'], ['.c', ':hover']]. */
function compounds(selector: string): string[][] {
  const out: string[][] = [[]];
  const TOKEN = /\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?|[.#][\w-]+|[a-zA-Z][\w-]*|\*|\s*[>+~]\s*|\s+/g;
  for (const [t] of selector.matchAll(TOKEN)) {
    if (/^\s*[>+~]?\s*$/.test(t)) out.push([]);
    else out[out.length - 1].push(t.replace(/'/g, '"'));
  }
  return out.filter((c) => c.length > 0);
}

/**
 * True when every element `selector` matches is also matched by `wider`: the last compounds agree and
 * the earlier compounds of `wider` appear in order. `.cmp-row.is-emphasis .cmp-num` is inside `.cmp-num`.
 */
function selects(selector: string, wider: string): boolean {
  const s = compounds(selector);
  const w = compounds(wider);
  if (s.length === 0 || w.length === 0) return false;
  const has = (a: string[], b: string[]) => b.every((t) => a.includes(t));
  if (!has(s[s.length - 1], w[w.length - 1])) return false;
  let i = s.length - 2;
  for (let j = w.length - 2; j >= 0; j--) {
    while (i >= 0 && !has(s[i], w[j])) i--;
    if (i < 0) return false;
    i--;
  }
  return true;
}

type Use = { family: Family; weight: number; where: string };
type Sheet = { file: string; css: string };

const KEYWORD_WEIGHT: Record<string, number> = { normal: 400, bold: 700 };

/**
 * Every font weight the stylesheets ask for, with the family it is drawn in:
 * - the family is the rule's own; else Plex Mono when another rule of the same file (or the kit's `.mono`)
 *   makes the same element mono (`.cmp-num` is mono, so `.is-emphasis .cmp-num { font-weight: 600 }`
 *   needs Plex Mono 600); else Inter, the body font;
 * - the weight is a number, `normal` (400) or `bold` (700), from `font-weight` or a `font` shorthand.
 * A weight this cannot read (`bolder`, a `var()`) is returned in `unreadable`, so it is never skipped.
 */
function weightUses(sheets: Sheet[]): { uses: Use[]; unreadable: string[] } {
  const uses: Use[] = [];
  const unreadable: string[] = [];
  for (const { file, css } of sheets) {
    const rules = rulesOf(css);
    const monoSelectors = ['.mono', ...rules.filter((r) => ownFamily(r) === 'mono').flatMap((r) => r.selectors)];
    for (const r of rules) {
      const where = (selector: string) => `${file}: ${selector}`;
      let value = r.decls.get('font-weight');
      const shorthand = r.decls.get('font');
      if (value === undefined && shorthand && !/^(inherit|unset)$/.test(shorthand)) {
        // `font: 600 14px/1.4 Inter`: the weight is a word before the size; none means normal.
        const words = shorthand.split(/\s+/);
        const beforeSize = words.slice(0, Math.max(0, words.findIndex((t) => /^[\d.]+(px|rem|em|%)/.test(t))));
        value = beforeSize.find((t) => /^([1-9]00|bold|bolder|lighter)$/.test(t)) ?? 'normal';
      }
      if (value === undefined || value === 'inherit') continue;
      const weight = /^\d+$/.test(value) ? Number(value) : KEYWORD_WEIGHT[value];
      if (weight === undefined) {
        unreadable.push(`${where(r.selectors.join(', '))} { font-weight: ${value} }`);
        continue;
      }
      // One use per selector: `.status strong, .time strong { font-weight: 600 }` is Inter and Plex Mono.
      for (const selector of r.selectors) {
        const family: Family = ownFamily(r) ?? (monoSelectors.some((m) => selects(selector, m)) ? 'mono' : 'sans');
        uses.push({ family, weight, where: where(selector) });
      }
    }
  }
  return { uses, unreadable };
}

const SHEETS: Sheet[] = STYLESHEETS.map((file) => ({ file, css: readFileSync(file, 'utf8') }));

/**
 * Weights with no loaded face that this issue may not fix (#737: no edits in business/v2 or
 * employee/v2, and only 500 and 600 may be added to fonts.css). One line per selector, as
 * `<file>: <selector>`, each with a comment naming the file and the PR that listed it. Empty today.
 */
const EXEMPT: string[] = [];

describe('self-hosted Inter and IBM Plex Mono (#408, #651)', () => {
  it('imports only latin subsets of Inter and IBM Plex Mono', () => {
    expect(imports.length).toBeGreaterThan(0);
    for (const p of imports) expect(p).toMatch(/^@fontsource\/(inter|ibm-plex-mono)\/latin-\d{3}\.css$/);
  });

  it('imports Inter 400/500/600 and Mono 400/500/600', () => {
    expect([...importedWeights('sans')].sort()).toEqual([400, 500, 600]);
    expect([...importedWeights('mono')].sort()).toEqual([400, 500, 600]);
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

  it('checks every stylesheet under client/src, at any depth', () => {
    for (const dir of ['client/src/ui', 'client/src/styles', 'client/src/components/map',
      'client/src/components/sim/v2/journey', 'client/src/components/business/v2', 'client/src/components/employee/v2']) {
      expect(STYLESHEETS.some((f) => f.startsWith(`${dir}/`)), dir).toBe(true);
    }
    const onDisk = (dir: string): number => readdirSync(dir, { withFileTypes: true })
      .reduce((n, e) => n + (e.isDirectory() ? onDisk(join(dir, e.name)) : e.name.endsWith('.css') ? 1 : 0), 0);
    expect(STYLESHEETS).toHaveLength(onDisk('client/src'));
  });

  it('every font weight in every client stylesheet is an imported weight of its family (#737)', () => {
    const sans = importedWeights('sans');
    const mono = importedWeights('mono');
    const { uses, unreadable } = weightUses(SHEETS);
    expect(uses.length).toBeGreaterThan(50);
    expect(unreadable).toEqual([]);
    const bad = uses
      .filter((u) => !(u.family === 'mono' ? mono : sans).has(u.weight) && !EXEMPT.includes(u.where))
      .map((u) => `${u.where}: ${u.family} ${u.weight}`);
    expect(bad).toEqual([]);
    // An exemption that no longer fails is removed, so the list never hides a new fault.
    for (const e of EXEMPT) expect(uses.some((u) => u.where === e && !(u.family === 'mono' ? mono : sans).has(u.weight)), e).toBe(true);
  });

  it('the journey badges and the reward are IBM Plex Mono 600, a loaded face (not a faked 700)', () => {
    const journey = weightUses(SHEETS.filter((s) => s.file.endsWith('journey/journey.css'))).uses;
    const of = (selector: string) => journey.filter((x) => x.where.split(': ')[1] === selector).map((x) => `${x.family} ${x.weight}`);
    for (const cls of ['.jt-badge', '.jl__badge', '.jt-leg__reward']) expect(of(cls), cls).toEqual(['mono 600']);
    expect(journey.filter((x) => x.weight > 600)).toEqual([]);
  });

  it('the journey header\'s <strong> status and time are 600, not the 700 a <strong> has by default', () => {
    // No stylesheet says 700 here: it is the browser's own weight for <strong>, found in headless Chrome (#737).
    const journey = weightUses(SHEETS.filter((s) => s.file.endsWith('journey/journey.css'))).uses;
    const of = (selector: string) => journey.filter((x) => x.where.split(': ')[1] === selector).map((x) => `${x.family} ${x.weight}`);
    expect(of('.jt__status strong')).toEqual(['sans 600']);
    expect(of('.jt__time strong')).toEqual(['mono 600']);
    const tsx = readFileSync('client/src/components/sim/v2/journey/JourneyTimeline.tsx', 'utf8');
    // Every <strong> of the journey sits in one of those two paragraphs.
    expect(tsx).toContain('<strong');
    const paragraphs = [...tsx.matchAll(/<p className="(jt__[\w-]+)[^"]*">([\s\S]*?)<\/p>/g)].filter((m) => m[2].includes('<strong'));
    expect(paragraphs.reduce((n, m) => n + m[2].split('<strong').length - 1, 0)).toBe(tsx.split('<strong').length - 1);
    for (const m of paragraphs) expect(['jt__status', 'jt__time']).toContain(m[1]);
  });

  it('the check itself: what it reports for a faked bold, an inherited family and an unreadable weight', () => {
    const run = (css: string) => weightUses([{ file: 'x.css', css }]);
    const found = (css: string) => run(css).uses.map((u) => `${u.where.split(': ')[1]} = ${u.family} ${u.weight}`);
    // What journey.css had before #737: mono text at 700.
    expect(found('.jt-badge { font-family: var(--font-mono); font-weight: 700; }')).toEqual(['.jt-badge = mono 700']);
    // The family set by another rule of the file, also inside @media and with a state or an attribute added.
    expect(found(`.num { font-family: var(--font-mono, 'IBM Plex Mono', monospace); }
      .row.is-on .num { font-weight: 600; }
      @media (max-width: 600px) { .num:hover { font-weight: 500; } }
      .row .name { font-weight: 600; }`)).toEqual(['.row.is-on .num = mono 600', '.num:hover = mono 500', '.row .name = sans 600']);
    expect(found(`.n dd { font-family: var(--font-mono); } .n[data-k="reward"] dd { font-weight: 500; } .other dd { font-weight: 600; }`))
      .toEqual(['.n[data-k="reward"] dd = mono 500', '.other dd = sans 600']);
    // Narrower mono rules do not make the wider element mono.
    expect(found(`.f input[type='time'] { font-family: var(--font-mono); } .f input { font-weight: 600; }`)).toEqual(['.f input = sans 600']);
    // A group of selectors is one use each, with its own family.
    expect(found('.time strong { font-family: var(--font-mono); } .status strong, .time strong { font-weight: 600; }'))
      .toEqual(['.status strong = sans 600', '.time strong = mono 600']);
    // The kit's .mono class, keywords and the shorthand.
    expect(found('.total.mono { font-weight: bold; }')).toEqual(['.total.mono = mono 700']);
    expect(found('.a { font-weight: normal; } .b { font: 600 14px/1.4 Inter; } .c { font: inherit; } .d { font: inherit; font-weight: 500; }'))
      .toEqual(['.a = sans 400', '.b = sans 600', '.d = sans 500']);
    expect(found('.e { font: 12px var(--font-mono); }')).toEqual(['.e = mono 400']);
    // Never skipped silently.
    expect(run('.g { font-weight: bolder; } .h { font-weight: var(--w); }').unreadable)
      .toEqual(['x.css: .g { font-weight: bolder }', 'x.css: .h { font-weight: var(--w) }']);
    // A comment is not a rule.
    expect(found('/* .z { font-weight: 900; } */ .y { font-weight: 400; }')).toEqual(['.y = sans 400']);
  });

  it('every imported weight is one the UI uses (400 is the default weight of body text and .mono)', () => {
    const used: Record<Family, Set<number>> = { sans: new Set([400]), mono: new Set([400]) };
    for (const u of weightUses(SHEETS).uses) used[u.family].add(u.weight);
    for (const family of ['sans', 'mono'] as const) {
      for (const w of importedWeights(family)) expect(used[family].has(w), `${family} ${w}`).toBe(true);
    }
  });

  it('the font names in the imported files are the first names of --font-sans and --font-mono', () => {
    const tokens = read('client/src/styles/tokens.css');
    const first = (name: string) => new RegExp(`${name}\\s*:\\s*"([^"]+)"`).exec(tokens)![1];
    const faceName = (pkg: string) => /font-family:\s*'([^']+)'/.exec(readFileSync(join('node_modules', pkg, 'latin-400.css'), 'utf8'))![1];
    expect(first('--font-sans')).toBe('Inter');
    expect(faceName(PKG.sans)).toBe('Inter');
    expect(first('--font-mono')).toBe(faceName(PKG.mono));
  });

  it('package.json lists @fontsource/inter and no longer IBM Plex Sans, and nothing imports it', () => {
    const deps = JSON.parse(readFileSync('package.json', 'utf8')).dependencies as Record<string, string>;
    expect(Object.keys(deps)).toEqual(expect.arrayContaining(['@fontsource/inter', '@fontsource/ibm-plex-mono']));
    expect(deps['@fontsource/ibm-plex-sans']).toBeUndefined();
    expect(readFileSync('package-lock.json', 'utf8')).not.toContain('@fontsource/ibm-plex-sans');
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.(css|tsx?|html)$/.test(e.name) ? [join(dir, e.name)] : []);
    for (const file of walk('client')) expect(readFileSync(file, 'utf8'), file).not.toContain('@fontsource/ibm-plex-sans');
  });

  it('no stylesheet or index.html references an external font host', () => {
    const EXTERNAL = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|@import\s+(url\()?['"]?https?:/;
    for (const file of [...STYLESHEETS, 'client/index.html']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(EXTERNAL);
    }
  });
});
