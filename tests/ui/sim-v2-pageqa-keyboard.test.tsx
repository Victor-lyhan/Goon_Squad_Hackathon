// #511 (M9): keyboard QA of the assembled MVP II simulator page (docs/mvp2-ui-redesign.md §1, §2
// "accessible, keyboard navigation, obvious interactive states"), on the page rendered from the
// sample responses in the four states (static markup, DECISIONS pass 43):
// - every control is a native button, input, select or link (or a role with tabindex="0"), has an
//   accessible name, a :focus-visible style, and no positive tabindex; nothing else takes a click;
// - a collapsed panel's controls cannot be reached;
// - the one Play/Pause button (#648): the step line is a live region that is in the page before
//   playing, and Pause takes the Play button's place (same element, so focus stays on it) while a
//   journey plays;
// - Esc leaves the journey (doc: "A clear exit ("Back to network" / Esc)") even from a focused button.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PAUSE_LABEL, PLAY_LABEL, stepAnnouncement, type PlayState } from '../../client/src/components/sim/v2/compose/journeyPlay';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { simKeyEffect, attachSimKeys, type SimKeyboardEvent } from '../../client/src/components/sim/v2/page/simPageState';
import { DesktopOnlyNotice } from '../../client/src/components/sim/v2/page/DesktopOnlyNotice';
import { LEFT_BODY_ID, RIGHT_BODY_ID } from '../../client/src/components/sim/v2/SimWorkspace';
import { parseCss, read, FOCUS_SELECTORS } from './sim-v2-qa-css-rules';
import {
  FOUR_STATES, SELECTED_STATES, accessibleName, all, ancestors, byClass, controlsIn, hasClass, hookFor, isHidden, isNative,
  one, parse, readText, renderBody, renderLayout, type Node, type PageState,
} from './sim-v2-pageqa-sample';

// ---------- Every element created while rendering, to find click handlers on non-controls ----------
type Created = { type: string; props: Record<string, unknown> };
const created = vi.hoisted(() => ({ list: [] as { type: string; props: Record<string, unknown> }[] }));
const record = (type: unknown, props: unknown) => {
  if (typeof type === 'string' && props && typeof props === 'object') created.list.push({ type, props: props as Record<string, unknown> });
};
vi.mock('react/jsx-dev-runtime', async (orig) => {
  const m = await orig<typeof import('react/jsx-dev-runtime')>();
  return { ...m, jsxDEV: (type: unknown, props: unknown, ...rest: unknown[]) => { record(type, props); return (m.jsxDEV as (...a: unknown[]) => unknown)(type, props, ...rest); } };
});
vi.mock('react/jsx-runtime', async (orig) => {
  const m = await orig<typeof import('react/jsx-runtime')>();
  const wrap = (fn: (...a: unknown[]) => unknown) => (type: unknown, props: unknown, ...rest: unknown[]) => { record(type, props); return fn(type, props, ...rest); };
  return { ...m, jsx: wrap(m.jsx as (...a: unknown[]) => unknown), jsxs: wrap(m.jsxs as (...a: unknown[]) => unknown) };
});
/** Host elements created by `render` that carry a pointer or key handler. */
function handlerElements(render: () => void): Created[] {
  created.list = [];
  render();
  return created.list.filter((e) => Object.keys(e.props).some((k) => /^on(Click|DoubleClick|MouseDown|MouseUp|PointerDown|PointerUp|KeyDown|KeyUp|KeyPress)$/.test(k)));
}

// ---------- Focus styles ----------
const pageRules = ['client/src/components/sim/v2/compose/compose.css', 'client/src/components/sim/v2/page/page.css', 'client/src/ui/ui.css']
  .flatMap((f) => parseCss(read(f), f));
const FOCUS = new Set([
  ...FOCUS_SELECTORS,
  ...pageRules.flatMap((r) => r.selectors.filter((s) => s.endsWith(':focus-visible')).map((s) => s.replace(/:focus-visible$/, ''))),
]);
/** A class of the control (or "ancestor-class tag") has a :focus-visible rule. */
function hasFocusStyle(n: Node): boolean {
  const classes = (n.attrs.class ?? '').split(/\s+/).filter(Boolean);
  if (classes.some((c) => FOCUS.has(`.${c}`))) return true;
  return [...FOCUS].some((sel) => {
    const m = /^\.([\w-]+) (\w+)$/.exec(sel);
    return !!m && m[2] === n.tag && ancestors(n).some((a) => hasClass(a, m[1]));
  });
}

