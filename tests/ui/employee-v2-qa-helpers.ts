// Helpers for the Employee workspace QA tests (#478): a tiny CSS rule parser and a tiny HTML tree
// for static markup. No DOM library is installed and tests run in Node, so both are deliberately small.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const V2_DIR = 'client/src/components/employee/v2';

/** Every .css file under client/src/components/employee/v2, recursively. */
export function v2CssFiles(dir = V2_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...v2CssFiles(p));
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

export type Decl = { prop: string; value: string };
export type CssRule = { selector: string; media: string[]; decls: Decl[] };

/** Flat list of style rules with the @media conditions around them. Comments are dropped. */
export function parseCss(source: string): CssRule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const stack: Array<{ kind: 'media'; cond: string } | { kind: 'rule'; rule: CssRule }> = [];
  let buf = '';
  const media = () => stack.flatMap((s) => (s.kind === 'media' ? [s.cond] : []));
  const flushDecl = () => {
    const top = stack[stack.length - 1];
    const text = buf.trim();
    buf = '';
    if (!text || !top || top.kind !== 'rule') return;
    const i = text.indexOf(':');
    if (i < 0) return;
    top.rule.decls.push({ prop: text.slice(0, i).trim().toLowerCase(), value: text.slice(i + 1).trim() });
  };
  for (const ch of css) {
    if (ch === '{') {
      const head = buf.trim();
      buf = '';
      if (head.startsWith('@')) stack.push({ kind: 'media', cond: head });
      else {
        const rule: CssRule = { selector: head, media: media(), decls: [] };
        rules.push(rule);
        stack.push({ kind: 'rule', rule });
      }
    } else if (ch === '}') {
      flushDecl();
      stack.pop();
    } else if (ch === ';') {
      flushDecl();
    } else {
      buf += ch;
    }
  }
  return rules;
}

/** Design tokens from client/src/styles/tokens.css, with var() references resolved. */
export function readTokens(path = 'client/src/styles/tokens.css'): Map<string, string> {
  const raw = new Map<string, string>();
  const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) raw.set(name, value.trim());
  const resolve = (v: string, depth = 0): string =>
    depth > 5 ? v : v.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, n: string) => resolve(raw.get(n) ?? '', depth + 1));
  return new Map([...raw].map(([k, v]) => [k, resolve(v)]));
}

// ---------- HTML ----------

export type El = { tag: string; attrs: Record<string, string>; children: Node[]; parent: El | null };
export type Node = El | string;

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'source', 'col', 'area', 'wbr']);
const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

/** Parses React's static markup (well-formed, quoted attributes) into a tree. */
export function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(re)) {
    const [, close, tagName, attrText, selfClose, text] = m;
    if (text !== undefined) { cur.children.push(decode(text)); continue; }
    const tag = tagName.toLowerCase();
    if (close) { if (cur.parent) cur = cur.parent; continue; }
    const attrs: Record<string, string> = {};
    for (const [, k, v] of attrText.matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) attrs[k.toLowerCase()] = decode(v ?? '');
    const el: El = { tag, attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!VOID.has(tag) && !selfClose) cur = el;
  }
  return root;
}

export function walk(el: El, visit: (e: El) => void): void {
  for (const c of el.children) if (typeof c !== 'string') { visit(c); walk(c, visit); }
}

export function all(root: El, pred: (e: El) => boolean): El[] {
  const out: El[] = [];
  walk(root, (e) => { if (pred(e)) out.push(e); });
  return out;
}

export function textOf(el: El): string {
  return el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join(' ').replace(/\s+/g, ' ').trim();
}

export function byId(root: El, id: string): El | undefined {
  return all(root, (e) => e.attrs.id === id)[0];
}

const classes = (e: El) => (e.attrs.class ?? '').split(/\s+/).filter(Boolean);
const hidden = (e: El): boolean => e.attrs.hidden !== undefined || (e.parent ? hidden(e.parent) : false);

/** Tab-reachable controls in DOM order (disabled and hidden ones excluded). */
export function tabOrder(root: El): El[] {
  return all(root, (e) => {
    if (hidden(e) || e.attrs.disabled !== undefined) return false;
    if (e.attrs.tabindex !== undefined) return Number(e.attrs.tabindex) >= 0;
    if (e.tag === 'a') return e.attrs.href !== undefined;
    if (e.tag === 'input') return e.attrs.type !== 'hidden';
    return e.tag === 'button' || e.tag === 'select' || e.tag === 'textarea';
  });
}

/** The accessible name, by the simple rules the page uses: aria-labelledby, aria-label, label[for], wrapping label, text. */
export function accessibleName(root: El, e: El): string {
  if (e.attrs['aria-labelledby']) {
    return e.attrs['aria-labelledby'].split(/\s+/).map((id) => (byId(root, id) ? textOf(byId(root, id)!) : '')).join(' ').trim();
  }
  if (e.attrs['aria-label']) return e.attrs['aria-label'].trim();
  if (e.attrs.id) {
    const label = all(root, (l) => l.tag === 'label' && l.attrs.for === e.attrs.id)[0];
    if (label) return textOf(label);
  }
  for (let p = e.parent; p; p = p.parent) if (p.tag === 'label') return textOf(p);
  return textOf(e);
}

// ---------- selector matching (just enough for this folder's :focus-visible rules) ----------

function matchesCompound(e: El, compound: string): boolean {
  const m = compound.match(/^([a-z][\w-]*|\*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
  if (!m) return false;
  const [, tag, cls, attrPart] = m;
  if (tag && tag !== '*' && e.tag !== tag.toLowerCase()) return false;
  const have = classes(e);
  for (const c of cls.split('.').filter(Boolean)) if (!have.includes(c)) return false;
  for (const [, k, v] of attrPart.matchAll(/\[([\w-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/g)) {
    if (e.attrs[k] === undefined || (v !== undefined && e.attrs[k] !== v)) return false;
  }
  return true;
}

/** Descendant-combinator selectors only (`.a .b tag.c`). */
export function matchesSelector(e: El, selector: string): boolean {
  const parts = selector.trim().split(/\s+/);
  if (!matchesCompound(e, parts[parts.length - 1])) return false;
  let p = e.parent;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (p && !matchesCompound(p, parts[i])) p = p.parent;
    if (!p) return false;
    p = p.parent;
  }
  return true;
}

/** Selectors (with `:focus-visible` removed) of every rule that styles keyboard focus and draws something. */
export function focusVisibleSelectors(rules: CssRule[]): string[] {
  const out: string[] = [];
  for (const r of rules) {
    const draws = r.decls.some((d) => (d.prop.startsWith('outline') && d.value !== 'none') || d.prop === 'box-shadow' || d.prop === 'border-color');
    if (!draws) continue;
    for (const s of r.selector.split(',')) if (s.includes(':focus-visible')) out.push(s.replace(/:focus-visible/g, '').trim());
  }
  return out;
}
