import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (p: string) => strip(readFileSync(p, 'utf8'));

const fontsCss = read('client/src/styles/fonts.css');
const globalCss = read('client/src/styles/global.css');

const IMPORT_RE = /@import\s+['"]([^'"]+)['"]\s*;/g;
const imports = [...fontsCss.matchAll(IMPORT_RE)].map((m) => m[1]);

/** 'display' is Archivo (#955): one variable file, so every weight from 100 to 900 is a real face. */
type Family = 'sans' | 'mono' | 'display';
type StaticFamily = Exclude<Family, 'display'>;
/** Inter for UI, IBM Plex Mono for times, IDs, distances and prices (docs/mvp3.md P4, #651). */
const PKG: Record<StaticFamily, string> = { sans: '@fontsource/inter', mono: '@fontsource/ibm-plex-mono' };
/** Archivo for headings and big numbers (#955), loaded once by client/src/main.tsx, not by fonts.css. */
const DISPLAY_IMPORT = '@fontsource-variable/archivo/wdth.css';
const displayCss = readFileSync(join('node_modules', DISPLAY_IMPORT), 'utf8');
/** The two ends of an axis in the file's @font-face rules: `font-weight: 100 900`, `font-stretch: 62% 125%`. */
const axis = (prop: string): [number, number] => {
  const m = new RegExp(`${prop}:\\s*(\\d+)%?\\s+(\\d+)%?;`).exec(displayCss)!;
  return [Number(m[1]), Number(m[2])];
};
const DISPLAY_WEIGHTS = axis('font-weight');
const DISPLAY_WIDTHS = axis('font-stretch');