// ---------- The states ----------
type Shown = PageState & { root: Node };
const shown = (s: PageState): Shown => ({ ...s, root: parse(renderBody(s)) });
const STATES = [...FOUR_STATES, ...SELECTED_STATES].map(shown);
const relayState = FOUR_STATES.find((s) => s.name === 'relay journey')!;
const relayJourney = buildJourney({ shipmentId: 'shp-2', sim: relayState.sim, map: relayState.map }) as Journey;
const running: PlayState = { status: 'running', overnight: false, shipmentId: 'shp-2', runId: relayState.sim.runId };

/** The checks every reachable control passes. */
function checkControls(root: Node) {
  const controls = controlsIn(root);
  const bad: string[] = [];
  for (const c of controls) {
    const label = `<${c.tag} class="${c.attrs.class ?? ''}"> ${accessibleName(c, root) || '(no name)'}`;
    const tabindex = c.attrs.tabindex;
    if (!isNative(c) && !(c.attrs.role && tabindex === '0')) bad.push(`${label}: not a native control and not role + tabindex="0"`);
    if (tabindex !== undefined && Number(tabindex) > 0) bad.push(`${label}: positive tabindex ${tabindex}`);
    if (isNative(c) && tabindex === '-1' && !isHidden(c)) bad.push(`${label}: tabindex="-1" takes it out of the tab order`);
    if (!accessibleName(c, root)) bad.push(`${label}: no accessible name`);
    if (!hasFocusStyle(c)) bad.push(`${label}: no :focus-visible style`);
  }
  return { controls, bad };
}

