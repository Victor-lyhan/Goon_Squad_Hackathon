// #893: no jargon in the text a person reads (human polish backlog, QUESTIONS 23:01, items 6 and 7).
//
// Parses every .ts / .tsx file under client/src and fails when visible text holds one of the JARGON
// words. Internal names stay (QUESTIONS pass 44): `hub_drop`, `at_hub`, `relayBusinessId`, a `tripId`
// field, a `/api/v2` path or a `=== null` check are code, not text.
//
// What counts as text a person reads:
//   1. JSX text, and a string that a JSX `{...}` child renders (also through `a ? 'x' : 'y'`, `&&`, `+`).
//   2. The attributes in VISIBLE_ATTRS (aria-label, title, placeholder, alt, label, ...; also data-label,
//      which businessWorkspace.css prints in front of each table cell on a phone).
//   3. A constant named like copy (COPY_CONST: ..._TEXT, ..._LABEL, ..._TITLE, ..._COPY, ...), exported or not.
//   4. Any other string in code that reads like words: two or more words, or one Capitalised word
//      ('Relay point', 'Delivered'). This catches the model functions that return a label or a sentence.
// What never counts: comments, imports, types, class names and the other SKIP_ATTRS, object keys,
// a string compared with === or used as a `case` (enum values), console.* text, DOM selectors, and a
// single code-shaped token ('tripId', 'phase', '/api/health').
//
// Limits: one lower-case word returned by a function ('hub') is not seen by rule 4; text built at
// run time from data (String(value) showing "null") cannot be seen at all; CSS `content:` and
// client/index.html are outside client/src code and are not read.
//
// When this fails: reword the text. Add a line to ALLOWED only for text that was already there and
// whose file an open issue holds, and name that issue.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'vite';
import { describe, expect, it } from 'vitest';

const CLIENT_SRC = 'client/src';

/** The word list of #893. `word` is the name used in ALLOWED and in the failure message. */
const JARGON: ReadonlyArray<{ word: string; re: RegExp }> = [
  { word: 'hub', re: /\bhubs?\b/i },
  { word: 'trip id', re: /\btrip[\s-]ids?\b/i },
  { word: 'tripId', re: /\btripids?\b/i },
  { word: 'API', re: /\bapis?\b/i },
  { word: 'backend', re: /\bback[\s-]?ends?\b/i },
  { word: 'endpoint', re: /\bend[\s-]?points?\b/i },
  { word: 'payload', re: /\bpayloads?\b/i },
  { word: '409', re: /\b409\b/ },
  { word: 'phase', re: /\bphases?\b/i },
  { word: 'null', re: /\bnull\b/i },
  { word: 'undefined', re: /\bundefined\b/i },
];

/**
 * Text that was on main when this guard was added, with the open issue that holds its file. The
 * guard passes with these and fails on anything new. An entry matches one exact text in one file,
 * so a fixed line that comes back in other words still fails. An entry whose text is gone does not
 * fail the test (the fix may merge before or after this file); delete it when you see it.
 */
// Empty since #890 reworded the map's rejected-key hint ("turn on Maps JavaScript and billing").
const ALLOWED: ReadonlyArray<{ file: string; word: string; text: string; module: string; issue: string }> = [];

// ---- which strings are text ----

/** Attributes whose value a person reads or hears. */
const VISIBLE_ATTRS = new Set([
  'aria-label', 'title', 'placeholder', 'alt', 'label', 'aria-description', 'aria-valuetext',
  'aria-roledescription', 'aria-placeholder', 'emptyText', 'heading', 'hint', 'caption', 'summary',
  'data-label', // shown through content: attr(data-label)
]);
/** Attributes that hold names, ids, addresses or drawing data; never text. Any other `data-*` is skipped too. */
const SKIP_ATTRS = new Set([
  'className', 'class', 'id', 'key', 'href', 'to', 'src', 'role', 'type', 'name', 'htmlFor', 'style',
  'target', 'rel', 'path', 'd', 'viewBox', 'points', 'transform', 'fill', 'stroke', 'testId',
  'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-live', 'aria-current', 'autoComplete',
  'inputMode',
]);
/** `export const SAVED_TEXT`, `PLAY_LABEL`, `ADVICE_COPY`, `HOW_STEPS`, ...: the names this client gives its copy. */
const COPY_CONST = /^[A-Z][A-Z0-9_]*_(TEXT|COPY|LABEL|TITLE|MESSAGE|NOTE|HINT|LINE|HEADING|REASON|ALT|INTRO|STEPS|LEGEND|TAG|NAME)$/;
/** Inside a copy constant, the value under one of these keys is a code value, read by rule 4 only. */
const CODE_KEYS = new Set([
  'id', 'key', 'kind', 'type', 'href', 'to', 'path', 'className', 'testId', 'tone', 'variant', 'icon',
  'symbol', 'status', 'role',
]);
/** Calls whose first argument is a selector, an event name or an attribute name. */
const SELECTOR_CALLS = new Set([
  'querySelector', 'querySelectorAll', 'closest', 'matches', 'matchMedia', 'getElementById',
  'addEventListener', 'removeEventListener', 'getAttribute', 'setAttribute', 'hasAttribute',
  'removeAttribute',
]);
const EQUALITY = new Set(['==', '===', '!=', '!==']);
const TS_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion']);

