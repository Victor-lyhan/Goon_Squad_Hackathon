// @vitest-environment jsdom
// #889: the simulator's map controls (the Play / Pause / Back to start pill, the legend, the overnight card)
// by keyboard and screen reader, in a real DOM. Tab reaches Play, Back to start and the legend toggle in
// that order with a white focus ring on the dark pill; each has a short name; Play/Pause says its state by
// its name; a greyed-out button stays focusable and its reason is its tooltip
// and its description; the overnight card is put into a live region that was in the page first.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SimPageLayout, createSimPageHandlers } from '../../client/src/components/sim/v2/compose/SimPageBody';
import { NETWORK_OVERNIGHT_TEXT, PLAY_IDLE, type PlayState } from '../../client/src/components/sim/v2/compose/journeyPlay';
import { OvernightCard } from '../../client/src/components/sim/v2/compose/OvernightCard';
import { COMPARE_IDLE, compareView, simPageView } from '../../client/src/components/sim/v2/compose/simPageView';
import { PlaybackControls } from '../../client/src/components/sim/v2/controls/PlaybackControls';
import {
  BUSY_REASON, FINISHED_REASON, PAUSE_LABEL, PLAY_LABEL, RESET_LABEL, type PlayButtonView,
} from '../../client/src/components/sim/v2/controls/controlsModel';
import { LEGEND_LABEL, LEGEND_REGION_LABEL, MapLegend } from '../../client/src/components/sim/v2/legend/MapLegend';
import { simKeyAction } from '../../client/src/components/sim/v2/page/keyMap';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { button, click, mount, tabOrder, textOf } from './kitDom';
import { FOUR_STATES, hookFor, type PageState } from './sim-v2-pageqa-sample';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const PLAY: PlayButtonView = { label: PLAY_LABEL, action: 'play_network', note: null };
const PAUSE: PlayButtonView = { label: PAUSE_LABEL, action: 'pause_journey', note: null };
const FINISHED: PlayButtonView = { label: PLAY_LABEL, action: null, note: FINISHED_REASON };
const BUSY: PlayButtonView = { label: PLAY_LABEL, action: null, note: BUSY_REASON };

/** The accessible name as a browser computes it for these controls: aria-label, else the text without aria-hidden parts. */
function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null) return label;
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return textOf(copy);
}
/** The description of a control: the text of its aria-describedby elements. */
const descriptionOf = (el: Element) => (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  .map((id) => { const d = document.getElementById(id); if (!d) throw new Error(`no #${id}`); return textOf(d); }).join(' ');

function controls(view: PlayButtonView, extra: { resetDisabled?: string | null } = {}) {
  const onToggle = vi.fn();
  const onReset = vi.fn();
  const m = mount(<PlaybackControls button={view} onToggle={onToggle} onReset={onReset} {...extra} />);
  return { m, onToggle, onReset, play: m.container.querySelector<HTMLButtonElement>('.ctl-primary')!, reset: button(m.container, RESET_LABEL) };
}

/** The assembled map slot of one page state with a play state, mounted (the layout is stateless). */
function layoutElement(s: PageState, play: PlayState) {
  const hook = hookFor(s);
  const view = simPageView({ data: hook, selection: s.selection, focus: s.focus, layers: DEFAULT_LAYERS });
  const handlers = createSimPageHandlers({
    sim: hook, view, selection: s.selection, onSelectionChange: () => {}, setFocus: () => {},
    setPanTo: () => {}, setLegendOpen: () => {}, compare: COMPARE_IDLE, setCompare: () => {}, nextPanSeq: () => 1,
    play, journeyPlay: { play: () => {}, pause: () => false, reset: () => {} },
  });
  return <SimPageLayout view={view} focus={s.focus} legendOpen handlers={handlers}
    compare={compareView(COMPARE_IDLE, view, hook.sim?.runId ?? null)} play={play} />;
}
const NETWORK = FOUR_STATES.find((s) => s.name === 'network')!;

describe('Tab order on the map: Play, Back to start, then the legend toggle', () => {
  it('in the assembled page the three are consecutive tab stops of the map, in that order', () => {
    const { container } = mount(layoutElement(NETWORK, PLAY_IDLE));
    const map = container.querySelector('.spc-map')!;
    const stops = tabOrder(container).filter((el) => map.contains(el));
    // The sample run's clock is playing on its own, so the one button reads Pause.
    const playName = NETWORK.sim.clock.playing ? PAUSE_LABEL : PLAY_LABEL;
    expect(stops.map(nameOf)).toEqual([playName, RESET_LABEL, LEGEND_LABEL]);
    expect(stops[0].classList.contains('ctl-primary')).toBe(true);
    // The two buttons are in the pill in the order they are drawn (left to right), and nothing else is.
    expect([...container.querySelectorAll('.spc-playbar button')].map(nameOf)).toEqual([playName, RESET_LABEL]);
  });

  it('a greyed-out button stays a tab stop (aria-disabled, never disabled), so focus is never dropped', () => {
    const { m, play, reset } = controls(FINISHED, { resetDisabled: BUSY_REASON });
    expect(play.disabled).toBe(false);
    expect(reset.disabled).toBe(false);
    expect(tabOrder(m.container)).toEqual([play, reset]);
  });
});

describe('a visible focus ring on the dark pill', () => {
  // A 2px white ring inside each control, on the ink of the pill (controls.css, legend.css).
  it.each([
    ['client/src/components/sim/v2/controls/controls.css', '.ctl-btn:focus-visible'],
    ['client/src/components/sim/v2/legend/legend.css', '.ml__toggle:focus-visible'],
  ])('%s: %s', (file, selector) => {
    const css = read(file);
    const rule = new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule).toMatch(/outline:\s*2px solid var\(--panel[^)]*\)/);
    expect(rule).toMatch(/outline-offset:\s*-2px/);
    // Never taken away elsewhere in the file.
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  });
});

