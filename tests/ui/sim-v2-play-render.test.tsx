// #496: every state of the Play journey button with its accessible name, the step line, the error,
// and the wiring in the page body (button next to the timeline, other actions stop the journey).
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../client/src/ui';
import { GoogleBaseMap } from '../../client/src/components/map/GoogleBaseMap';
import type { MapMover } from '../../client/src/components/map/types';
import {
  SimPageBody, SimPageLayout, createSimPageHandlers,
} from '../../client/src/components/sim/v2/compose/SimPageBody';
import { COMPARE_IDLE, compareView, simPageView } from '../../client/src/components/sim/v2/compose/simPageView';
import {
  NO_JOURNEY_TEXT, PLAY_FAILED_TEXT, PLAY_IDLE, STOPPED_TEXT, playButtonView, playErrorText, playStatusText,
  type PlayState,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { PLAY_NOTE_ID, PlayJourneyButton } from '../../client/src/components/sim/v2/compose/PlayJourneyButton';
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
    control: vi.fn(async () => null),
    generate: vi.fn(async () => null),
    resetPlanning: vi.fn(async () => null),
    recompute: vi.fn(async () => null),
    compare: vi.fn(async () => null),
    refetch: vi.fn(),
    dismissActionError: vi.fn(),
  };
}

const relayAt = (t: number, status = {}) => buildJourney({ shipmentId: 'shp-2', sim: simAt(t, status), map }) as Journey;
const unmatched = buildJourney({ shipmentId: 'shp-3', sim: simAt(T.beforePickup), map }) as UnmatchedJourney;
const running: PlayState = { status: 'running', shipmentId: 'shp-2', runId: 'run-1' };

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

describe('PlayJourneyButton: every state with its accessible name', () => {
  const props = { status: '', error: null, onPlay: () => {}, onStop: () => {} };

  it('matched package, idle: "Play journey", enabled, described by "about N s"', () => {
    const html = renderToStaticMarkup(<PlayJourneyButton {...props} button={playButtonView(relayAt(T.beforePickup), PLAY_IDLE)} />);
    const [b] = buttonsIn(html);
    expect(b.name).toBe('Play journey');
    expect(b.attrs).not.toMatch(/disabled/);
    expect(b.attrs).toContain(`aria-describedby="${PLAY_NOTE_ID}"`);
    expect(html).toContain(`id="${PLAY_NOTE_ID}"`);
    expect(text(html)).toContain('about 14 s');
    expect(html).toMatch(/<p class="spc-play__status" role="status"><\/p>/); // the live region is there, empty
  });

  it('running: the button reads "Stop"', () => {
    const html = renderToStaticMarkup(<PlayJourneyButton {...props} button={playButtonView(relayAt(T.onLeg1), running)}
      status="Step 2 of 4 next: Drop at relay point at Brooklyn Roasting." />);
    const [b] = buttonsIn(html);
    expect(b.name).toBe('Stop');
    expect(b.attrs).not.toMatch(/disabled/);
    expect(text(html)).not.toContain('Play journey');
    expect(html).toContain('role="status">Step 2 of 4 next: Drop at relay point at Brooklyn Roasting.</p>');
  });

  it('unmatched package: "Play journey" disabled, described by the no-match sentence', () => {
    const view = playButtonView(unmatched, PLAY_IDLE);
    const html = renderToStaticMarkup(<PlayJourneyButton {...props} button={view} />);
    const [b] = buttonsIn(html);
    expect(b.name).toBe('Play journey');
    expect(b.attrs).toMatch(/disabled=""/);
    expect(b.attrs).toContain(`aria-describedby="${PLAY_NOTE_ID}"`);
    expect(text(html)).toContain('No journey to play: this package has no match yet.');
    expect(NO_JOURNEY_TEXT).toBe('No journey to play: this package has no match yet.');
  });

  it('a failed step: the error is an alert', () => {
    const html = renderToStaticMarkup(<PlayJourneyButton {...props} button={playButtonView(relayAt(T.onLeg1), PLAY_IDLE)}
      error="Play journey stopped: Must be between 930 and 2160" />);
    expect(html).toContain('role="alert">Play journey stopped: Must be between 930 and 2160</p>');
  });

  it('Play calls onPlay; Stop calls onStop', () => {
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const click = (button: ReturnType<typeof playButtonView>) => {
      const tree = collect(PlayJourneyButton({ ...props, onPlay, onStop, button }), new Set());
      const el = tree.find((e) => e.type === Button)!;
      (el.props.onClick as () => void)();
    };
    click(playButtonView(relayAt(T.beforePickup), PLAY_IDLE));
    expect(onPlay).toHaveBeenCalledTimes(1);
    click(playButtonView(relayAt(T.onLeg1), running));
    expect(onStop).toHaveBeenCalledTimes(1);
    const disabled = collect(PlayJourneyButton({ ...props, onPlay, onStop, button: playButtonView(unmatched, PLAY_IDLE) }), new Set())
      .find((e) => e.type === Button)!;
    expect(disabled.props.onClick).toBeUndefined();
  });
});