/** Rule 4: two or more words, or one Capitalised word. 'tripId', 'at_hub', '/api/v2' and '409' are code. */
function readsLikeWords(text: string): boolean {
  return /\s/.test(text) ? /[A-Za-z]/.test(text) : /^[A-Z][A-Za-z]*[.,:;!?…]*$/.test(text);
}

type Node = { type: string; start: number; end: number; [key: string]: unknown };
type Mode = 'sure' | 'maybe'; // sure: rules 1-3, every string counts. maybe: rule 4.
type Text = { file: string; line: number; where: string; text: string };

const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && typeof (v as Node).type === 'string';
const nodes = (v: unknown): Node[] => (Array.isArray(v) ? v.filter(isNode) : isNode(v) ? [v] : []);
const isString = (n: unknown): n is Node => isNode(n) && n.type === 'Literal' && typeof n.value === 'string';
const nameOf = (n: unknown): string => {
  if (!isNode(n)) return '';
  if (n.type === 'JSXNamespacedName') return `${nameOf(n.namespace)}:${nameOf(n.name)}`;
  return typeof n.name === 'string' ? n.name : '';
};

/** Every piece of text a person reads in one source file, in source order. */
function visibleTexts(file: string, source: string): Text[] {
  const parsed = parseSync(file, source);
  if (parsed.errors.length > 0) throw new Error(`${file} does not parse: ${parsed.errors[0].message}`);
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= pos) line++;
    return line + 1;
  };

  const out: Text[] = [];
  const see = (n: Node, raw: string, mode: Mode, where: string) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text || (mode === 'maybe' && !readsLikeWords(text))) return;
    out.push({ file, line: lineOf(n.start), where: mode === 'sure' ? where : 'words in code', text });
  };
  const each = (v: unknown, mode: Mode, where: string) => nodes(v).forEach((c) => visit(c, mode, where));
  const children = (n: Node, where: string) => {
    for (const [key, value] of Object.entries(n)) if (key !== 'type') each(value, 'maybe', where);
  };
  const jsxChildren = (n: Node) => {
    for (const child of nodes(n.children)) {
      if (child.type === 'JSXExpressionContainer') each(child.expression, 'sure', 'JSX text');
      else visit(child, 'maybe', '');
    }
  };

  function visit(n: Node, mode: Mode, where: string): void {
    if (TS_WRAPPERS.has(n.type)) return each(n.expression, mode, where);
    if (n.type.startsWith('TS')) return; // types, interfaces, enums
    switch (n.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ImportExpression':
        return;
      case 'ExportNamedDeclaration':
        return each(n.declaration, 'maybe', '');
      case 'Literal':
        if (typeof n.value === 'string') see(n, n.value, mode, where);
        return;
      case 'TemplateLiteral': {
        // One text per template; "…" stands for each ${value}, so `${API}/trips/${id}` stays one token.
        const cooked = nodes(n.quasis).map((q) => String((q.value as { cooked?: string }).cooked ?? ''));
        see(n, cooked.join('…'), mode, where);
        return each(n.expressions, mode, where);
      }
      case 'JSXText':
        return see(n, String(n.value), 'sure', 'JSX text');
      case 'JSXElement':
        each((n.openingElement as Node).attributes, 'maybe', '');
        return jsxChildren(n);
      case 'JSXFragment':
        return jsxChildren(n);
      case 'JSXAttribute': {
        const name = nameOf(n.name);
        const visible = VISIBLE_ATTRS.has(name);
        if (!visible && (SKIP_ATTRS.has(name) || name.startsWith('data-'))) return;
        const value = n.value as Node | null;
        const [m, w]: [Mode, string] = visible ? ['sure', name] : ['maybe', ''];
        return each(value?.type === 'JSXExpressionContainer' ? value.expression : value, m, w);
      }
      case 'VariableDeclarator': {
        const name = nameOf(n.id);
        if (COPY_CONST.test(name)) return each(n.init, 'sure', `const ${name}`);
        each(n.id, 'maybe', '');
        return each(n.init, 'maybe', '');
      }
      case 'ParenthesizedExpression':
        return each(n.expression, mode, where);
      case 'ConditionalExpression':
        each(n.test, 'maybe', '');
        each(n.consequent, mode, where);
        return each(n.alternate, mode, where);
      case 'LogicalExpression':
        each(n.left, mode, where);
        return each(n.right, mode, where);
      case 'BinaryExpression': {
        const operands = [n.left, n.right];
        if (EQUALITY.has(String(n.operator))) return operands.filter((o) => !isString(o)).forEach((o) => each(o, 'maybe', ''));
        const m: Mode = n.operator === '+' ? mode : 'maybe';
        return operands.forEach((o) => each(o, m, where));
      }
      case 'ArrayExpression':
        return each(n.elements, mode, where);
      case 'ObjectExpression':
        for (const p of nodes(n.properties)) {
          if (p.type !== 'Property') each(p.argument, mode, where); // ...spread
          else {
            if (p.computed) each(p.key, 'maybe', '');
            const key = nameOf(p.key) || (isString(p.key) ? String(p.key.value) : '');
            each(p.value, CODE_KEYS.has(key) ? 'maybe' : mode, where);
          }
        }
        return;
      case 'ArrowFunctionExpression': {
        each(n.params, 'maybe', '');
        const body = n.body as Node;
        return each(body, body.type === 'BlockStatement' ? 'maybe' : mode, where);
      }
      case 'SwitchCase':
        if (!isString(n.test)) each(n.test, 'maybe', '');
        return each(n.consequent, 'maybe', '');
      case 'MemberExpression':
        each(n.object, 'maybe', '');
        if (n.computed && !isString(n.property)) each(n.property, 'maybe', '');
        return;
      case 'CallExpression':
      case 'NewExpression': {
        const callee = n.callee as Node;
        const calleeText = source.slice(callee.start, callee.end);
        each(callee, 'maybe', '');
        if (/^console\b/.test(calleeText)) return;
        const args = nodes(n.arguments);
        const method = callee.type === 'MemberExpression' ? nameOf(callee.property) : nameOf(callee);
        return (SELECTOR_CALLS.has(method) && isString(args[0]) ? args.slice(1) : args).forEach((a) => visit(a, 'maybe', ''));
      }
      default:
        return children(n, '');
    }
  }

  visit(parsed.program as unknown as Node, 'maybe', '');
  return out;
}