function importedWeights(family: StaticFamily): Set<number> {
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
  return DISPLAY_RE.test(value) ? 'display' : MONO_RE.test(value) ? 'mono' : 'sans';
}
const DISPLAY_RE = /--font-display|Archivo/;
/** True when a stylesheet may ask for this weight in this family: a loaded face, or inside Archivo's range. */
function loaded(family: Family, weight: number): boolean {
  if (family === 'display') return weight >= DISPLAY_WEIGHTS[0] && weight <= DISPLAY_WEIGHTS[1];
  return importedWeights(family).has(weight);
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
    const displaySelectors = rules.filter((r) => ownFamily(r) === 'display').flatMap((r) => r.selectors);
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
        const family: Family = ownFamily(r)
          ?? (monoSelectors.some((m) => selects(selector, m)) ? 'mono' : displaySelectors.some((m) => selects(selector, m)) ? 'display' : 'sans');
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
    const { uses, unreadable } = weightUses(SHEETS);
    expect(uses.length).toBeGreaterThan(50);
    expect(unreadable).toEqual([]);
    const bad = uses
      .filter((u) => !loaded(u.family, u.weight) && !EXEMPT.includes(u.where))
      .map((u) => `${u.where}: ${u.family} ${u.weight}`);
    expect(bad).toEqual([]);
    // An exemption that no longer fails is removed, so the list never hides a new fault.
    for (const e of EXEMPT) expect(uses.some((u) => u.where === e && !loaded(u.family, u.weight)), e).toBe(true);
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

  it('h1 to h6, strong, b and th get 600 from global.css, not the 700 the browser gives them (#743, #757)', () => {
    // No stylesheet says 700 for these: it is the browser's own weight, and no 700 face is loaded, so the
    // bold was faked (seen in headless Chrome on the New delivery form's result line, #743). Every h3 has a
    // class rule at 600 today; a new h3 to h6 without one would be faked the same way (#757).
    const sheet = SHEETS.filter((s) => s.file.endsWith('styles/global.css'));
    expect(sheet).toHaveLength(1);
    const { uses } = weightUses(sheet);
    const sans = importedWeights('sans');
    const mono = importedWeights('mono');
    const TITLES = ['h1', 'h2'];
    const BOLD_BY_DEFAULT = ['h3', 'h4', 'h5', 'h6', 'strong', 'b', 'th'];
    for (const tag of [...TITLES, ...BOLD_BY_DEFAULT]) {
      const own = uses.filter((u) => u.where.split(': ')[1] === tag);
      expect(own.map((u) => u.weight), tag).toEqual([600]);
      // The tag takes its family from the text around it, so the weight must be a loaded face of both.
      for (const u of own) {
        expect(u.weight, tag).toBeLessThanOrEqual(600);
        expect(sans.has(u.weight), `${tag}: Inter ${u.weight}`).toBe(true);
        expect(mono.has(u.weight), `${tag}: IBM Plex Mono ${u.weight}`).toBe(true);
      }
    }
    // One rule for h3 to h6 and the three tags, with no class in front, so it reaches every page. It sets
    // the weight only: h3 to h6 keep the browser's margin and line height, so no heading moves.
    const rule = rulesOf(sheet[0].css).filter((r) => BOLD_BY_DEFAULT.some((t) => r.selectors.includes(t)));
    expect(rule).toHaveLength(1);
    expect([...rule[0].selectors].sort()).toEqual([...BOLD_BY_DEFAULT].sort());
    expect([...rule[0].decls]).toEqual([['font-weight', '600']]);
    // h1 and h2 have had their 600 from one rule of their own since the kit, also with no class in front.
    const titleRule = rulesOf(sheet[0].css).filter((r) => TITLES.some((t) => r.selectors.includes(t)) && r.decls.has('font-weight'));
    expect(titleRule).toHaveLength(1);
    expect([...titleRule[0].selectors].sort()).toEqual(TITLES);
    expect(titleRule[0].decls.get('font-weight')).toBe('600');
    // global.css is the stylesheet App.tsx loads for every page.
    expect(readFileSync('client/src/App.tsx', 'utf8')).toMatch(/import\s+['"]\.\/styles\/global\.css['"]/);
    // No stylesheet sets one of these tags back to a weight with no face (also caught by the test above).
    const isTag = (selector: string) => /(^|[\s>+~])(h[1-6]|strong|b|th)([.:[#][^\s>+~]*)?$/.test(selector);
    const all = weightUses(SHEETS).uses.filter((u) => isTag(u.where.split(': ')[1]));
    // The check sees the component rules too (`.ew h1`, `.bp-missing h2`), not only global.css.
    expect(all.some((u) => /\sh1$/.test(u.where.split(': ')[1]) && !u.where.startsWith('client/src/styles/global.css'))).toBe(true);
    // Heavier than 600 only in Archivo, which has the face (the homepage's title and section heading, #955).
    expect(all.filter((u) => u.weight > 600 && u.family !== 'display')).toEqual([]);
    expect(all.filter((u) => u.weight > 600).map((u) => u.where.split(': ')[1]).sort()).toEqual(['.landing-hero h1', '.landing-how h2']);
    for (const s of ['h4', '.card h4', '.card > h5.title', 'h3:first-child', 'h6[id]', 'h2#top', 'td strong', 'b', 'tr > th.num']) expect(isTag(s), s).toBe(true);
    for (const s of ['.h4', '.th', '.job-v2__h3', 'h4 span', 'thead', 'h7', '.b']) expect(isTag(s), s).toBe(false);
    // What the check reports when the rule is missing its weight, says bold, or has lost a tag.
    const found = (css: string) => weightUses([{ file: 'x.css', css }]).uses.map((u) => `${u.where.split(': ')[1]} = ${u.family} ${u.weight}`);
    expect(found('strong, b, th { font-weight: bold; }')).toEqual(['strong = sans 700', 'b = sans 700', 'th = sans 700']);
    expect(found('strong, b, th { color: red; }')).toEqual([]);
    expect(found('h3, h5, h6 { font-weight: 600; }')).toEqual(['h3 = sans 600', 'h5 = sans 600', 'h6 = sans 600']); // no h4
    expect(found('.panel h4 { font-weight: 700; }')).toEqual(['.panel h4 = sans 700']);
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
    const used: Record<Family, Set<number>> = { sans: new Set([400]), mono: new Set([400]), display: new Set() };
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

describe('self-hosted Archivo, the display face (#955)', () => {
  /** The client's own source files (not the build, not the static files under public/). */
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? (e.name === 'dist' || e.name === 'public' ? [] : sources(join(dir, e.name)))
      : /\.(css|tsx?|html)$/.test(e.name) ? [join(dir, e.name)] : []);

  it('package.json lists @fontsource-variable/archivo, and the client entry imports its width-axis file once', () => {
    const deps = JSON.parse(readFileSync('package.json', 'utf8')).dependencies as Record<string, string>;
    expect(deps['@fontsource-variable/archivo']).toBeDefined();
    expect(readFileSync('package-lock.json', 'utf8')).toContain('node_modules/@fontsource-variable/archivo');
    const imports = (file: string) => readFileSync(file, 'utf8').match(/^\s*(?:@import|import)\s+['"]@fontsource-variable\/[^'"]+['"];/gm) ?? [];
    const importers = sources('client').filter((file) => imports(file).length > 0);
    expect(importers).toEqual([join('client/src', 'main.tsx')]);
    expect(imports(importers[0]!)).toEqual([`import '${DISPLAY_IMPORT}';`]);
  });

  it('the file is one variable face per subset: every weight, condensed to wide, font-display: swap, woff2 of the package', () => {
    const faces = displayCss.split('@font-face').slice(1);
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toMatch(/font-family:\s*'Archivo Variable'/);
      expect(face).toMatch(/font-style:\s*normal/);
      expect(face).toMatch(/font-display:\s*swap/);
      expect(face).toMatch(/url\(\.\/files\/[\w-]+\.woff2\)/); // a file of the package, no other host
      expect(face).toMatch(/unicode-range:/); // so only the Latin file is fetched for this app's text
    }
    expect(DISPLAY_WEIGHTS).toEqual([100, 900]);
    expect(DISPLAY_WIDTHS).toEqual([62, 125]);
  });

  it('--font-display starts with the face\'s name, then Inter and the system stack', () => {
    const tokens = read('client/src/styles/tokens.css');
    const stack = /--font-display\s*:\s*([^;]+);/.exec(tokens)![1].split(',').map((s) => s.trim());
    expect(stack.slice(0, 3)).toEqual(['"Archivo Variable"', '"Inter"', 'system-ui']);
    expect(stack.at(-1)).toBe('sans-serif');
  });

  it('every rule that sets Archivo names it through the token with the face as the fallback, and states its weight', () => {
    const rules = SHEETS.flatMap(({ file, css }) => rulesOf(css).filter((r) => ownFamily(r) === 'display').map((r) => ({ file, r })));
    expect(rules.length).toBeGreaterThanOrEqual(8); // the header's name and links; the homepage's title, heading, figure and buttons
    for (const { file, r } of rules) {
      const where = `${file}: ${r.selectors.join(', ')}`;
      expect(r.decls.get('font-family'), where).toBe("var(--font-display, 'Archivo Variable', 'Inter', system-ui, sans-serif)");
      // The weight is stated where the face is, so a heading's or a link's inherited weight is never left to chance.
      expect(r.decls.get('font-weight'), where).toMatch(/^[1-9]00$/);
    }
  });

  it('every width asked of it is on the axis: condensed (under 100%) for large type, wide (over 100%) for small type', () => {
    const sized: { where: string; px: number; width: number }[] = [];
    for (const { file, css } of SHEETS) {
      for (const r of rulesOf(css)) {
        const stretch = r.decls.get('font-stretch');
        if (stretch === undefined) continue;
        const where = `${file}: ${r.selectors.join(', ')}`;
        expect(stretch, where).toMatch(/^\d+%$/);
        const width = Number.parseFloat(stretch);
        expect(width, where).toBeGreaterThanOrEqual(DISPLAY_WIDTHS[0]);
        expect(width, where).toBeLessThanOrEqual(DISPLAY_WIDTHS[1]);
        // The largest size the rule can reach: the last length of a clamp(), or the plain size.
        const px = /(\d+(?:\.\d+)?)px\)?$/.exec(r.decls.get('font-size') ?? '')?.[1];
        if (px !== undefined) sized.push({ where, px: Number(px), width });
      }
    }
    expect(sized.length).toBeGreaterThanOrEqual(8);
    for (const { where, px, width } of sized) {
      if (px >= 30) expect(width, where).toBeLessThan(100);
      if (px <= 20) expect(width, where).toBeGreaterThanOrEqual(100);
    }
  });
});
