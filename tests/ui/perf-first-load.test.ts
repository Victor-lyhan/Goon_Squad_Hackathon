// #885: the first load of `/` downloads the shell and the homepage only. The Business, Employee and
// simulator pages are lazy routes of client/src/App.tsx, each its own chunk, and the simulator's map code
// (deck.gl, the Google Maps loader) comes with the simulator, never with `/`.
//
// No build here (the browser numbers are in the PR). This pins the three things a build splits on:
//   1. App.tsx loads the three pages with `lazy(() => import(...))` inside one <Suspense> in <main>;
//   2. nothing the entry (client/src/main.tsx) imports statically reaches a workspace page, `@deck.gl` or
//      `@googlemaps`, and neither does the homepage (client/src/pages/Landing.tsx);
//   3. a lazy route renders the shell's loading line first and the page once its module is there, with the
//      same header in both.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_LOADING_TEXT } from '../../client/src/App';
import { SIM_POLL_MS } from '../../client/src/components/sim/v2/live/simPoller';
import { HEALTH_POLL_MS } from '../../client/src/ui/connectionModel';
import { RUN_POLL_MS } from '../../client/src/ui/shellModel';
import { LAZY_ROUTE_PATHS, loadWorkspacePages, shellMarkup } from './lazy-pages-helper';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'client/src');
const ENTRY = join(SRC, 'main.tsx');
const APP = join(SRC, 'App.tsx');
const LANDING = join(SRC, 'pages/Landing.tsx');
const PAGES = ['SimulatorV2', 'EmployeeV2', 'BusinessV2'] as const;
const pageFile = (name: string) => join(SRC, 'pages/v2', `${name}.tsx`);
/** Packages that belong to the simulator's map and must not be in the first load of `/`. */
const MAP_PACKAGES = /^(@deck\.gl|@googlemaps|@luma\.gl|@loaders\.gl|@math\.gl)\//;

// ---------- the import graph, read from the source ----------

type Imports = { static: string[]; dynamic: string[] };

/** Block and line comments removed (a `//` inside a string ends the line too; no import follows one here). */
const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** True for `{ type A, type B }`: every name is a type, so the import is erased by the build. */
function onlyTypes(clause: string): boolean {
  const m = /^\{([\s\S]*)\}$/.exec(clause.trim());
  if (!m) return false;
  const names = m[1].split(',').map((n) => n.trim()).filter(Boolean);
  return names.length > 0 && names.every((n) => /^type\s/.test(n));
}

/** The module specifiers a source file imports: `import`/`export ... from` (types left out) and `import()`. */
export function importsOf(code: string): Imports {
  const text = withoutComments(code);
  const out: Imports = { static: [], dynamic: [] };
  // import x from 'm' | import { a, type B } from 'm' | import * as x from 'm' | import 'm' | export { a } from 'm' | export * from 'm'
  const statik = /(?<![\w$.])(import|export)\s+(?:(type)\s+(?=[\w{*]))?(?:([\w\s{},*$]+?)\s+from\s+)?(['"])([^'"\n]+)\4/g;
  for (const m of text.matchAll(statik)) {
    const [, keyword, typeOnly, clause, , spec] = m;
    if (keyword === 'export' && clause === undefined) continue; // not a re-export
    if (typeOnly || (clause !== undefined && onlyTypes(clause))) continue;
    out.static.push(spec);
  }
  for (const m of text.matchAll(/(?<![\w$.])import\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g)) out.dynamic.push(m[2]);
  return out;
}

/** A relative specifier as a source file of the repo, or null for a file that is not code (CSS, an image). */
function resolveFile(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const p of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(p) && statSync(p).isFile()) return /\.tsx?$/.test(p) ? p : null;
  }
  throw new Error(`${relative(ROOT, from)} imports ${spec}, which is not a file`);
}

type Reach = { files: Set<string>; packages: Set<string>; lazy: Set<string> };

/**
 * Everything `entry` loads at once: the files and packages reached through static imports only. `lazy` holds
 * the files and packages behind an `import()` on the way (each one is a chunk boundary in the build).
 */
function reach(entry: string): Reach {
  const out: Reach = { files: new Set(), packages: new Set(), lazy: new Set() };
  const todo = [entry];
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (out.files.has(file)) continue;
    out.files.add(file);
    const imports = importsOf(readFileSync(file, 'utf8'));
    for (const spec of imports.static) {
      if (!spec.startsWith('.')) { out.packages.add(spec); continue; }
      const target = resolveFile(file, spec);
      if (target) todo.push(target);
    }
    for (const spec of imports.dynamic) out.lazy.add(spec.startsWith('.') ? resolveFile(file, spec) ?? spec : spec);
  }
  return out;
}