type Hit = Text & { word: string };
const jargonIn = (texts: Text[]): Hit[] =>
  texts.flatMap((t) => JARGON.filter((j) => j.re.test(t.text)).map((j) => ({ ...t, word: j.word })));
const describeHit = (h: Hit) => `${h.file}:${h.line}  "${h.word}" in ${h.where}: ${JSON.stringify(h.text)}`;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const path = join(dir, e.name).split('\\').join('/');
      if (e.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [path] : [];
    })
    .sort();
}

/** The words found in a small piece of source, as "word@where". */
const found = (source: string, file = 'sample.tsx') =>
  jargonIn(visibleTexts(file, source)).map((h) => `${h.word}@${h.where}`);

describe('#893 jargon guard: what the scan reads', () => {
  it('reads JSX text and the strings a JSX child renders', () => {
    expect(found('const A = () => <p>Dropped at the hub</p>;')).toEqual(['hub@JSX text']);
    expect(found("const A = ({ ok }: { ok: boolean }) => <p>{ok ? 'Saved' : 'The backend is down'}</p>;")).toEqual([
      'backend@JSX text',
    ]);
    expect(found("const A = ({ id }: { id: string }) => <p>{id && `Trip id ${id}`}</p>;")).toEqual(['trip id@JSX text']);
    expect(found("const A = ({ n }: { n: number }) => <b>{'Phase ' + n}</b>;")).toEqual(['phase@JSX text']);
    expect(found('const A = () => <><span>Error 409</span></>;')).toEqual(['409@JSX text']);
    // a lower-case word alone still counts when JSX renders it
    expect(found("const A = () => <td>{'null'}</td>;")).toEqual(['null@JSX text']);
    expect(found('const A = ({ rows }: { rows: string[] }) => <ul>{rows.map((r) => <li key={r}>Hub {r}</li>)}</ul>;')).toEqual([
      'hub@JSX text',
    ]);
  });

  it('reads aria-label, title, placeholder and the other visible attributes', () => {
    expect(found('const A = () => <input aria-label="tripId" title="Hub" placeholder="Paste the payload" />;')).toEqual([
      'tripId@aria-label',
      'hub@title',
      'payload@placeholder',
    ]);
    expect(found('const A = ({ n }: { n: number }) => <img alt={`Hub ${n}`} />;')).toEqual(['hub@alt']);
    expect(found("const A = ({ on }: { on: boolean }) => <button aria-label={on ? 'Stop' : 'Call the endpoint'} />;")).toEqual([
      'endpoint@aria-label',
    ]);
    expect(found('const A = () => <Field label="Trip ID" emptyText="undefined" />;')).toEqual([
      'trip id@label',
      'undefined@emptyText',
    ]);
    expect(found('const A = () => <td data-label="Trip ID" data-testid="hub">12</td>;')).toEqual(['trip id@data-label']);
  });

  it('reads copy constants, exported or not, with their nested values', () => {
    expect(found("export const SAVE_FAILED_TEXT = 'The API did not answer.';", 'm.ts')).toEqual(['API@const SAVE_FAILED_TEXT']);
    expect(found("const STOP_LABEL = { hub_drop: 'hub', pickup: 'Pick up' } as const;", 'm.ts')).toEqual(['hub@const STOP_LABEL']);
    expect(found("export const ADVICE_COPY = { title: 'Options', note: (n: number) => `${n} hubs` };", 'm.ts')).toEqual([
      'hub@const ADVICE_COPY',
    ]);
    expect(found("export const HOW_STEPS = [{ id: 'hub', title: 'Send' }, { id: 'b', title: 'Second phase' }];", 'm.ts')).toEqual([
      'phase@const HOW_STEPS',
    ]);
  });

  it('reads words in code: a returned label or sentence, an error message, a prop', () => {
    expect(found("export function statusText(s: string) { return s === 'at_hub' ? 'At the hub' : 'Delivered'; }", 'm.ts')).toEqual([
      'hub@words in code',
    ]);
    expect(found("export const stopName = (k: string): string => (k === 'x' ? 'Hub' : 'Home');", 'm.ts')).toEqual(['hub@words in code']);
    expect(found('export const fail = (code: number) => new Error(`Request failed (409) ${code}`);', 'm.ts')).toEqual([
      '409@words in code',
    ]);
    expect(found("const A = ({ set }: { set: (s: string) => void }) => <button onClick={() => set('Backend error')} />;")).toEqual([
      'backend@words in code',
    ]);
    expect(found('const A = () => <Panel subtitle="Trip id and stops" />;')).toEqual(['trip id@words in code']);
  });

  it('does not read comments, class names, enum values, types, field names, paths or console text', () => {
    const quiet = `
      // the hub, the trip id, the API, the backend, an endpoint, a payload, 409, a phase, null, undefined
      /** hub */
      import type { Plan } from '../api/v2';
      import { thing } from './hub';
      export { other } from './payload';
      type Phase = 'phase' | 'hub' | 'null';
      interface Row { tripId: string | null; hub?: undefined }
      enum Kind { Hub = 'hub' }
      export const API_V2_PREFIX = '/api/v2';
      export const HUB_KEY = 'hub';
      export const PLAY_REQUEST = { action: 'phase' };
      export const HERO_LEGEND = [{ kind: 'hub', label: 'Relay point' }];
      const url = (id: string) => \`\${API_V2_PREFIX}/trips/\${id}/payload\`;
      const sort = { key: 'tripId', dir: 'asc' };
      const byStatus = { at_hub: 'At relay point', hub_drop: 'Relay drop', 'null': 'None' };
      const pick = (r: Row) => r['tripId'] ?? null;
      function f(x: unknown, s: string, plan: { relayBusinessId: string | null }) {
        if (x === null || typeof x === 'undefined' || s === 'hub' || s !== 'API error') return undefined;
        switch (s) { case 'phase': case 'trip id': return plan.relayBusinessId; }
        console.warn('The backend sent a null payload', x);
        document.querySelector('.panel .hub');
        window.addEventListener('phase', () => {});
        new URLSearchParams('').get('tripId');
        return fetch('/api/health', { method: 'POST' });
      }
      const A = ({ on }: { on: boolean }) => (
        <section className="panel hub" id="phase" data-testid="trip id" data-slot="API" style={{ border: '1px solid hub' }}>
          {/* the hub */}
          <a href="/api/v2/hub" className={on ? 'hub hub--on' : 'hub'} aria-labelledby="hub phase">Relay point</a>
          <Icon kind="hub" variant="phase" path="M0 0 hub" />
        </section>
      );
    `;
    expect(found(quiet)).toEqual([]);
  });

  it('matches whole words in any case, with plurals, and leaves internal names alone', () => {
    const words = (text: string) => jargonIn([{ file: 'x', line: 1, where: 'x', text }]).map((h) => h.word);
    expect(words('Two hubs, one HUB')).toEqual(['hub']);
    expect(words('Trip ID 12')).toEqual(['trip id']);
    expect(words('trip-ids')).toEqual(['trip id']);
    expect(words('tripId is missing')).toEqual(['tripId']);
    expect(words('Our APIs and the back-end end points')).toEqual(['API', 'backend', 'endpoint']);
    expect(words('Phases: undefined / NULL (409)')).toEqual(['409', 'phase', 'null', 'undefined']);
    expect(JARGON.map((j) => j.word)).toEqual([
      'hub', 'trip id', 'tripId', 'API', 'backend', 'endpoint', 'payload', '409', 'phase', 'null', 'undefined',
    ]);
    for (const fine of [
      'hub_drop', 'at_hub', 'hubCostCents', 'relayBusinessId', 'Relay point', 'Chubb Tower', 'Trip 12', 'trip identity',
      'therapist', 'capital', 'rapid', 'emphasis', 'nullable', '$4.09', '4090 steps', 'Round trip. Idle after 6 pm.',
    ]) {
      expect(words(fine), fine).toEqual([]);
    }
  });
});