describe('the step line', () => {
  it('names the step the package is heading for, read from the timeline', () => {
    expect(playStatusText(relayAt(T.beforePickup), running)).toBe('Step 1 of 4 next: Pickup at sender at DUMBO Studio.');
    expect(playStatusText(relayAt(T.overnight, { 'shp-2': 'at_hub' }), running))
      .toBe('Step 3 of 4 next: Pickup at relay point at Brooklyn Roasting.');
    expect(playStatusText(relayAt(T.afterDelivery, { 'shp-2': 'delivered' }), { ...running, status: 'finished' }))
      .toBe('Journey complete: Delivered to recipient at Etsy.');
  });

  it('is the same text for every seek inside one step (announced once per step)', () => {
    // The pickup happens at 1042 (its service end): one change between 1041 and 1043, then none.
    const texts = [1041, 1043, 1045, 1049, 1051, 1061].map((t) => playStatusText(relayAt(t), running));
    expect(texts[0]).toBe('Step 1 of 4 next: Pickup at sender at DUMBO Studio.');
    expect(new Set(texts.slice(1))).toEqual(new Set(['Step 2 of 4 next: Drop at relay point at Brooklyn Roasting.']));
  });

  it('idle says nothing; Stop says "Journey stopped."; unmatched says nothing', () => {
    expect(playStatusText(relayAt(T.onLeg1), PLAY_IDLE)).toBe('');
    expect(playStatusText(relayAt(T.onLeg1), { ...running, status: 'stopped' })).toBe(STOPPED_TEXT);
    expect(playStatusText(unmatched, running)).toBe('');
  });

  it("the error carries the hook's message, or a fixed sentence", () => {
    expect(playErrorText({ ...running, status: 'failed' }, 'Request failed')).toBe('Play journey stopped: Request failed');
    expect(playErrorText({ ...running, status: 'failed' }, null)).toBe(PLAY_FAILED_TEXT);
    expect(playErrorText(running, 'Request failed')).toBeNull();
  });
});

describe('the journey panel in the page', () => {
  const EXPAND = new Set(['ReadyLayout', 'RightPanel', 'PlayBlock', 'BackButton']);

  function layout(sim: SimulatorV2, selection: Selection, play?: PlayState, movers?: MapMover[]) {
    const journeyPlay = { play: vi.fn(), stop: vi.fn(() => true) };
    const view = simPageView({ data: sim, selection, focus: NO_FOCUS, layers: DEFAULT_LAYERS });
    const handlers = createSimPageHandlers({
      sim, view, selection, onSelectionChange: vi.fn(), setFocus: vi.fn(), setLayers: vi.fn(), setPanTo: vi.fn(),
      setLegendOpen: vi.fn(), compare: COMPARE_IDLE, setCompare: vi.fn(), nextPanSeq: () => 1, journeyPlay,
    });
    const el = SimPageLayout({
      view, focus: NO_FOCUS, layers: DEFAULT_LAYERS, legendOpen: true, compare: compareView(COMPARE_IDLE, view, 'run-1'),
      handlers, play, movers,
    });
    return { html: renderToStaticMarkup(<>{el}</>), tree: collect(el, EXPAND), handlers, journeyPlay, view };
  }
  const journeyHook = (over: Partial<SimDataState> = {}) =>
    hookOf({ view: 'ready', sim: simAt(T.overnight, { 'shp-2': 'at_hub' }), map, ...over });
  const pkg = (id: string): Selection => ({ kind: 'package', id });

  it('idle: "Play journey" with its hint, placed with the timeline', () => {
    const { html, tree } = layout(journeyHook(), pkg('shp-2'));
    expect(text(html)).toContain('Play journey');
    expect(text(html)).toContain('about 14 s');
    expect(tree.some((e) => e.type === PlayJourneyButton)).toBe(true);
    expect(tree.some((e) => e.type === JourneyTimeline)).toBe(true);
    expect(html).not.toContain('spc-journey--playing');
    expect(text(html)).not.toMatch(/\bhub\b/i);
  });

  it('running: Stop, the current step marked, the step line', () => {
    const { html } = layout(journeyHook(), pkg('shp-2'), running);
    expect(buttonsIn(html).map((b) => b.name)).toContain('Stop');
    expect(html).toContain('spc-journey--playing');
    expect(html).toMatch(/aria-current="step"/);
    expect(html).toContain('role="status">Step 3 of 4 next: Pickup at relay point at Brooklyn Roasting.</p>');
  });

  it('a failed step shows the error text from the hook', () => {
    const { html } = layout(journeyHook({ actionError: 'Must be between 930 and 2160' }), pkg('shp-2'), { ...running, status: 'failed' });
    expect(html).toContain('role="alert">Play journey stopped: Must be between 930 and 2160</p>');
  });

  it('unmatched package: the disabled button and the sentence', () => {
    const { html } = layout(journeyHook(), pkg('shp-3'));
    const play = buttonsIn(html).find((b) => b.name === 'Play journey')!;
    expect(play.attrs).toMatch(/disabled=""/);
    expect(text(html)).toContain(NO_JOURNEY_TEXT);
  });

  it('Play and Stop reach the player; any other clock or run action and a step click stop it first', () => {
    const { handlers, journeyPlay } = layout(journeyHook(), pkg('shp-2'));
    handlers.playJourney!();
    expect(journeyPlay.play).toHaveBeenCalledTimes(1);
    handlers.stopJourney!();
    expect(journeyPlay.stop).toHaveBeenCalledTimes(1);
    handlers.control({ action: 'play' });
    handlers.generate({ preset: 'demo', seed: 1, employees: 60, packages: 24, maxExtraMin: 10 } as never);
    handlers.resetPlanning();
    handlers.recompute();
    handlers.stepSeek(1952, 'biz-roast');
    expect(journeyPlay.stop).toHaveBeenCalledTimes(6);
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

  it('the stateful body renders the idle button for a matched package (first render, no effects)', () => {
    const html = renderToStaticMarkup(<SimPageBody sim={journeyHook()} selection={pkg('shp-2')} onSelectionChange={() => {}} />);
    expect(buttonsIn(html).map((b) => b.name)).toContain('Play journey');
    expect(text(html)).toContain('about 14 s');
    expect(text(html)).not.toMatch(/NaN|undefined/);
  });
});
