// #426: render of the simulator page body with an injected hook value, the wiring of every control
// to the hook's actions, and the CSS rules of compose.css.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  SimPageBody, SimPageLayout, createSimPageHandlers, type SimPageHandlers,
} from '../../client/src/components/sim/v2/compose/SimPageBody';
import { RECONNECTING_TEXT, simPageView } from '../../client/src/components/sim/v2/compose/simPageView';
import { PlanningControls } from '../../client/src/components/sim/v2/controls/PlanningControls';
import { PlaybackControls } from '../../client/src/components/sim/v2/controls/PlaybackControls';
import { ScenarioControls } from '../../client/src/components/sim/v2/controls/ScenarioControls';
import { SPEED_OPTIONS, playbackRequest, speedRequest, type PlaybackAction } from '../../client/src/components/sim/v2/controls/controlsModel';
import { FocusSelector } from '../../client/src/components/sim/v2/FocusSelector';
import { JourneyTimeline } from '../../client/src/components/sim/v2/journey/JourneyTimeline';
import { LayerToggles } from '../../client/src/components/sim/v2/LayerToggles';
import { INITIAL_SIM_DATA, TRAVEL_DATA_MISSING_MESSAGE, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import type { SimulatorV2 } from '../../client/src/components/sim/v2/live/useSimulatorV2';
import type { Selection } from '../../client/src/components/sim/v2/network/selectionModel';
import { PackageList } from '../../client/src/components/sim/v2/PackageList';
import { SimWorkspace } from '../../client/src/components/sim/v2/SimWorkspace';
import { DEFAULT_LAYERS, NO_FOCUS, type Focus, type LayerVisibility } from '../../client/src/components/sim/v2/workspaceModel';
import { GoogleBaseMap } from '../../client/src/components/map/GoogleBaseMap';
import SimulatorV2Page from '../../client/src/pages/v2/SimulatorV2';
import type { Clock } from '../../shared/v2/types';
import { makeMap, makeSim } from './sim-v2-network-fixture';
import { T, map as journeyMap, simAt as journeySimAt } from './sim-v2-journey-sample';

// ---------- Helpers ----------
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

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

const networkHook = (over: Partial<SimDataState> = {}) => hookOf({ view: 'ready', sim: makeSim(), map: makeMap(), ...over });
const journeyHook = () => hookOf({ view: 'ready', sim: journeySimAt(T.overnight, { 'shp-2': 'at_hub' }), map: journeyMap });

function render(sim: SimulatorV2, selection: Selection = null) {
  return renderToStaticMarkup(<SimPageBody sim={sim} selection={selection} onSelectionChange={() => {}} />);
}

function assertClean(html: string) {
  const t = text(html);
  expect(t).not.toMatch(/NaN|undefined/);
  expect(t).not.toMatch(/\bhub\b/i);
  expect(t).not.toMatch(/synthetic/i);
  expect(t).not.toMatch(/\b(biz|home|emp|shp|plan)-[\w-]+/); // no raw IDs
}

// ---------- Render ----------
describe('SimPageBody render', () => {
  it('loading', () => {
    const html = render(hookOf({}));
    expect(text(html)).toContain('Loading the simulator…');
    expect(html).toContain('role="status"');
    assertClean(html);
  });

  it('503: the travel data message and Retry', () => {
    const html = render(hookOf({ view: 'unavailable', unavailable: { code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_MESSAGE } }));
    const t = text(html);
    expect(t).toContain('NYC travel data is not loaded on this server yet.');
    expect(t).toContain('Retry');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('sw-frame'); // no workspace behind it
    assertClean(html);
  });

  it('first-load error with the reconnecting note', () => {
    const html = render(hookOf({ view: 'error', error: 'Request failed', reconnecting: true }));
    expect(text(html)).toContain('Simulator could not load');
    expect(text(html)).toContain('Request failed');
    expect(text(html)).toContain(RECONNECTING_TEXT);
    // The connection message is never printed twice.
    const same = text(render(hookOf({ view: 'error', error: RECONNECTING_TEXT, reconnecting: true })));
    expect(same.split(RECONNECTING_TEXT).length - 1).toBe(1);
    assertClean(html);
  });

  it('reconnecting: the banner over the map, the last data still shown', () => {
    const html = render(networkHook({ reconnecting: true }));
    const t = text(html);
    expect(t).toContain(RECONNECTING_TEXT);
    expect(t).toContain('Run summary');
    expect(t).toContain('Astoria product proofs');
    expect(t).toContain('Generate');
    assertClean(html);
  });

  it('network mode: all controls, the package list and the run summary', () => {
    const html = render(networkHook());
    const t = text(html);
    for (const s of [
      'Playback', 'Play', 'Pause', 'Next event', 'Jump to morning', 'Finish', 'Reset playback', 'Simulation time',
      'Scenario', 'Preset', 'Seed', 'Generate',
      'Planning cycle', 'Start new planning cycle', 'Recompute matches',
      'Layers', 'Routes', 'Businesses', 'Homes',
      'Focus', 'Focus on employee', 'Focus on business', 'Maya Ortiz', 'Sunrise Bakery',
      'Packages', 'Astoria product proofs', 'Chelsea Print Studio → Sunrise Bakery', 'Unmatched',
      'Run summary', 'Delivered / requested', '0 / 3', 'Matched / requested', '2 / 3', '9 min',
    ]) {
      if (s === 'Pause') expect(t).toContain('Pause'); // the clock in the fixture is playing
      else expect(t).toContain(s);
    }
    expect(t).not.toContain('Back to network');
    expect(t).not.toContain('Package journey');
    assertClean(html);
  });

  it('network mode with a business selected: name and role', () => {
    const html = render(networkHook(), { kind: 'business', id: 'biz-etsy' });
    expect(text(html)).toContain('Etsy');
    expect(text(html)).toContain('Network business · DUMBO, Brooklyn');
    expect(text(html)).toContain('Clear selection');
    expect(text(html)).not.toContain('Run summary');
    assertClean(html);
  });

  it('journey mode: numbered steps, the legend and Back to network', () => {
    const html = render(journeyHook(), { kind: 'package', id: 'shp-2' });
    const t = text(html);
    for (const s of ['Step 1: Pickup at sender', 'Step 2: Drop at relay point', 'Step 3: Pickup at relay point', 'Step 4: Delivered to recipient']) {
      expect(t).toContain(s);
    }
    expect(html).toContain('aria-label="Journey legend"');
    expect(t).toContain('Leg 1');
    expect(t).toContain('Leg 2');
    expect(t).toContain('Normal commute');
    expect(t).toContain('Cy Lam');
    expect(t).toContain('Ben Okafor');
    expect(t).toContain('Package journey');
    expect(t).toContain('Coffee samples');
    expect(t.match(/Back to network/g)?.length).toBeGreaterThanOrEqual(1);
    expect(t).not.toContain('Run summary');
    assertClean(html);
  });

  it("unmatched package: the server's reason", () => {
    const html = render(networkHook(), { kind: 'package', id: 'shp-3' });
    expect(text(html)).toContain('No commute passes both businesses in time.');
    expect(text(html)).toContain('Back to network');
    assertClean(html);
  });

  it('unknown package: the message and Back to network', () => {
    const html = render(networkHook(), { kind: 'package', id: 'shp-404' });
    expect(text(html)).toContain('This package is not in the current scenario');
    expect(text(html)).toContain('Back to network');
    assertClean(html);
  });

  it('an action error is shown with Dismiss', () => {
    const html = render(networkHook({ actionError: 'Playback has started. Start a new planning cycle to recompute.' }));
    expect(text(html)).toContain('Playback has started.');
    expect(text(html)).toContain('Dismiss');
  });

  it('the page seeds the journey from ?package= (renders loading before the first poll)', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/nyc/simulator?package=shp-2']}><SimulatorV2Page /></MemoryRouter>,
    );
    expect(text(html)).toContain('Loading the simulator…');
  });
});

