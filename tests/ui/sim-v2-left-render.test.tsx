// The simulator's playback block (#648; on the map since #831): one Play/Pause button and "Back to
// start", rendered from the button view. Static renders plus the click handlers.
// #852: it shows the two buttons (a white icon and a label each) and nothing else. Why a button is
// disabled and the step of a playing journey are still in the markup, visually hidden (controls.css).
import { existsSync, readFileSync } from 'node:fs';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlaybackControls, type PlaybackControlsProps } from '../../client/src/components/sim/v2/controls/PlaybackControls';
import { BUSY_REASON, FINISHED_REASON, type PlayButtonView } from '../../client/src/components/sim/v2/controls/controlsModel';

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
/** Each button: its attributes, its name (the text of its label) and its inner markup. */
const buttons = (h: string) => [...h.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
  .map((m) => ({ attrs: m[1], text: m[2].replace(/<[^>]*>/g, ''), inner: m[2] }));
// #725: the two buttons are `aria-disabled`, never `disabled`, so a press that makes the run busy does not
// drop keyboard focus to <body>; the check fails if the `disabled` attribute comes back.
const isDisabled = (b: { attrs: string }) => {
  expect(b.attrs).not.toMatch(/\sdisabled=""/);
  return /\saria-disabled="true"/.test(b.attrs);
};

const PLAY: PlayButtonView = { label: 'Play', action: 'play_network', note: null };
const PAUSE: PlayButtonView = { label: 'Pause', action: 'pause_journey', note: null };

function render(over: Partial<PlaybackControlsProps> = {}) {
  const onToggle = vi.fn();
  const onReset = vi.fn();
  const html = renderToStaticMarkup(<PlaybackControls button={PLAY} onToggle={onToggle} onReset={onReset} {...over} />);
  expect(onToggle).not.toHaveBeenCalled();
  expect(onReset).not.toHaveBeenCalled();
  expect(html).not.toMatch(/NaN|undefined|>null</);
  return html;
}

/** Every aria-describedby of a button points at an element of the block with text. */
function expectDescribed(html: string) {
  for (const b of buttons(html)) {
    const ref = attr(`<x${b.attrs}>`, 'aria-describedby');
    if (!ref) continue;
    const target = html.match(new RegExp(`id="${ref}"[^>]*>([^<]*)</p>`))?.[1] ?? '';
    expect(target, b.text).toMatch(/[A-Za-z]{3,}.*\./);
  }
}

/** The elements of a rendered tree with the given tag, depth first (no DOM needed). */
function findAll(node: ReactNode, tag: string, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, tag, out));
  else if (isValidElement<Record<string, unknown>>(node)) {
    if (node.type === tag) out.push(node);
    findAll(node.props.children as ReactNode, tag, out);
  }
  return out;
}