describe('every control in the page states: native, named, focus-visible, no positive tabindex', () => {
  it.each(STATES)('$name', (s) => {
    const { controls, bad } = checkControls(s.root);
    // Not an empty render. The network page has 16 controls since #648 took out the speed buttons,
    // the scrubber, the Scenario form, the Planning cycle buttons and the layer checkboxes.
    expect(controls.length).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  it.each(STATES)('$name: every ID is unique and every aria reference points at an element', (s) => {
    const ids = new Set(all(s.root, (n) => n.attrs.id !== undefined).map((n) => n.attrs.id));
    expect(ids.size).toBe(all(s.root, (n) => n.attrs.id !== undefined).length);
    for (const n of all(s.root, () => true)) {
      for (const a of ['aria-controls', 'aria-describedby', 'aria-labelledby']) {
        for (const id of (n.attrs[a] ?? '').split(/\s+/).filter(Boolean)) expect(ids.has(id), `${a}="${id}"`).toBe(true);
      }
    }
  });

  it.each(STATES)('$name: only native controls (and a form) take a click or a key', (s) => {
    const withHandlers = handlerElements(() => renderBody(s));
    expect(withHandlers.length).toBeGreaterThan(10);
    const bad = withHandlers
      .filter((e) => !['button', 'input', 'select', 'textarea', 'a', 'form'].includes(e.type))
      .filter((e) => !(typeof e.props.role === 'string' && e.props.tabIndex === 0))
      .map((e) => `<${e.type} class="${String(e.props.className ?? '')}"> ${Object.keys(e.props).filter((k) => /^on/.test(k)).join(',')}`);
    expect(bad).toEqual([]);
  });

  it('the desktop-only notice: its one link is named and has a focus style', () => {
    const root = parse(renderToStaticMarkup(<DesktopOnlyNotice />));
    const { controls, bad } = checkControls(root);
    expect(controls.map((c) => [c.tag, accessibleName(c, root)])).toEqual([['a', 'Choose a workspace']]);
    expect(bad).toEqual([]);
  });
});

describe('a collapsed panel: its controls cannot be reached', () => {
  const collapsed = FOUR_STATES.map((s) => ({ ...s, root: parse(renderLayout(s, { panels: { leftOpen: false, rightOpen: false } })) }));

  it.each(collapsed)('$name: only the expand buttons stay in the panels, the bodies are hidden', (s) => {
    for (const [side, bodyId, title] of [['sw-left', LEFT_BODY_ID, 'Controls'], ['sw-right', RIGHT_BODY_ID, 'Inspector']] as const) {
      const panel = one(s.root, (n) => n.tag === 'aside' && hasClass(n, side), side);
      const body = one(panel, (n) => n.attrs.id === bodyId, bodyId);
      expect(body.attrs.hidden).toBeDefined();
      const reachable = controlsIn(panel).filter((c) => !isHidden(c));
      expect(reachable.map((c) => accessibleName(c, s.root))).toEqual([title]);
      expect([reachable[0].attrs['aria-expanded'], reachable[0].attrs['aria-controls']]).toEqual(['false', bodyId]);
      // There was something to hide (the right panel of network mode holds only the summary).
      if (side === 'sw-left' || s.selection) expect(controlsIn(body).length).toBeGreaterThan(0);
    }
  });

  it.each(collapsed)('$name: the map legend stays reachable', (s) => {
    const map = one(s.root, (n) => n.attrs.role === 'region' && n.attrs['aria-label'] === 'Map', 'map');
    expect(controlsIn(map).filter((c) => !isHidden(c)).map((c) => accessibleName(c, s.root))).toContain('Legend');
  });

  it('the hidden body is display: none in the CSS too (not only the attribute)', () => {
    const css = read('client/src/components/sim/v2/SimWorkspace.css');
    expect(css).toMatch(/\.sw-panel-body\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  });

  it('collapsing one side leaves the other side reachable', () => {
    const names = (root: Node, side: 'sw-left' | 'sw-right') =>
      controlsIn(one(root, (n) => n.tag === 'aside' && hasClass(n, side), side)).filter((c) => !isHidden(c)).map((c) => accessibleName(c, root));
    const leftShut = parse(renderLayout(relayState, { panels: { leftOpen: false, rightOpen: true } }));
    expect(names(leftShut, 'sw-right')).toEqual(expect.arrayContaining(['Back to network', expect.stringMatching(/^Step 1: Pickup at sender\b/)]));
    expect(names(leftShut, 'sw-left')).toEqual(['Controls']);
    // The one Play/Pause button is in the left panel (#648): it stays reachable with the right panel shut.
    const rightShut = parse(renderLayout(relayState, { panels: { leftOpen: true, rightOpen: false } }));
    expect(names(rightShut, 'sw-left')).toEqual(expect.arrayContaining([PLAY_LABEL, 'Back to start', 'Back to network']));
    expect(names(rightShut, 'sw-right')).toEqual(['Inspector']);
  });
});

describe('the one Play/Pause button: announced in a live region, Pause reachable while a journey plays', () => {
  const idle = parse(renderLayout(relayState));
  const playing = parse(renderLayout(relayState, { play: running }));
  const block = (root: Node) => one(root, (n) => hasClass(n, 'ctl-playback'), 'playback block');
  const status = (root: Node) => one(block(root), (n) => hasClass(n, 'ctl-status'), 'status');
  const buttons = (root: Node) => all(block(root), (n) => n.tag === 'button');

  it('the page has one playback block, in the left panel', () => {
    for (const root of [idle, playing]) {
      expect(ancestors(block(root)).some((a) => a.tag === 'aside' && hasClass(a, 'sw-left'))).toBe(true);
    }
  });

  it('before playing, the step line is already in the page as an empty polite live region', () => {
    expect(status(idle).attrs.role).toBe('status');
    expect(readText(status(idle))).toBe('');
    expect(isHidden(status(idle))).toBe(false);
  });

  it('while playing, the live region names the next step from the sample events', () => {
    expect(status(playing).attrs.role).toBe('status');
    expect(readText(status(playing))).toBe(stepAnnouncement(relayJourney));
    expect(readText(status(playing))).toBe('Step 3 of 4 next: Pickup at relay point at Brooklyn Roasting.');
  });

  it('while playing, Pause is an enabled, named button in the tab order, in the place the Play button was', () => {
    const [first] = buttons(playing);
    expect(accessibleName(first, playing)).toBe(PAUSE_LABEL);
    expect(first.attrs.disabled).toBeUndefined();
    expect(first.attrs.tabindex).toBeUndefined();
    expect(isHidden(first)).toBe(false);
    expect(hasFocusStyle(first)).toBe(true);
    // Same element type and class at the same place as Play: React keeps the node, so focus stays on it.
    const [before] = buttons(idle);
    expect(accessibleName(before, idle)).toBe(PLAY_LABEL);
    expect(first.attrs.class).toBe(before.attrs.class);
    expect(buttons(playing).map((b) => accessibleName(b, playing))).toEqual([PAUSE_LABEL, 'Back to start']);
    expect(buttons(idle).map((b) => accessibleName(b, idle))).toEqual([PLAY_LABEL, 'Back to start']);
    // One button for both: no Play next to Pause, and none in the journey panel.
    expect(controlsIn(playing).filter((c) => accessibleName(c, playing) === PLAY_LABEL)).toEqual([]);
    expect(controlsIn(idle).filter((c) => [PLAY_LABEL, PAUSE_LABEL].includes(accessibleName(c, idle)))).toHaveLength(1);
  });

  it('while playing, every other control still passes the checks', () => {
    expect(checkControls(playing).bad).toEqual([]);
  });

  it('the journey header status is a polite live region too', () => {
    const journeyStatus = one(playing, (n) => hasClass(n, 'jt__status'), 'journey status');
    expect(journeyStatus.attrs['aria-live']).toBe('polite');
    expect(readText(journeyStatus)).toBe(`Status ${relayJourney.statusLabel}`);
  });
});

describe('Esc: "A clear exit ("Back to network" / Esc) returns to the full view"', () => {
  const ctxOf = (s: PageState) => ({ selection: s.selection, data: hookFor(s) });
  const esc = (tagName?: string) => ({ key: 'Escape', target: tagName ? { tagName } : null });

  it.each(['BUTTON', 'A', 'DIV'])('journey mode: Esc with focus on a %s goes back to the network', (tagName) => {
    expect(simKeyEffect(esc(tagName), ctxOf(relayState))).toEqual({ kind: 'select', selection: null });
  });

  it('network mode with a selection: Esc from a focused button clears it', () => {
    const selected = SELECTED_STATES[0];
    expect(simKeyEffect(esc('BUTTON'), ctxOf(selected))).toEqual({ kind: 'select', selection: null });
    expect(simKeyEffect(esc('BUTTON'), ctxOf(FOUR_STATES[0]))).toBeNull(); // nothing selected
  });

  it('Esc in a text input or textarea is left to the field; Space on a button stays the button\'s', () => {
    for (const tagName of ['INPUT', 'TEXTAREA']) expect(simKeyEffect(esc(tagName), ctxOf(relayState))).toBeNull();
    // #607: the focus dropdown does not keep Esc.
    expect(simKeyEffect(esc('SELECT'), ctxOf(relayState))).toEqual({ kind: 'select', selection: null });
    expect(simKeyEffect({ key: ' ', target: { tagName: 'BUTTON' } }, ctxOf(relayState))).toBeNull();
  });

  it('on the page: the first Esc on the focused Pause button pauses the journey, the next one leaves it', () => {
    const listeners: ((e: SimKeyboardEvent) => void)[] = [];
    const target = { addEventListener: (_t: 'keydown', l: (e: SimKeyboardEvent) => void) => listeners.push(l), removeEventListener: () => {} };
    let playingNow = true;
    const select = vi.fn();
    attachSimKeys(target, {
      context: () => ctxOf(relayState), select, togglePlay: vi.fn(),
      escape: () => { const was = playingNow; playingNow = false; return was; },
    });
    const press = () => {
      const e = { key: 'Escape', target: { tagName: 'BUTTON' }, preventDefault: vi.fn() };
      for (const l of listeners) l(e);
      return e;
    };
    expect(press().preventDefault).toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(press().preventDefault).toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith(null);
  });
});

describe('the page names its regions', () => {
  it.each(STATES)('$name: the panels and the map are labelled; the panel sections have headings', (s) => {
    const labels = all(s.root, (n) => n.tag === 'aside' || n.attrs.role === 'region').map((n) => n.attrs['aria-label']);
    expect(labels).toEqual(['Controls panel', 'Map', 'Inspector panel']);
    for (const sec of byClass(s.root, 'sw-section')) {
      expect(sec.attrs['aria-labelledby']).toBeTruthy();
    }
  });
});

describe('names on elements without a role (found outside the files of #511)', () => {
  /** aria-label on a plain div or span with no role is not announced (ARIA 1.2 prohibits it). */
  const unnamedGeneric = (root: Node) =>
    all(root, (n) => ['div', 'span'].includes(n.tag) && n.attrs['aria-label'] !== undefined && n.attrs.role === undefined)
      .map((n) => `<${n.tag} class="${n.attrs.class ?? ''}" aria-label="${n.attrs['aria-label']}">`);

  it.each(STATES.filter((s) => s.selection?.kind !== 'package'))('$name: none', (s) => {
    expect(unnamedGeneric(s.root)).toEqual([]);
  });

  // Failed until #552: SimWorkspace.tsx rendered the journey header in the left panel as
  // <div class="sw-journey" aria-label="Package journey"> with no role, so the name was never read and
  // repeated the timeline's own "Package journey" section name. #552 dropped the aria-label.
  it.each(STATES.filter((s) => s.selection?.kind === 'package'))('$name: none (SimWorkspace.tsx journey header)', (s) => {
    expect(unnamedGeneric(s.root)).toEqual([]);
  });
});