// ---------- Wiring: walk the element tree of the stateless layout ----------
type El = ReactElement<Record<string, unknown>>;
/** Hook-free components of the layout that the walker expands by calling them. */
const EXPAND = new Set(['ReadyLayout', 'RightPanel', 'BackButton', 'StateScreen']);

function collect(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as El;
  out.push(el);
  if (typeof el.type === 'function' && EXPAND.has(el.type.name)) {
    collect((el.type as (p: unknown) => ReactNode)(el.props), out);
    return out;
  }
  for (const v of Object.values(el.props ?? {})) {
    if (isValidElement(v) || Array.isArray(v)) collect(v as ReactNode, out);
  }
  return out;
}

function setup(hook: SimulatorV2, selection: Selection = null) {
  const onSelectionChange = vi.fn();
  const setFocus = vi.fn<(f: Focus) => void>();
  const setLayers = vi.fn<(u: (l: LayerVisibility) => LayerVisibility) => void>();
  const setPanTo = vi.fn();
  let seq = 0;
  const view = simPageView({ data: hook, selection, focus: NO_FOCUS, layers: DEFAULT_LAYERS });
  const handlers: SimPageHandlers = createSimPageHandlers({
    sim: hook, view, selection, onSelectionChange, setFocus, setLayers, setPanTo, nextPanSeq: () => ++seq,
  });
  const tree = collect(SimPageLayout({ view, focus: NO_FOCUS, layers: DEFAULT_LAYERS, handlers }));
  const find = <P,>(type: unknown) => {
    const hit = tree.find((e) => e.type === type);
    if (!hit) throw new Error(`element not found: ${String((type as { name?: string }).name)}`);
    return hit.props as P;
  };
  const buttons = (label: string) => tree.filter((e) => e.type === 'button' && text(renderToStaticMarkup(e)).includes(label));
  return { hook, view, tree, find, buttons, onSelectionChange, setFocus, setLayers, setPanTo };
}