describe('PlaybackControls', () => {
  it('has exactly two buttons, in order: Play and Back to start', () => {
    const html = render();
    expect(buttons(html).map((b) => b.text)).toEqual(['Play', 'Back to start']);
    expect(buttons(html).some(isDisabled)).toBe(false);
  });

  it('shows Pause when the view says so, still with one play button', () => {
    const html = render({ button: PAUSE });
    expect(buttons(html).map((b) => b.text)).toEqual(['Pause', 'Back to start']);
  });

  it('has no speed buttons, scrubber, Next event, Jump to morning, Finish or key hint', () => {
    for (const html of [render(), render({ button: PAUSE, status: 'Step 1 of 4 next: Pickup at sender at Navy Yard Coffee.' })]) {
      expect(html).not.toMatch(/<input|type="range"|aria-pressed|<select|<kbd/);
      expect(html).not.toMatch(/Next event|Jump to morning|Finish|Reset playback|Speed|1x|4x|20x/);
      expect(html).not.toMatch(/\bSpace\b|\bEsc\b|shortcut|keyboard/i);
    }
  });

  it('each button is a white icon hidden from screen readers and its label; the label alone is its name (#852)', () => {
    for (const [html, names] of [[render(), ['Play', 'Back to start']], [render({ button: PAUSE }), ['Pause', 'Back to start']]] as const) {
      const all = buttons(html);
      expect(all.map((b) => b.text)).toEqual(names);
      for (const b of all) {
        expect(b.inner).toMatch(/^<svg class="ctl-icon"[^>]*aria-hidden="true"[^>]*><path d="[^"]+" fill="currentColor"><\/path><\/svg><span class="ctl-label">[^<]+<\/span>$/);
        expect(b.attrs).not.toMatch(/aria-label|title=/); // named by the label; no tooltip while enabled
      }
    }
    // Play and Pause are different drawings; "Back to start" is a third.
    const icon = (html: string, i: number) => /<path d="([^"]+)"/.exec(buttons(html)[i].inner)![1];
    expect(new Set([icon(render(), 0), icon(render({ button: PAUSE }), 0), icon(render(), 1)]).size).toBe(3);
    expect(icon(render({ button: PAUSE }), 1)).toBe(icon(render(), 1));
  });

  it('shows nothing but the two buttons: every other element of the block is visually hidden or an alert (#852)', () => {
    const html = render({ button: { label: 'Play', action: null, note: FINISHED_REASON }, status: 'Journey paused.' });
    const rest = html.replace(/<div class="ctl-row">[\s\S]*?<\/div>/, '');
    expect([...rest.matchAll(/<(\w+) class="([^"]*)"/g)].map((m) => `${m[1]}.${m[2]}`))
      .toEqual(['div.ctl-block ctl-playback', 'p.ctl-note', 'p.ctl-status']);
    const css = readFileSync('client/src/components/sim/v2/controls/controls.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const hidden = /\.ctl-note,\s*\.ctl-status\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const d of ['position: absolute', 'width: 1px', 'height: 1px', 'overflow: hidden', 'clip-path: inset(50%)']) expect(hidden).toContain(d);
    expect(hidden).not.toMatch(/display\s*:/); // never display: none, so the note still describes and the status still announces
  });

  it('a disabled Play is described by its note, which is also its tooltip', () => {
    const html = render({ button: { label: 'Play', action: null, note: FINISHED_REASON } });
    const [play, reset] = buttons(html);
    expect(isDisabled(play)).toBe(true);
    expect(isDisabled(reset)).toBe(false);
    expect(html).toContain(`<p class="ctl-note" id="ctl-play-note">${FINISHED_REASON}</p>`);
    expectDescribed(html);
    expect(attr(`<x${play.attrs}>`, 'aria-describedby')).toBeTruthy();
    expect(attr(`<x${play.attrs}>`, 'title')).toBe(FINISHED_REASON);
    expect(attr(`<x${reset.attrs}>`, 'title')).toBeUndefined();
  });

  /** How many note elements say `reason`. */
  const notes = (html: string, reason: string) => html.split(`>${reason}</p>`).length - 1;

  it('busy: both buttons disabled, the shared reason is one note', () => {
    const html = render({ button: { label: 'Play', action: null, note: BUSY_REASON }, resetDisabled: BUSY_REASON });
    expect(buttons(html).every(isDisabled)).toBe(true);
    expect(notes(html, BUSY_REASON)).toBe(1);
    expect(buttons(html).map((b) => attr(`<x${b.attrs}>`, 'title'))).toEqual([BUSY_REASON, BUSY_REASON]);
    expectDescribed(html);
  });

  it('a journey plays while another control is open: only Back to start is disabled, with its own note', () => {
    const html = render({ button: PAUSE, resetDisabled: BUSY_REASON });
    const [pause, reset] = buttons(html);
    expect(isDisabled(pause)).toBe(false);
    expect(isDisabled(reset)).toBe(true);
    expect(notes(html, BUSY_REASON)).toBe(1);
    expect(attr(`<x${reset.attrs}>`, 'title')).toBe(BUSY_REASON);
    expectDescribed(html);
  });

  it('keeps one role="status" line in place, empty or with the step text', () => {
    expect(render()).toMatch(/<p class="ctl-status" role="status"><\/p>/);
    const html = render({ status: 'Journey paused.' });
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('>Journey paused.</p>');
  });

  it('a refused step is an alert; no alert otherwise', () => {
    expect(render()).not.toContain('role="alert"');
    const html = render({ error: 'Play stopped: the simulator did not accept a step.' });
    expect(html).toMatch(/role="alert">Play stopped: the simulator did not accept a step\.<\/p>/);
  });

  it('a click on each button calls its handler once', () => {
    const onToggle = vi.fn();
    const onReset = vi.fn();
    const [play, reset] = findAll(PlaybackControls({ button: PLAY, onToggle, onReset }), 'button');
    (play.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
    (reset.props.onClick as () => void)();
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('a disabled button has no click handler', () => {
    const [play, reset] = findAll(
      PlaybackControls({ button: { label: 'Play', action: null, note: BUSY_REASON }, resetDisabled: BUSY_REASON, onToggle: vi.fn(), onReset: vi.fn() }),
      'button',
    );
    expect(play.props.onClick).toBeUndefined();
    expect(reset.props.onClick).toBeUndefined();
  });
});

describe('deleted with their code (#648, docs/mvp3.md P2)', () => {
  it.each([
    'controls/ScenarioControls.tsx', 'controls/PlanningControls.tsx', 'LayerToggles.tsx', 'compose/PlayJourneyButton.tsx',
  ])('%s is not in the repo', (file) => {
    expect(existsSync(`client/src/components/sim/v2/${file}`)).toBe(false);
  });
});

describe('controls.css', () => {
  const css = readFileSync('client/src/components/sim/v2/controls/controls.css', 'utf8');
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('no radius over 4px, except the round buttons of the map pill (#852)', () => {
    const all = [...noComments.matchAll(/border-radius\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    // Half of the buttons' 44 px height, in the `.ctl-btn` rule.
    expect(all.filter((r) => r === '22px')).toHaveLength(1);
    expect(/\.ctl-btn\s*\{[^}]*\}/.exec(noComments)?.[0]).toMatch(/min-height: 44px;[^}]*border-radius: 22px;/);
    const radii = all.filter((r) => r !== '22px');
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) {
      for (const px of r.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px[1]), r).toBeLessThanOrEqual(4);
      expect(r).not.toMatch(/%|em\b|rem\b/);
    }
  });

  it('the buttons are 44 px touch targets (#852)', () => {
    const btn = /\.ctl-btn\s*\{([^}]*)\}/.exec(noComments)?.[1] ?? '';
    expect(Number(/min-height:\s*(\d+)px/.exec(btn)?.[1])).toBeGreaterThanOrEqual(44);
    // Play/Pause is as wide for "Play" as for "Pause" and never under 44 px.
    const primary = /\.ctl-primary\s*\{([^}]*)\}/.exec(noComments)?.[1] ?? '';
    expect(Number(/min-width:\s*(\d+)px/.exec(primary)?.[1])).toBeGreaterThanOrEqual(88);
    // No later rule makes a button smaller.
    expect([...noComments.matchAll(/min-height:\s*(\d+)px/g)].every((m) => Number(m[1]) >= 44)).toBe(true);
    expect(noComments).not.toMatch(/(^|[\s;{])(max-)?height\s*:\s*(?!1px)\d/);
  });

  it('no box-shadow except a 1px focus ring, and no gradients', () => {
    expect(noComments).not.toMatch(/gradient/);
    const rules = [...noComments.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    for (const [, selector, body] of rules) {
      const shadow = body.match(/box-shadow\s*:\s*([^;]+)/)?.[1];
      if (!shadow) continue;
      expect(selector).toMatch(/:focus-visible/);
      expect(shadow.trim()).toMatch(/^0 0 0 1px\b/);
    }
  });

  it('no fixed width over 320px', () => {
    for (const m of noComments.matchAll(/(?:^|[;{\s])(?:min-|max-)?width\s*:\s*([^;]+);/g)) {
      for (const px of m[1].matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px[1]), m[0]).toBeLessThanOrEqual(320);
    }
  });

  it('every control class has a :focus-visible style and there is a reduced-motion rule', () => {
    for (const c of ['.ctl-btn']) expect(noComments).toMatch(new RegExp(`\\${c}:focus-visible`));
    expect(noComments).toMatch(/prefers-reduced-motion/);
  });

  // #816 kept two lines of height for a journey's step line so the Packages list under it did not jump;
  // #852 removed the shown line, so nothing reserves height and the block is the same size in every state.
  it('no step line is shown and none has a reserved height; the live region still gets the text (#852)', () => {
    expect(noComments).not.toContain('.ctl-line');
    expect(noComments).not.toMatch(/\.ctl-playback\[data-play-action/);
    for (const [action, isJourney] of [['play_journey', true], ['pause_journey', true], ['play_network', false], ['pause_clock', false]] as const) {
      const html = render({ button: { ...PLAY, action }, status: 'Step 1 of 4 next: Pickup at sender.' });
      expect(html).not.toContain('ctl-line');
      expect(attr(html.match(/<div\b[^>]*class="ctl-block ctl-playback"[^>]*>/)![0], 'data-play-action')!.endsWith('_journey'), action).toBe(isJourney);
      expect(html).toMatch(/<p class="ctl-status" role="status">Step 1 of 4/);
      expect(html.split('Step 1 of 4')).toHaveLength(2);
    }
  });

  it('has no rule left for the speed buttons, the scrubber or the scenario form (#648)', () => {
    for (const c of ['.ctl-seg', '.ctl-range', '.ctl-input', '.ctl-fields', '.ctl-confirm', '.ctl-phase', '.ctl-grid']) {
      expect(noComments, c).not.toContain(c);
    }
  });
});
