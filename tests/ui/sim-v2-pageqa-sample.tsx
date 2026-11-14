// Shared by the #511 page QA tests (sim-v2-pageqa-*.test.tsx): the assembled simulator page rendered
// from the sample responses in the states docs/mvp2-ui-redesign.md §1 names, and a small reader for
// static markup (an element tree with text, attributes and accessible names). Node only, no DOM.
import { cloneElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';
import { SimPageBody, SimPageLayout, createSimPageHandlers } from '../../client/src/components/sim/v2/compose/SimPageBody';
import { PLAY_IDLE, type PlayState } from '../../client/src/components/sim/v2/compose/journeyPlay';
import { COMPARE_IDLE, compareView, simPageView } from '../../client/src/components/sim/v2/compose/simPageView';
import { INITIAL_SIM_DATA, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import type { SimulatorV2 } from '../../client/src/components/sim/v2/live/useSimulatorV2';
import type { Selection } from '../../client/src/components/sim/v2/network/selectionModel';
import type { PanelState } from '../../client/src/components/sim/v2/workspaceModel';
import { DEFAULT_LAYERS, NO_FOCUS, type Focus } from '../../client/src/components/sim/v2/workspaceModel';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import { T, map as journeyMap, simAt } from './sim-v2-journey-sample';
import { makeMap, makeSim } from './sim-v2-network-fixture';

// ---------- Sample hook values ----------
export function hookOf(state: Partial<SimDataState>): SimulatorV2 {
  return {
    ...INITIAL_SIM_DATA,
    ...state,
    control: vi.fn(async () => null),
    generate: vi.fn(async () => null),
    resetPlanning: vi.fn(async () => null),
    recompute: vi.fn(async () => null),
    compare: vi.fn(async () => null),
    refetch: vi.fn(),
    dismissActionError: vi.fn(),
  };
}

export type PageState = {
  name: string;
  sim: SimulatorResponse;
  map: MapResponse;
  selection: Selection;
  focus: Focus;
};

const network = { sim: makeSim(), map: makeMap() };
const relay = { sim: simAt(T.overnight, { 'shp-2': 'at_hub' }), map: journeyMap };
const afterDelivery = simAt(T.afterDelivery, { 'shp-1': 'delivered', 'shp-2': 'delivered' });
// Both delivered: the snapshot has their delivered times (#552 shows "Delivered <time>" from it).
const direct = {
  sim: { ...afterDelivery, snapshot: { ...afterDelivery.snapshot, deliveredAtMin: { 'shp-1': 1074, 'shp-2': 1979 } } },
  map: journeyMap,
};

/** The four states the issue names (network, focus, relay journey, direct journey); focus in both kinds. */
export const FOUR_STATES: PageState[] = [
  { name: 'network', ...network, selection: null, focus: NO_FOCUS },
  { name: 'employee focus', ...network, selection: null, focus: { kind: 'employee', id: 'emp-2' } },
  { name: 'business focus', ...network, selection: null, focus: { kind: 'business', id: 'biz-etsy' } },
  { name: 'relay journey', ...relay, selection: { kind: 'package', id: 'shp-2' }, focus: NO_FOCUS },
  { name: 'direct journey', ...direct, selection: { kind: 'package', id: 'shp-1' }, focus: NO_FOCUS },
];

/** A business or an employee selected in network mode: the right panel shows the inspector. */
export const SELECTED_STATES: PageState[] = [
  { name: 'business selected', ...network, selection: { kind: 'business', id: 'biz-etsy' }, focus: NO_FOCUS },
  { name: 'employee selected', ...network, selection: { kind: 'employee', id: 'emp-2' }, focus: NO_FOCUS },
];

export const hookFor = (s: PageState) => hookOf({ view: 'ready', sim: s.sim, map: s.map });

/** The page body as the app renders it (its own hooks run once on the server renderer). */
export const renderBody = (s: PageState) => renderToStaticMarkup(
  <SimPageBody sim={hookFor(s)} selection={s.selection} onSelectionChange={() => {}} initialFocus={s.focus} />,
);

/**
 * The stateless layout of a state with a given Play journey state and panel state: the workspace
 * element the layout returns, rendered with `initialPanels` (both open by default).
 */
export function renderLayout(s: PageState, opts: { play?: PlayState; panels?: PanelState } = {}): string {
  const hook = hookFor(s);
  const view = simPageView({ data: hook, selection: s.selection, focus: s.focus, layers: DEFAULT_LAYERS });
  const handlers = createSimPageHandlers({
    sim: hook, view, selection: s.selection, onSelectionChange: () => {}, setFocus: () => {}, setLayers: () => {},
    setPanTo: () => {}, setLegendOpen: () => {}, compare: COMPARE_IDLE, setCompare: () => {}, nextPanSeq: () => 1,
    journeyPlay: { play: () => {}, stop: () => false },
  });
  const layout = SimPageLayout({
    view, focus: s.focus, layers: DEFAULT_LAYERS, legendOpen: true, handlers,
    compare: compareView(COMPARE_IDLE, view, hook.sim?.runId ?? null), play: opts.play ?? PLAY_IDLE,
  }) as ReactElement<Record<string, unknown>>;
  // SimPageLayout → ReadyLayout (hook-free) → <SimWorkspace …/>.
  const workspace = (layout.type as (p: unknown) => unknown)(layout.props);
  if (!isValidElement(workspace)) throw new Error('expected the workspace element');
  return renderToStaticMarkup(opts.panels ? cloneElement(workspace as ReactElement<{ initialPanels?: PanelState }>, { initialPanels: opts.panels }) : workspace);
}

// ---------- A small reader for static markup ----------
export type Node = { tag: string; attrs: Record<string, string>; children: (Node | string)[]; parent: Node | null };

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

export function parse(html: string): Node {
  const root: Node = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(re)) {
    const [, close, tagName, attrText, selfClose, text] = m;
    if (text !== undefined) { cur.children.push(decode(text)); continue; }
    const tag = tagName.toLowerCase();
    if (close) {
      if (cur.tag !== tag) throw new Error(`parse(): </${tag}> closes <${cur.tag}>`);
      cur = cur.parent!;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? '');
    const node: Node = { tag, attrs, children: [], parent: cur };
    cur.children.push(node);
    if (!VOID.has(tag) && !selfClose) cur = node;
  }
  if (cur !== root) throw new Error(`parse(): <${cur.tag}> is not closed`);
  return root;
}

export function all(root: Node, pred: (n: Node) => boolean): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      if (pred(c)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}
export const hasClass = (n: Node, c: string) => (n.attrs.class ?? '').split(/\s+/).includes(c);
export const byClass = (root: Node, c: string) => all(root, (n) => hasClass(n, c));
export function one(root: Node, pred: (n: Node) => boolean, what: string): Node {
  const found = all(root, pred);
  if (found.length !== 1) throw new Error(`${what}: found ${found.length}`);
  return found[0];
}
export const ancestors = (n: Node): Node[] => (n.parent && n.parent.tag !== '#root' ? [n.parent, ...ancestors(n.parent)] : []);
export const elements = (n: Node) => n.children.filter((c): c is Node => typeof c !== 'string');

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
/** All text, including aria-hidden parts. */
export const textOf = (n: Node): string => squash(n.children.map((c) => (typeof c === 'string' ? c : ` ${textOf(c)} `)).join(''));
/** Text without aria-hidden parts (what a screen reader reads as the content). */
export const readText = (n: Node): string =>
  squash(n.children.map((c) => (typeof c === 'string' ? c : c.attrs['aria-hidden'] === 'true' ? '' : ` ${readText(c)} `)).join(''));

/** Every element in a tree by ID (IDs must be unique). */
export function idIndex(root: Node): Map<string, Node> {
  const ids = new Map<string, Node>();
  for (const n of all(root, (x) => x.attrs.id !== undefined)) {
    if (ids.has(n.attrs.id)) throw new Error(`duplicate id ${n.attrs.id}`);
    ids.set(n.attrs.id, n);
  }
  return ids;
}

/** Accessible name: aria-labelledby, aria-label, a <label> (for= or wrapping), the content, then title. */
export function accessibleName(n: Node, root: Node): string {
  const ids = idIndex(root);
  const by = n.attrs['aria-labelledby'];
  if (by) return squash(by.split(/\s+/).map((id) => (ids.get(id) ? readText(ids.get(id)!) : '')).join(' '));
  if (n.attrs['aria-label']) return squash(n.attrs['aria-label']);
  if (['input', 'select', 'textarea'].includes(n.tag)) {
    const id = n.attrs.id;
    const forLabel = id ? all(root, (x) => x.tag === 'label' && x.attrs.for === id)[0] : undefined;
    const wrap = ancestors(n).find((a) => a.tag === 'label');
    const label = forLabel ?? wrap;
    if (label) return readText(label);
  } else {
    const content = readText(n);
    if (content) return content;
  }
  return squash(n.attrs.title ?? '');
}

/** Tabbable or clickable things: native controls, links, and anything with an interactive role or a tabindex. */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'slider', 'spinbutton', 'textbox',
  'combobox', 'searchbox', 'treeitem', 'gridcell',
]);
export const isNative = (n: Node) =>
  n.tag === 'button' || n.tag === 'select' || n.tag === 'textarea' || (n.tag === 'input' && n.attrs.type !== 'hidden')
  || (n.tag === 'a' && n.attrs.href !== undefined);
export const controlsIn = (root: Node) =>
  all(root, (n) => isNative(n) || INTERACTIVE_ROLES.has(n.attrs.role ?? '') || n.attrs.tabindex !== undefined);
/** Inside an element with the `hidden` attribute (display: none): never focusable. */
export const isHidden = (n: Node) => [n, ...ancestors(n)].some((a) => a.attrs.hidden !== undefined);