describe('SimPageBody wiring', () => {
  it('each playback control calls the hook control action with its request', () => {
    const s = setup(networkHook());
    const { onControl, clock } = s.find<{ onControl: (r: unknown) => void; clock: Clock }>(PlaybackControls);
    const actions: PlaybackAction[] = ['playPause', 'nextEvent', 'jumpToMorning', 'finish', 'reset'];
    const requests = [
      ...actions.map((a) => playbackRequest(a, clock)),
      ...SPEED_OPTIONS.map((o) => speedRequest(o.speed)),
      { action: 'seek', timeMin: 1200 } as const,
    ];
    for (const r of requests) onControl(r);
    expect(s.hook.control).toHaveBeenCalledTimes(requests.length);
    requests.forEach((r, i) => expect(s.hook.control).toHaveBeenNthCalledWith(i + 1, r));
    expect(requests[0]).toEqual({ action: 'pause' }); // the fixture clock is playing
  });

  it('scenario and planning controls call generate, resetPlanning and recompute', () => {
    const s = setup(networkHook());
    const req = { preset: 'random' as const, seed: 7, employees: 40, packages: 12, maxExtraMin: 6 };
    s.find<{ onGenerate: (r: typeof req) => void }>(ScenarioControls).onGenerate(req);
    expect(s.hook.generate).toHaveBeenCalledWith(req);
    const planning = s.find<{ onReset: () => void; onRecompute: () => void }>(PlanningControls);
    planning.onReset();
    planning.onRecompute();
    expect(s.hook.resetPlanning).toHaveBeenCalledTimes(1);
    expect(s.hook.recompute).toHaveBeenCalledTimes(1);
  });

  it('layers, focus and the package list update the page state', () => {
    const s = setup(networkHook());
    s.find<{ onToggle: (k: string) => void }>(LayerToggles).onToggle('homes');
    const update = s.setLayers.mock.calls[0][0];
    expect(update(DEFAULT_LAYERS)).toEqual({ ...DEFAULT_LAYERS, homes: false });
    s.find<{ onChange: (f: Focus) => void }>(FocusSelector).onChange({ kind: 'business', id: 'biz-etsy' });
    expect(s.setFocus).toHaveBeenCalledWith({ kind: 'business', id: 'biz-etsy' });
    s.find<{ onSelect: (id: string) => void }>(PackageList).onSelect('shp-1');
    expect(s.onSelectionChange).toHaveBeenCalledWith({ kind: 'package', id: 'shp-1' });
  });

  it('map clicks select through selectionFromMapId; a package marker opens its journey', () => {
    const s = setup(networkHook());
    const { onSelect } = s.find<{ onSelect: (id: string | null) => void }>(GoogleBaseMap);
    onSelect('home-001');
    expect(s.onSelectionChange).toHaveBeenLastCalledWith({ kind: 'employee', id: 'emp-1' });
    onSelect('shp-2');
    expect(s.onSelectionChange).toHaveBeenLastCalledWith({ kind: 'package', id: 'shp-2' });
    const before = s.onSelectionChange.mock.calls.length;
    onSelect(null); // nothing selected yet: no change to report
    expect(s.onSelectionChange.mock.calls.length).toBe(before);
  });

  it('Esc in network mode clears the selection; in journey mode it exits the journey', () => {
    const n = setup(networkHook(), { kind: 'business', id: 'biz-etsy' });
    const ws = n.find<{ onClearSelection: () => void; journey?: unknown }>(SimWorkspace);
    expect(ws.journey).toBeUndefined();
    ws.onClearSelection();
    expect(n.onSelectionChange).toHaveBeenCalledWith(null);

    const j = setup(journeyHook(), { kind: 'package', id: 'shp-2' });
    const jws = j.find<{ journey: { title: string; onExit: () => void } }>(SimWorkspace);
    expect(jws.journey.title).toBe('Coffee samples');
    jws.journey.onExit();
    expect(j.onSelectionChange).toHaveBeenCalledWith(null);
  });

  it('the right-panel Back to network returns to the network', () => {
    const j = setup(journeyHook(), { kind: 'package', id: 'shp-2' });
    const back = j.buttons('Back to network');
    expect(back.length).toBeGreaterThanOrEqual(1);
    (back[0].props.onClick as () => void)();
    expect(j.onSelectionChange).toHaveBeenCalledWith(null);
  });

  it('a timeline step click seeks to the step minute and pans the map to its place', () => {
    const j = setup(journeyHook(), { kind: 'package', id: 'shp-2' });
    const timeline = j.find<{ onSeek: (t: number, p: string) => void }>(JourneyTimeline);
    if (j.view.view !== 'ready' || j.view.right.kind !== 'journey') throw new Error('expected a journey');
    const step = j.view.right.journey.steps[2]; // 3: pickup at the relay point, Day 2
    timeline.onSeek(step.timeMin, step.placeId);
    expect(j.hook.control).toHaveBeenCalledWith({ action: 'seek', timeMin: step.timeMin });
    expect(step.timeMin).toBe(1952);
    expect(j.setPanTo).toHaveBeenCalledWith({ lat: 40.7041, lng: -73.9867, key: 'biz-roast#1' });
    timeline.onSeek(step.timeMin, step.placeId);
    expect(j.setPanTo).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'biz-roast#2' }));
  });

  it('Retry on the 503 screen and Dismiss on an action error call the hook', () => {
    const u = setup(hookOf({ view: 'unavailable', unavailable: { code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_MESSAGE } }));
    const retry = u.tree.find((e) => typeof e.type === 'function' && e.type.name === 'Button')!;
    (retry.props.onClick as () => void)();
    expect(u.hook.refetch).toHaveBeenCalledTimes(1);

    const a = setup(networkHook({ actionError: 'Request failed' }));
    (a.buttons('Dismiss')[0].props.onClick as () => void)();
    expect(a.hook.dismissActionError).toHaveBeenCalledTimes(1);
  });
});