const rel = (files: Iterable<string>) => [...files].map((f) => relative(ROOT, f)).sort();
const mapPackages = (r: Reach) => [...r.packages].filter((p) => MAP_PACKAGES.test(p)).sort();

describe('the import reader of this test', () => {
  it('reads value imports, re-exports and import(), and leaves type imports out', () => {
    const code = [
      "import a from './a';",
      "import { b, type B } from './b';",
      "import * as c from './c';",
      "import './d.css';",
      "import type { E } from './e';",
      "import { type F, type G } from './f';",
      "export { h } from './h';",
      "export * from './i';",
      "export type { J } from './j';",
      'import {',
      '  k1, k2,',
      "} from './k';",
      "// import l from './l';",
      "/* import m from './m'; */",
      "export const n = 'from';",
      "const O = lazy(() => import('./o'));",
      "const p = await import('pkg/p');",
      "const q = obj.import('./q');",
    ].join('\n');
    expect(importsOf(code)).toStrictEqual({
      static: ['./a', './b', './c', './d.css', './h', './i', './k'],
      dynamic: ['./o', 'pkg/p'],
    });
  });
});

describe('client/src/App.tsx: the three workspace pages are lazy routes (#885)', () => {
  const source = readFileSync(APP, 'utf8');
  const code = withoutComments(source);
  const imports = importsOf(source);

  it.each(PAGES)('%s is loaded with lazy(() => import(...)) and never imported statically', (name) => {
    const spec = `./pages/v2/${name}`;
    expect(imports.static).not.toContain(spec);
    expect(imports.dynamic).toContain(spec);
    expect(code).toMatch(new RegExp(`const ${name} = lazy\\(\\(\\) => import\\('${spec.replace(/[./]/g, '\\$&')}'\\)\\);`));
    // The route renders the lazy component itself (no eager wrapper in between).
    expect(code).toMatch(new RegExp(`<Route path="[^"]+" element=\\{<${name} />\\} />`));
  });

  it('the homepage is not lazy: `/` paints with the first script', () => {
    expect(imports.static).toContain('./pages/Landing');
    expect(imports.dynamic).toStrictEqual(PAGES.map((name) => `./pages/v2/${name}`));
  });

  it('one <Suspense> wraps the route table, inside <main> and the error boundary, below the header', () => {
    const at = (text: string) => {
      const i = code.indexOf(text);
      expect(i, text).toBeGreaterThan(-1);
      expect(code.indexOf(text, i + 1), `${text} is there once`).toBe(-1);
      return i;
    };
    const order = ['<Header ', '<main ', '<ErrorBoundary ', '<Suspense ', '<Routes>', '</Routes>', '</Suspense>', '</ErrorBoundary>', '</main>'].map(at);
    expect(order).toStrictEqual([...order].sort((a, b) => a - b));
    // The loading line: the shell's own page-state style, announced politely, plain words.
    expect(code).toContain('<Suspense fallback={<p className="shell-page-state" role="status">{PAGE_LOADING_TEXT}</p>}>');
    expect(PAGE_LOADING_TEXT).toBe('Loading page…');
  });
});

