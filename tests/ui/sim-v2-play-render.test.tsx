// #496, #648: the one Play/Pause button as the page lays it out (static renders, no DOM): every
// state with its accessible name, the step line, the error, the overnight card, the order of the
// left panel, and the handlers (one button for the journey and the clock; other actions pause the journey).
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoogleBaseMap } from '../../client/src/components/map/GoogleBaseMap';
import type { MapMover } from '../../client/src/components/map/types';
import {
  SimPageBody, SimPageLayout, createSimPageHandlers,
} from '../../client/src/components/sim/v2/compose/SimPageBody';
import { COMPARE_IDLE, compareView, simPageView } from '../../client/src/components/sim/v2/compose/simPageView';
import {
  NO_JOURNEY_TEXT, PAUSED_TEXT, PLAY_FAILED_TEXT, PLAY_IDLE, playErrorText, playStatusText,
  type PlayState,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { OvernightCard } from '../../client/src/components/sim/v2/compose/OvernightCard';
import { PLAY_NOTE_ID, PlaybackControls } from '../../client/src/components/sim/v2/controls/PlaybackControls';
import { BUSY_REASON, FINISHED_REASON } from '../../client/src/components/sim/v2/controls/controlsModel';
import { buildJourney, type Journey, type UnmatchedJourney } from '../../client/src/components/sim/v2/journey/journeyModel';
import { JourneyTimeline } from '../../client/src/components/sim/v2/journey/JourneyTimeline';
import { INITIAL_SIM_DATA, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import type { SimulatorV2 } from '../../client/src/components/sim/v2/live/useSimulatorV2';
import type { Selection } from '../../client/src/components/sim/v2/network/selectionModel';
import { DEFAULT_LAYERS, NO_FOCUS } from '../../client/src/components/sim/v2/workspaceModel';
import { T, map, simAt } from './sim-v2-journey-sample';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function hookOf(state: Partial<SimDataState>): SimulatorV2 {
  return {
    ...INITIAL_SIM_DATA,
    ...state,
    control: vi.fn(async () => ({ ok: true }) as never),
    compare: vi.fn(async () => null),
    refetch: vi.fn(),
    dismissActionError: vi.fn(),
  };
}

const relayAt = (t: number, status = {}) => buildJourney({ shipmentId: 'shp-2', sim: simAt(t, status), map }) as Journey;
const unmatched = buildJourney({ shipmentId: 'shp-3', sim: simAt(T.beforePickup), map }) as UnmatchedJourney;
const running: PlayState = { status: 'running', overnight: false, shipmentId: 'shp-2', runId: 'run-1' };
const at = (status: 'paused' | 'finished' | 'failed'): PlayState => ({ status, shipmentId: 'shp-2', runId: 'run-1' });

type El = ReactElement<Record<string, unknown>>;
function collect(node: ReactNode, expand: Set<string>, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, expand, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as El;
  out.push(el);
  if (typeof el.type === 'function' && expand.has(el.type.name)) {
    collect((el.type as (p: unknown) => ReactNode)(el.props), expand, out);
    return out;
  }
  for (const v of Object.values(el.props ?? {})) {
    if (isValidElement(v) || Array.isArray(v)) collect(v as ReactNode, expand, out);
  }
  return out;
}

/** The <button> markup (name = its text) and its attributes. */
const buttonsIn = (html: string) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
  .map(([, attrs, inner]) => ({ attrs, name: text(inner) }));
/** The markup of the left ("Controls") panel body, and of the right ("Inspector") one. */
const leftOf = (html: string) => html.slice(html.indexOf('id="sim-v2-left-body"'), html.indexOf('class="sw-map"'));
const rightOf = (html: string) => html.slice(html.indexOf('id="sim-v2-right-body"'));
/** The Play/Pause button of the left panel: the one primary button of the playback block. */
const playPauseIn = (html: string) => {
  const all = buttonsIn(leftOf(html)).filter((b) => b.attrs.includes('ctl-primary'));
  expect(all).toHaveLength(1);
  return all[0];
};

describe('the step line', () => {
  it('names the step the package is heading for, read from the timeline', () => {
    expect(playStatusText(relayAt(T.beforePickup), running)).toBe('Step 1 of 4 next: Pickup at sender at DUMBO Studio.');
    expect(playStatusText(relayAt(T.overnight, { 'shp-2': 'at_hub' }), running))
      .toBe('Step 3 of 4 next: Pickup at relay point at Brooklyn Roasting.');
    expect(playStatusText(relayAt(T.afterDelivery, { 'shp-2': 'delivered' }), at('finished')))
      .toBe('Journey complete: Delivered to recipient at Etsy.');
  });

  it('is the same text for every seek inside one step (announced once per step)', () => {
    // The pickup happens at 1042 (its service end): one change between 1041 and 1043, then none.
    const texts = [1041, 1043, 1045, 1049, 1051, 1061].map((t) => playStatusText(relayAt(t), running));
    expect(texts[0]).toBe('Step 1 of 4 next: Pickup at sender at DUMBO Studio.');
    expect(new Set(texts.slice(1))).toEqual(new Set(['Step 2 of 4 next: Drop at relay point at Brooklyn Roasting.']));
  });

  it('idle says nothing; Pause says "Journey paused."; unmatched and no package say nothing', () => {
    expect(playStatusText(relayAt(T.onLeg1), PLAY_IDLE)).toBe('');
    expect(playStatusText(relayAt(T.onLeg1), at('paused'))).toBe(PAUSED_TEXT);
    expect(PAUSED_TEXT).toBe('Journey paused.');
    expect(playStatusText(unmatched, running)).toBe('');
    expect(playStatusText(null, running)).toBe('');
  });

  it("the error carries the hook's message, or a fixed sentence", () => {
    expect(playErrorText(at('failed'), 'Request failed')).toBe('Play stopped: Request failed');
    expect(playErrorText(at('failed'), null)).toBe(PLAY_FAILED_TEXT);
    expect(playErrorText(running, 'Request failed')).toBeNull();
  });
});

describe('OvernightCard', () => {
  it('is a card with a moon icon hidden from screen readers and the text it is given', () => {
    const html = renderToStaticMarkup(<OvernightCard text="Overnight at Brooklyn Roasting" />);
    // #725: not a live region itself; the page puts it into the map's always-mounted role="status".
    expect(html).toMatch(/^<p class="spc-overnight">/);
    expect(html).not.toContain('role=');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>/);
    expect(text(html)).toBe('Overnight at Brooklyn Roasting');
    expect(html).not.toMatch(/<button|<a\b/);
  });
});

describe('the one Play/Pause button in the page', () => {
  const EXPAND = new Set(['ReadyLayout', 'RightPanel', 'BackButton', 'PanelSection']);

  function layout(sim: SimulatorV2, selection: Selection, play?: PlayState, movers?: MapMover[]) {
    const journeyPlay = { play: vi.fn(), pause: vi.fn(() => true), reset: vi.fn() };
    const view = simPageView({ data: sim, selection, focus: NO_FOCUS, layers: DEFAULT_LAYERS });
    const handlers = createSimPageHandlers({
      sim, view, selection, onSelectionChange: vi.fn(), setFocus: vi.fn(), setPanTo: vi.fn(),
      setLegendOpen: vi.fn(), compare: COMPARE_IDLE, setCompare: vi.fn(), nextPanSeq: () => 1, play, journeyPlay,
    });
    const el = SimPageLayout({
      view, focus: NO_FOCUS, legendOpen: true, compare: compareView(COMPARE_IDLE, view, 'run-1'),
      handlers, play, movers,
    });
    return { html: renderToStaticMarkup(<>{el}</>), tree: collect(el, EXPAND), handlers, journeyPlay, view, sim };
  }
  const journeyHook = (over: Partial<SimDataState> = {}) =>
    hookOf({ view: 'ready', sim: simAt(T.overnight, { 'shp-2': 'at_hub' }), map, ...over });
  const clockHook = (clock: Partial<NonNullable<SimDataState['sim']>['clock']>, over: Partial<SimDataState> = {}) => {
    const sim = simAt(T.overnight, { 'shp-2': 'at_hub' });
    return journeyHook({ sim: { ...sim, clock: { ...sim.clock, ...clock } }, ...over });
  };
  const pkg = (id: string): Selection => ({ kind: 'package', id });
  const controlsOf = (sim: SimulatorV2) => (sim.control as ReturnType<typeof vi.fn>).mock.calls.map(([r]) => r);

  it('the left panel has, in order: Playback (Play, Back to start), Packages, Focus, the comparison; nothing else', () => {
    for (const selection of [null, pkg('shp-2')]) {
      const { html } = layout(journeyHook(), selection);
      const left = leftOf(html);
      const titles = [...left.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
      expect(titles).toEqual(['Playback', 'Packages', 'Focus', 'Direct only vs relay points']);
      const order = ['ctl-playback', 'Back to start', 'Search packages', 'Focus on employee', 'Direct only vs relay points'].map((t) => left.indexOf(t));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((x, y) => x - y)).toEqual(order);
      expect(text(left)).not.toMatch(/Scenario|Planning cycle|Layers|Random|Generate|Recompute|Start new planning cycle/);
      expect(text(left)).not.toMatch(/Next event|Jump to morning|Finish|Reset playback|Speed|Simulation time|\b(1x|4x|20x)\b/);
      expect(left).not.toMatch(/type="range"|type="checkbox"|type="number"|aria-pressed="(true|false)"[^>]*>(1x|4x|20x)/);
    }
  });

  it('no keyboard hint text anywhere on the page', () => {
    for (const selection of [null, pkg('shp-2'), pkg('shp-3')]) {
      const words = text(layout(journeyHook(), selection, selection?.id === 'shp-2' ? running : undefined).html);
      expect(words).not.toMatch(/\bEsc\b|\bEscape\b|\bSpace\b|Spacebar|shortcut|keyboard|press \./i);
      expect(words).not.toMatch(/<kbd/);
    }
  });

  it('package picked, idle: one "Play", enabled; the right journey panel has no play button of its own', () => {
    const { html, tree } = layout(journeyHook(), pkg('shp-2'));
    const b = playPauseIn(html);
    expect(b.name).toBe('Play');
    expect(b.attrs).not.toMatch(/disabled/);
    expect(buttonsIn(html).filter((x) => /^(Play|Pause|Stop)/.test(x.name))).toHaveLength(1);
    expect(buttonsIn(rightOf(html)).some((x) => /Play|Pause|Stop/.test(x.name))).toBe(false);
    expect(text(html)).not.toMatch(/Play journey|about \d+ s/);
    expect(tree.filter((e) => e.type === PlaybackControls)).toHaveLength(1);
    expect(tree.some((e) => e.type === JourneyTimeline)).toBe(true);
    expect(html).toMatch(/<p class="ctl-status" role="status"><\/p>/); // the live region is there, empty
    expect(html).not.toContain('spc-journey--playing');
    expect(html).not.toContain('spc-overnight');
    expect(text(html)).not.toMatch(/\bhub\b/i);
  });

  it('running: the button reads "Pause", the current step is marked, the step line is shown', () => {
    const { html } = layout(journeyHook(), pkg('shp-2'), running);
    expect(playPauseIn(html).name).toBe('Pause');
    expect(buttonsIn(html).filter((x) => /^(Play|Pause|Stop)/.test(x.name))).toHaveLength(1);
    expect(html).toContain('spc-journey--playing');
    expect(html).toMatch(/aria-current="step"/);
    expect(html).toContain('role="status">Step 3 of 4 next: Pickup at relay point at Brooklyn Roasting.</p>');
    expect(html).not.toContain('spc-overnight');
  });

  it('running with the night ahead: the card "Overnight at <relay business>" is over the map, as a status', () => {
    const { html, tree } = layout(journeyHook(), pkg('shp-2'), { ...running, overnight: true });
    expect(tree.filter((e) => e.type === OvernightCard).map((e) => e.props.text)).toEqual(['Overnight at Brooklyn Roasting']);
    const mapSlot = html.slice(html.indexOf('class="spc-map"'), html.indexOf('id="sim-v2-right-body"'));
    expect(mapSlot).toMatch(/<div class="spc-announce" role="status"><p class="spc-overnight">.*Overnight at Brooklyn Roasting<\/span><\/p><\/div>/);
    expect(playPauseIn(html).name).toBe('Pause');
    expect(html).not.toMatch(/Overnight at biz-/); // the name, never the ID
  });

  it('paused, finished and failed: no card, the button reads "Play"', () => {
    for (const status of ['paused', 'finished', 'failed'] as const) {
      const { html } = layout(journeyHook(), pkg('shp-2'), at(status));
      expect(playPauseIn(html).name).toBe('Play');
      expect(html).not.toContain('spc-overnight');
      expect(html).not.toContain('spc-journey--playing');
    }
    expect(layout(journeyHook(), pkg('shp-2'), at('paused')).html).toContain('role="status">Journey paused.</p>');
  });

  it('a direct journey never gets the card, whatever the player says', () => {
    const { html } = layout(journeyHook(), pkg('shp-1'), { status: 'running', overnight: false, shipmentId: 'shp-1', runId: 'run-1' });
    expect(html).not.toContain('spc-overnight');
    expect(text(html)).not.toContain('Overnight at');
  });

  it('a failed step shows the error text from the hook under the button', () => {
    const { html } = layout(journeyHook({ actionError: 'Must be between 930 and 2160' }), pkg('shp-2'), at('failed'));
    expect(leftOf(html)).toContain('role="alert">Play stopped: Must be between 930 and 2160</p>');
  });

  it('unmatched package: the disabled button, described by the no-match sentence', () => {
    const { html } = layout(journeyHook(), pkg('shp-3'));
    const b = playPauseIn(html);
    expect(b.name).toBe('Play');
    expect(b.attrs).toMatch(/aria-disabled="true"/);
    expect(b.attrs).toContain(`aria-describedby="${PLAY_NOTE_ID}"`);
    expect(html).toContain(`id="${PLAY_NOTE_ID}">${NO_JOURNEY_TEXT}</p>`);
  });

  it('an unknown package and a package whose places are still loading: disabled, nothing to play', () => {
    for (const { html } of [layout(journeyHook(), pkg('shp-404')), layout(journeyHook({ map: null }), pkg('shp-2'))]) {
      const b = playPauseIn(html);
      expect(b.name).toBe('Play');
      expect(b.attrs).toMatch(/aria-disabled="true"/);
    }
  });

  it('no package: "Play" for a paused clock, "Pause" for a playing one, disabled with a reason at the end and while busy', () => {
    expect(playPauseIn(layout(journeyHook(), null).html).name).toBe('Play');
    expect(playPauseIn(layout(clockHook({ playing: true }), null).html).name).toBe('Pause');

    const finished = layout(clockHook({ timeMin: 2160 }), null).html;
    expect(playPauseIn(finished).attrs).toMatch(/aria-disabled="true"/);
    expect(text(leftOf(finished))).toContain(FINISHED_REASON);
    expect(buttonsIn(leftOf(finished)).find((b) => b.name === 'Back to start')!.attrs).not.toMatch(/disabled/);

    const busy = layout(journeyHook({ busy: true }), null).html;
    expect(playPauseIn(busy).attrs).toMatch(/aria-disabled="true"/);
    expect(buttonsIn(leftOf(busy)).find((b) => b.name === 'Back to start')!.attrs).toMatch(/aria-disabled="true"/);
    expect(leftOf(busy).split(BUSY_REASON)).toHaveLength(2); // the reason once
  });

  it('togglePlay with a package: plays the journey when idle, pauses it when running; the server clock is not touched', () => {
    const idle = layout(journeyHook(), pkg('shp-2'));
    idle.handlers.togglePlay();
    expect(idle.journeyPlay.play).toHaveBeenCalledTimes(1);
    expect(idle.journeyPlay.pause).not.toHaveBeenCalled();
    expect(controlsOf(idle.sim)).toEqual([]);

    const playing = layout(journeyHook(), pkg('shp-2'), running);
    playing.handlers.togglePlay();
    expect(playing.journeyPlay.pause).toHaveBeenCalledTimes(1);
    expect(playing.journeyPlay.play).not.toHaveBeenCalled();
    expect(controlsOf(playing.sim)).toEqual([]);

    for (const status of ['paused', 'finished', 'failed'] as const) {
      const again = layout(journeyHook(), pkg('shp-2'), at(status));
      again.handlers.togglePlay();
      expect(again.journeyPlay.play).toHaveBeenCalledTimes(1);
    }
  });

  it('togglePlay with a package and a playing server clock pauses the clock', () => {
    const l = layout(clockHook({ playing: true }), pkg('shp-2'));
    l.handlers.togglePlay();
    expect(controlsOf(l.sim)).toEqual([{ action: 'pause' }]);
    expect(l.journeyPlay.play).not.toHaveBeenCalled();
  });

  it('togglePlay with no package: network Play through the player, never `play` or `speed` (#790); a playing clock is paused', async () => {
    for (const speed of [120, 30, 600] as const) {
      const l = layout(clockHook({ speed }), null);
      l.handlers.togglePlay();
      await new Promise((r) => setTimeout(r, 0));
      expect(l.journeyPlay.play).toHaveBeenCalledTimes(1);
      expect(controlsOf(l.sim)).toEqual([]);
    }
    const network = { shipmentId: null, runId: 'run-1' };
    const runningNet = layout(journeyHook(), null, { status: 'running', overnight: false, ...network });
    runningNet.handlers.togglePlay();
    expect(runningNet.journeyPlay.pause).toHaveBeenCalledTimes(1);
    expect(controlsOf(runningNet.sim)).toEqual([]);

    const playing = layout(clockHook({ playing: true, speed: 600 }), null);
    playing.handlers.togglePlay();
    expect(controlsOf(playing.sim)).toEqual([{ action: 'pause' }]); // pausing never sends a speed
    expect(playing.journeyPlay.play).not.toHaveBeenCalled();
  });

  it('togglePlay does nothing while the button is disabled, and before the page is ready', () => {
    for (const l of [
      layout(journeyHook(), pkg('shp-3')), layout(journeyHook({ busy: true }), null), layout(clockHook({ timeMin: 2160 }), null),
      layout(hookOf({ view: 'loading' }), null), layout(hookOf({ view: 'loading' }), pkg('shp-2')),
    ]) {
      l.handlers.togglePlay();
      expect(controlsOf(l.sim)).toEqual([]);
      expect(l.journeyPlay.play).not.toHaveBeenCalled();
      expect(l.journeyPlay.pause).not.toHaveBeenCalled();
    }
  });

  it('the button and Back to start are wired to togglePlay and backToStart', () => {
    const { tree, handlers } = layout(journeyHook(), pkg('shp-2'));
    const controls = tree.find((e) => e.type === PlaybackControls)!;
    expect(controls.props.onToggle).toBe(handlers.togglePlay);
    expect(controls.props.onReset).toBe(handlers.backToStart);
  });

  it('Back to start resets the player and sends reset_playback; a timeline step pauses the journey, then seeks', () => {
    const l = layout(journeyHook(), pkg('shp-2'), running);
    l.handlers.backToStart();
    expect(l.journeyPlay.reset).toHaveBeenCalledTimes(1);
    expect(controlsOf(l.sim)).toEqual([{ action: 'reset_playback' }]);

    l.handlers.stepSeek(1952, 'biz-roast');
    expect(l.journeyPlay.pause).toHaveBeenCalledTimes(1);
    expect(controlsOf(l.sim)).toEqual([{ action: 'reset_playback' }, { action: 'seek', timeMin: 1952 }]);
  });

  it('the handlers no longer have generate, recompute, a new planning cycle or a layer toggle', () => {
    const { handlers } = layout(journeyHook(), null);
    for (const name of ['generate', 'resetPlanning', 'recompute', 'toggleLayer', 'control', 'playJourney', 'stopJourney']) {
      expect(handlers, name).not.toHaveProperty(name);
    }
  });

  it('the map draws the movers it is given (the tweened frame), else the polled ones', () => {
    const tweened: MapMover[] = [{ id: 'emp-3', kind: 'vehicle', lat: 40.7037, lng: -73.9874, label: 'Cy Lam' }];
    const withFrame = layout(journeyHook(), pkg('shp-2'), PLAY_IDLE, tweened);
    expect((withFrame.tree.find((e) => e.type === GoogleBaseMap)!.props.movers)).toBe(tweened);
    const polled = layout(journeyHook(), pkg('shp-2'));
    const view = polled.view;
    if (view.view !== 'ready') throw new Error('expected ready');
    expect(polled.tree.find((e) => e.type === GoogleBaseMap)!.props.movers).toBe(view.map.movers);
  });

  it('the map always gets every layer visible (no layer checkboxes)', () => {
    for (const selection of [null, pkg('shp-2')]) {
      const { tree } = layout(journeyHook(), selection);
      expect(tree.find((e) => e.type === GoogleBaseMap)!.props.visible).toEqual(DEFAULT_LAYERS);
    }
  });

  it('the stateful body renders the idle button for a matched package (first render, no effects)', () => {
    const html = renderToStaticMarkup(<SimPageBody sim={journeyHook()} selection={pkg('shp-2')} onSelectionChange={() => {}} />);
    expect(playPauseIn(html).name).toBe('Play');
    expect(text(html)).not.toMatch(/NaN|undefined/);
  });

  it('with `autoPlay` the first render is still idle: starting is an effect, once the journey is loaded', () => {
    const done = vi.fn();
    const sim = journeyHook();
    const html = renderToStaticMarkup(
      <SimPageBody sim={sim} selection={pkg('shp-2')} onSelectionChange={() => {}} autoPlay onAutoPlayDone={done} />,
    );
    expect(playPauseIn(html).name).toBe('Play');
    expect(done).not.toHaveBeenCalled();
    expect(controlsOf(sim)).toEqual([]);
  });
});