// ---------- CSS and files ----------
describe('compose.css and new files', () => {
  const css = readFileSync(resolve(__dirname, '../../client/src/components/sim/v2/compose/compose.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ''); // rules only, not the comments

  it('no radius over 4px, no box-shadow, no gradient', () => {
    expect(css).not.toMatch(/box-shadow/);
    expect(css).not.toMatch(/gradient/i);
    for (const m of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      const value = m[1].trim();
      const px = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((x) => Number(x[1]));
      expect(px.every((n) => n <= 4), value).toBe(true);
      expect(value).toMatch(/^(var\(--radius(-lg)?(, \d+px)?\)|\d+px|0)$/);
    }
  });

  it('the new source files are not ignored by git', () => {
    const files = [
      'client/src/pages/v2/SimulatorV2.tsx',
      'client/src/components/sim/v2/compose/simPageView.ts',
      'client/src/components/sim/v2/compose/SimPageBody.tsx',
      'client/src/components/sim/v2/compose/compose.css',
    ];
    const root = resolve(__dirname, '../..');
    let ignored: string;
    try {
      ignored = execFileSync('git', ['check-ignore', ...files], { cwd: root, encoding: 'utf8' });
    } catch (e) {
      // Exit code 1 = none of them is ignored. Anything else (no git): skip the check.
      const status = (e as { status?: number }).status;
      if (status === 1) ignored = '';
      else return;
    }
    expect(ignored.trim()).toBe('');
  });
});