describe('#893 jargon guard: client/src', () => {
  const files = sourceFiles(CLIENT_SRC);
  const texts = files.flatMap((file) => visibleTexts(file, readFileSync(file, 'utf8')));
  const hits = jargonIn(texts);
  const allowed = (h: Hit) => ALLOWED.some((a) => a.file === h.file && a.word === h.word && a.text === h.text);

  it('reads the whole client: every source file parses and the text is found', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.endsWith('.tsx'))).toBe(true);
    for (const where of ['JSX text', 'aria-label', 'title', 'placeholder', 'data-label', 'words in code']) {
      expect(texts.filter((t) => t.where === where).length, where).toBeGreaterThan(0);
    }
    expect(texts.filter((t) => t.where.startsWith('const ')).length).toBeGreaterThan(20);
    expect(texts.length).toBeGreaterThan(400);
  });

  it('has no jargon in visible text, apart from the allowed lines an open issue holds', () => {
    const fresh = hits.filter((h) => !allowed(h)).map(describeHit);
    expect(
      fresh,
      `Jargon in text a person reads. Reword it in plain words ("relay point", "delivery", "the server").\n` +
        `Only text that was already on main, in a file an open issue holds, goes into ALLOWED in this test.\n` +
        fresh.join('\n'),
    ).toEqual([]);
  });

  it('names a file, a word of the list, a module and an issue for every allowed line', () => {
    const wordNames = JARGON.map((j) => j.word);
    for (const a of ALLOWED) {
      expect(a.file.startsWith(`${CLIENT_SRC}/`), a.file).toBe(true);
      expect(wordNames, a.text).toContain(a.word);
      expect(jargonIn([{ file: a.file, line: 0, where: '', text: a.text }]).map((h) => h.word), a.text).toContain(a.word);
      expect(a.issue, a.text).toMatch(/^#\d+$/);
      expect(a.module.length, a.text).toBeGreaterThan(0);
    }
    expect(new Set(ALLOWED.map((a) => `${a.file}|${a.word}|${a.text}`)).size).toBe(ALLOWED.length);
    // Not a failure: the fix for an allowed line can merge before or after this file.
    const gone = ALLOWED.filter((a) => !hits.some((h) => h.file === a.file && h.word === a.word && h.text === a.text));
    if (gone.length > 0) {
      console.info(`copy-jargon-guard: fixed, delete from ALLOWED: ${gone.map((a) => `${a.file} ${JSON.stringify(a.text)}`).join('; ')}`);
    }
  });
});