describe('what the first script of `/` pulls in (static imports from client/src/main.tsx)', () => {
  const first = reach(ENTRY);

  it('the shell and the homepage, and no workspace page', () => {
    expect(first.files).toContain(APP);
    expect(first.files).toContain(LANDING);
    for (const name of PAGES) expect(first.files, name).not.toContain(pageFile(name));
    // The pages' own folders hold the simulator, the map and the two workspaces: none of it is in the first load.
    expect(rel(first.files).filter((f) => /^client\/src\/(pages\/v2|components)\//.test(f))).toStrictEqual([]);
  });

  it('no deck.gl and no Google Maps loader', () => {
    expect(mapPackages(first)).toStrictEqual([]);
    // The one stylesheet is Archivo, the display face (#955): a font file the browser fetches by itself, no script.
    expect([...first.packages].sort()).toStrictEqual(['@fontsource-variable/archivo/wdth.css', 'react', 'react-dom/client', 'react-router-dom']);
  });

  it('the three pages are the only chunks the shell loads later', () => {
    expect(rel(first.lazy as Set<string>)).toStrictEqual(rel(PAGES.map(pageFile)));
  });

  it('the simulator page is where the map code lives, so the reader would see it in the first load', () => {
    const sim = reach(pageFile('SimulatorV2'));
    const all = new Set([...sim.packages, ...[...sim.lazy].filter((s) => !s.startsWith('/'))]);
    expect([...all].some((p) => p.startsWith('@googlemaps/')), '@googlemaps').toBe(true);
    expect([...all].some((p) => p.startsWith('@deck.gl/')), '@deck.gl').toBe(true);
  });
});

describe('client/src/pages/Landing.tsx', () => {
  it('imports nothing from @deck.gl or @googlemaps, directly or through its own modules', () => {
    const landing = reach(LANDING);
    expect(mapPackages(landing)).toStrictEqual([]);
    expect([...landing.lazy]).toStrictEqual([]);
    expect(rel(landing.files).filter((f) => /^client\/src\/(pages\/v2|components)\//.test(f))).toStrictEqual([]);
  });
});

describe('a lazy route in the shell', () => {
  const header = (html: string) => /<header class="shell-header">[\s\S]*?<\/header>/.exec(html)?.[0];
  const main = (html: string) => /<main [^>]*>[\s\S]*<\/main>/.exec(html)?.[0] ?? '';
  const mainTag = (html: string) => /<main [^>]*>/.exec(html)?.[0];
  const LOADING_LINE = `<p class="shell-page-state" role="status">${PAGE_LOADING_TEXT}</p>`;
  /** The markup of each lazy route before its module arrived. */
  const before = new Map<string, string>();

  it('`/` shows the homepage at once, with no loading line', () => {
    const html = shellMarkup('/');
    expect(main(html)).not.toContain(PAGE_LOADING_TEXT);
    expect(main(html)).toContain('<h1');
  });

  it.each(LAZY_ROUTE_PATHS)('%s first shows the header and one plain loading line in <main>', (path) => {
    const html = shellMarkup(path);
    before.set(path, html);
    expect(header(html)).toBeDefined();
    expect(main(html)).toContain(LOADING_LINE);
    // Nothing else is in <main> yet (React's markers for the pending boundary aside).
    expect(main(html).replace(/<!--[\s\S]*?-->|<template[^>]*><\/template>/g, '')).toBe(`${mainTag(html)}${LOADING_LINE}</main>`);
  });

  it.each(LAZY_ROUTE_PATHS)('%s shows its page once the module is there, under the very same header', async (path) => {
    await loadWorkspacePages();
    const html = shellMarkup(path);
    expect(main(html)).not.toContain(PAGE_LOADING_TEXT);
    expect(main(html).length).toBeGreaterThan(`${mainTag(html)}${LOADING_LINE}</main>`.length);
    // No jump in the header: its markup, and the width class of <main>, are the same in both states.
    const loading = before.get(path)!;
    expect(header(html)).toBe(header(loading));
    expect(mainTag(html)).toBe(mainTag(loading));
  });
});

describe('poll intervals (the browser check of #885 counts requests against these)', () => {
  it('the simulator is read once a second, the health check and the header\'s run check every 3 s', () => {
    expect(SIM_POLL_MS).toBe(1000);
    expect(HEALTH_POLL_MS).toBe(3000);
    expect(RUN_POLL_MS).toBe(3000);
  });
});