describe('Space and Enter', () => {
  it('a click (what Enter and Space do on a native button) on Play, Back to start and the legend toggle', () => {
    const { onToggle, onReset, play, reset } = controls(PLAY);
    click(play);
    click(reset);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect([play.type, reset.type]).toEqual(['button', 'button']);

    const onOpenChange = vi.fn();
    const legend = mount(<MapLegend mode="network" open onOpenChange={onOpenChange} />);
    click(button(legend.container, /Legend/));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('page/keyMap.ts leaves Space on a focused control to that control, and plays from anywhere else', () => {
    const { play, reset } = controls(PLAY);
    const toggle = mount(<MapLegend mode="network" />).container.querySelector('.ml__toggle')!;
    for (const target of [play, reset, toggle]) {
      expect(simKeyAction({ key: ' ', target: target as HTMLElement }, { mode: 'network', playing: false })).toBeNull();
    }
    expect(simKeyAction({ key: ' ', target: document.body }, { mode: 'network', playing: false })).toBe('toggle_play');
  });

  it('a greyed-out button does nothing when pressed', () => {
    const { onToggle, onReset, play, reset } = controls(FINISHED, { resetDisabled: BUSY_REASON });
    click(play);
    click(reset);
    expect(onToggle).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });
});

describe('names and states for a screen reader', () => {
  it('Play/Pause says its state by its name, and no aria-pressed as well', () => {
    const { m, play } = controls(PLAY);
    expect(nameOf(play)).toBe(PLAY_LABEL);
    expect(play.hasAttribute('aria-pressed')).toBe(false);
    m.rerender(<PlaybackControls button={PAUSE} onToggle={() => {}} onReset={() => {}} />);
    const again = m.container.querySelector('.ctl-primary')!;
    expect(again).toBe(play); // the same button, so focus stays on it while its name changes
    expect(nameOf(again)).toBe(PAUSE_LABEL);
    expect(again.hasAttribute('aria-pressed')).toBe(false);
  });

  it('no key hint, on screen or for a screen reader (DECISIONS pass 63: Space stays, no key hints)', () => {
    const { m } = controls(PLAY);
    expect(m.container.querySelectorAll('[aria-keyshortcuts]')).toHaveLength(0);
  });

  it('every icon is hidden, so a name is its label alone', () => {
    const { m } = controls(PLAY);
    for (const svg of m.container.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
    const card = mount(<OvernightCard text="Overnight at Etsy" />);
    expect(card.container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(textOf(card.container)).toBe('Overnight at Etsy');
  });

  it('the legend toggle is named "Legend" by aria-label (legend.css shows it in capitals, which Chrome reads into the name)', () => {
    const { container } = mount(<MapLegend mode="network" />);
    const toggle = container.querySelector<HTMLButtonElement>('.ml__toggle')!;
    expect(toggle.getAttribute('aria-label')).toBe(LEGEND_LABEL);
    expect(nameOf(toggle)).toBe('Legend');
    // The name is the visible word, so voice control ("click Legend") finds it.
    expect(textOf(toggle).startsWith(LEGEND_LABEL)).toBe(true);
    expect(read('client/src/components/sim/v2/legend/legend.css')).toMatch(/\.ml__toggle\s*\{[^}]*text-transform:\s*uppercase/);
    expect(container.querySelector('section')!.getAttribute('aria-label')).toBe(LEGEND_REGION_LABEL);
  });

  it('the legend toggle says open or closed, and controls the list it hides', () => {
    const { container } = mount(<MapLegend mode="network" />);
    const toggle = container.querySelector<HTMLButtonElement>('.ml__toggle')!;
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect([toggle.getAttribute('aria-expanded'), body.hidden]).toEqual(['true', false]);
    click(toggle);
    expect([toggle.getAttribute('aria-expanded'), body.hidden]).toEqual(['false', true]);
    expect(document.activeElement).toBe(toggle);
    click(toggle);
    expect([toggle.getAttribute('aria-expanded'), body.hidden]).toEqual(['true', false]);
  });

  it.each([
    ['finished run', FINISHED, null],
    ['busy', BUSY, BUSY_REASON],
  ])('%s: a greyed-out Play has its reason as tooltip and description', (_name, view, resetDisabled) => {
    const { play, reset } = controls(view, { resetDisabled });
    expect(play.getAttribute('aria-disabled')).toBe('true');
    expect(play.title).toBe(view.note);
    expect(descriptionOf(play)).toBe(view.note);
    if (resetDisabled) {
      // The same reason is in the page once; both buttons point at it.
      expect(reset.getAttribute('aria-disabled')).toBe('true');
      expect(reset.title).toBe(resetDisabled);
      expect(descriptionOf(reset)).toBe(resetDisabled);
      expect(document.querySelectorAll('.ctl-note')).toHaveLength(1);
    } else {
      expect(reset.hasAttribute('aria-disabled')).toBe(false);
      expect(reset.hasAttribute('aria-describedby')).toBe(false);
    }
  });

  it('a greyed-out Back to start alone has its own reason', () => {
    const { play, reset } = controls(PLAY, { resetDisabled: BUSY_REASON });
    expect(play.hasAttribute('aria-describedby')).toBe(false);
    expect([reset.title, descriptionOf(reset)]).toEqual([BUSY_REASON, BUSY_REASON]);
  });

  it('an enabled button has no tooltip and no description', () => {
    const { play, reset } = controls(PLAY);
    for (const b of [play, reset]) {
      expect(b.hasAttribute('title')).toBe(false);
      expect(b.hasAttribute('aria-describedby')).toBe(false);
      expect(b.hasAttribute('aria-disabled')).toBe(false);
    }
  });
});

describe('the overnight card is announced politely when it appears', () => {
  it('the card goes into a polite live region that was in the page before it, and leaves it empty after', () => {
    const m = mount(layoutElement(NETWORK, PLAY_IDLE));
    const region = m.container.querySelector<HTMLElement>('.spc-announce')!;
    expect(region.getAttribute('role')).toBe('status'); // implies aria-live="polite"
    expect(region.getAttribute('aria-live')).not.toBe('assertive');
    expect(textOf(region)).toBe('');

    const running = { status: 'running', overnight: true, shipmentId: null, runId: NETWORK.sim.runId } as const;
    m.rerender(layoutElement(NETWORK, running));
    expect(m.container.querySelector('.spc-announce')).toBe(region); // the same region: its new text is read
    expect(region.querySelector('.spc-overnight')).not.toBeNull();
    expect(textOf(region)).toBe(NETWORK_OVERNIGHT_TEXT);
    // The card itself is not a second live region, so it is read once.
    expect(region.querySelectorAll('[role], [aria-live]')).toHaveLength(0);

    m.rerender(layoutElement(NETWORK, { ...running, overnight: false }));
    expect(m.container.querySelector('.spc-announce')).toBe(region);
    expect(textOf(region)).toBe('');
  });
});

describe('short labels, the same words as the README', () => {
  it('Play, Pause, Back to start; the README uses them as written', () => {
    expect([PLAY_LABEL, PAUSE_LABEL, RESET_LABEL, LEGEND_LABEL]).toEqual(['Play', 'Pause', 'Back to start', 'Legend']);
    const readme = read('README.md');
    for (const label of [PLAY_LABEL, PAUSE_LABEL, RESET_LABEL, 'Watch a package']) expect(readme).toContain(`**${label}**`);
    // Each a word or three: it fits the pill at 220 px.
    for (const label of [PLAY_LABEL, PAUSE_LABEL, RESET_LABEL, LEGEND_LABEL]) expect(label.split(' ').length).toBeLessThanOrEqual(3);
  });
});
