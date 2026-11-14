// The MVP II simulator page body (#426, completed in #460): the merged pieces in one workspace.
// left = controls, the package panel and the direct-only vs relay comparison; center = the NYC map
// with its legend; right = run summary / business or employee inspector / package journey.
//
// `SimPageBody` holds the page's UI state (focus, layers, pan target, legend open, comparison) and takes the data hook's
// value and the selection as props, so tests pass a hand-built hook value. `SimPageLayout` is the
// stateless render of one `simPageView`, so tests can call it and reach every handler without a DOM.
// Nothing about a delivery is computed here: every control calls the hook's actions.
//
// #496: the map's movers are tweened between polls along their route lines (motion/useTweenedMovers,
// lines from moverPaths.ts), and the journey panel has "Play journey" (journeyPlay.ts), which steps
// the server clock with `seek`. Every position on screen is a polled one or a point between two.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import { Button, Spinner } from '../../../../ui';
import { GoogleBaseMap } from '../../../map/GoogleBaseMap';
import type { MapMover, MapPanTarget } from '../../../map/types';
import { FocusSelector } from '../FocusSelector';
import { LayerToggles } from '../LayerToggles';
import { PackageList } from '../PackageList';
import { PackagePanel } from '../packages/PackagePanel';
import { BusinessInspector } from '../inspector/BusinessInspector';
import { EmployeeInspector } from '../inspector/EmployeeInspector';
import { MapLegend } from '../legend/MapLegend';
import { CompareSection } from '../compare/CompareSection';
import { PanelSection } from '../PanelSection';
import { RunSummary } from '../RunSummary';
import { SimWorkspace } from '../SimWorkspace';
import {
  DEFAULT_LAYERS, NO_FOCUS, toggleLayer, type Focus, type FocusKind, type LayerKey, type LayerVisibility,
} from '../workspaceModel';
import { PlanningControls } from '../controls/PlanningControls';
import { PlaybackControls } from '../controls/PlaybackControls';
import { ScenarioControls } from '../controls/ScenarioControls';
import { JourneyLegend } from '../journey/JourneyLegend';
import { JourneyTimeline } from '../journey/JourneyTimeline';
import type { JourneyResult } from '../journey/journeyModel';
import type { GenerateRequest, SimulatorV2 } from '../live/useSimulatorV2';
import { mapKey } from '../live/simDataModel';
import { useTweenedMovers } from '../motion/useTweenedMovers';
import type { TweenClock } from '../motion/routeTween';
import type { Selection } from '../network/selectionModel';
import {
  BACK_TO_NETWORK, COMPARE_IDLE, LOADING_TEXT, MAP_PENDING_TEXT, RECONNECTING_TEXT, compareView, panTargetFor,
  selectionAfterMapClick, simPageView,
  type CompareState, type SimCompareView, type SimPageView, type SimReadyView, type SimRightView,
} from './simPageView';
import {
  PLAY_IDLE, playButtonView, playErrorText, playStatusText, type PlayState,
} from './journeyPlay';
import { buildMoverLines, pathForMovers } from './moverPaths';
import { PlayJourneyButton } from './PlayJourneyButton';
import { useJourneyPlay } from './useJourneyPlay';
import './compose.css';

// ---------- Handlers ----------
export type SimPageHandlers = {
  control: (req: SimControlRequest) => void;
  generate: (req: GenerateRequest) => void;
  resetPlanning: () => void;
  recompute: () => void;
  retry: () => void;
  dismissActionError: () => void;
  toggleLayer: (key: LayerKey) => void;
  setFocus: (focus: Focus) => void;
  selectPackage: (shipmentId: string) => void;
  selectBusiness: (businessId: string) => void;
  selectEmployee: (employeeId: string) => void;
  /** "Focus on this business / employee" in the inspector: sets the map focus. */
  focusOn: (kind: FocusKind, id: string) => void;
  setLegendOpen: (open: boolean) => void;
  /** Direct-only vs relay: calls the hook's read-only `compare`; nothing is applied to the run. */
  runCompare: () => void;
  mapSelect: (id: string | null) => void;
  clearSelection: () => void;
  backToNetwork: () => void;
  stepSeek: (timeMin: number, placeId: string) => void;
  /** Play journey (#496); absent where the body has no player (tests of the layout alone). */
  playJourney?: () => void;
  stopJourney?: () => void;
};

/** The Play journey player as the handlers see it. */
export type JourneyPlayControls = { play: () => void; stop: () => boolean };

export type SimPageHandlerDeps = {
  sim: SimulatorV2;
  view: SimPageView;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  setFocus: (focus: Focus) => void;
  setLayers: (update: (layers: LayerVisibility) => LayerVisibility) => void;
  setPanTo: (target: MapPanTarget | undefined) => void;
  setLegendOpen: (open: boolean) => void;
  compare: CompareState;
  setCompare: (state: CompareState) => void;
  /** A new number per call; makes each pan request unique. */
  nextPanSeq: () => number;
  /** Any other clock or run action stops a running Play journey first, so the two never fight. */
  journeyPlay?: JourneyPlayControls;
};

/** Every handler of the page. Plain functions over the hook's actions and the page's setters. */
export function createSimPageHandlers(d: SimPageHandlerDeps): SimPageHandlers {
  const select = (s: Selection) => {
    if (s !== d.selection) d.onSelectionChange(s);
  };
  const toNetwork = () => {
    d.setPanTo(undefined);
    select(null);
  };
  const stopPlay = () => void d.journeyPlay?.stop();
  return {
    control: (req) => { stopPlay(); void d.sim.control(req); },
    generate: (req) => { stopPlay(); void d.sim.generate(req); },
    resetPlanning: () => { stopPlay(); void d.sim.resetPlanning(); },
    recompute: () => { stopPlay(); void d.sim.recompute(); },
    retry: () => d.sim.refetch(),
    dismissActionError: () => d.sim.dismissActionError(),
    toggleLayer: (key) => d.setLayers((v) => toggleLayer(v, key)),
    setFocus: (focus) => d.setFocus(focus),
    selectPackage: (shipmentId) => select({ kind: 'package', id: shipmentId }),
    selectBusiness: (businessId) => select({ kind: 'business', id: businessId }),
    selectEmployee: (employeeId) => select({ kind: 'employee', id: employeeId }),
    focusOn: (kind, id) => d.setFocus({ kind, id }),
    setLegendOpen: (open) => d.setLegendOpen(open),
    runCompare: () => {
      const runId = d.sim.sim?.runId;
      if (!runId) return;
      if (d.compare.status === 'loading' && d.compare.runId === runId) return;
      d.setCompare({ status: 'loading', runId });
      void d.sim.compare().then((response) => {
        d.setCompare(response ? { status: 'done', runId, response } : { status: 'error', runId });
      });
    },
    mapSelect: (id) => select(selectionAfterMapClick(id, d.selection, d.sim)),
    clearSelection: toNetwork,
    backToNetwork: toNetwork,
    stepSeek: (timeMin, placeId) => {
      stopPlay();
      void d.sim.control({ action: 'seek', timeMin });
      const target = panTargetFor(d.view, placeId, d.nextPanSeq());
      if (target) d.setPanTo(target);
    },
    ...(d.journeyPlay ? { playJourney: d.journeyPlay.play, stopJourney: stopPlay } : {}),
  };
}

// ---------- Stateless layout ----------
export type SimPageLayoutProps = {
  view: SimPageView;
  focus: Focus;
  layers: LayerVisibility;
  panTo?: MapPanTarget;
  legendOpen: boolean;
  compare: SimCompareView;
  handlers: SimPageHandlers;
  /** The movers to draw this frame (tweened); defaults to the polled `view.map.movers`. */
  movers?: MapMover[];
  /** Play journey state for the package on screen; defaults to idle. */
  play?: PlayState;
};

function StateScreen({ title, message, reconnecting, onRetry }: { title: string; message: string; reconnecting: boolean; onRetry: () => void }) {
  return (
    <div className="spc-state">
      <div className="spc-state__panel" role="alert">
        <h1 className="spc-state__title">{title}</h1>
        <p className="spc-state__message">{message}</p>
        {reconnecting && message !== RECONNECTING_TEXT && <p className="spc-state__note">{RECONNECTING_TEXT}</p>}
        <Button variant="secondary" onClick={onRetry}>Retry</Button>
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="sw-btn spc-back" onClick={onClick}>
      <span aria-hidden="true">← </span>{BACK_TO_NETWORK}
    </button>
  );
}

const noop = () => {};

type RightPanelProps = { right: SimRightView; handlers: SimPageHandlers; play: PlayState; actionError: string | null };

/** The Play journey button, its step line and its error, next to the timeline. */
function PlayBlock({ journey, handlers, play, actionError }: Omit<RightPanelProps, 'right'> & { journey: JourneyResult }) {
  return (
    <PlayJourneyButton
      button={playButtonView(journey, play)}
      status={playStatusText(journey, play)}
      error={playErrorText(play, actionError)}
      onPlay={handlers.playJourney ?? noop}
      onStop={handlers.stopJourney ?? noop}
    />
  );
}

function RightPanel({ right, handlers, play, actionError }: RightPanelProps) {
  switch (right.kind) {
    case 'summary':
      return <RunSummary metrics={right.metrics} />;
    case 'business':
      return (
        <BusinessInspector
          model={right.model}
          onFocus={(id) => handlers.focusOn('business', id)}
          onClear={handlers.clearSelection}
          onSelectPackage={handlers.selectPackage}
          onSelectBusiness={handlers.selectBusiness}
          onSelectEmployee={handlers.selectEmployee}
        />
      );
    case 'employee':
      return (
        <EmployeeInspector
          model={right.model}
          onFocus={(id) => handlers.focusOn('employee', id)}
          onClear={handlers.clearSelection}
          onSelectPackage={handlers.selectPackage}
          onSelectBusiness={handlers.selectBusiness}
        />
      );
    case 'pending':
    case 'missing':
      return (
        <section className="spc-message" aria-label="Selection">
          <p role={right.kind === 'missing' ? 'alert' : 'status'}>{right.message}</p>
          <BackButton onClick={handlers.backToNetwork} />
        </section>
      );
    case 'unmatched':
      return (
        <div className="spc-journey">
          <JourneyTimeline journey={right.journey} onSeek={handlers.stepSeek} />
          <PlayBlock journey={right.journey} handlers={handlers} play={play} actionError={actionError} />
          <div className="spc-journey__foot"><BackButton onClick={handlers.backToNetwork} /></div>
        </div>
      );
    case 'journey':
      return (
        <div className={`spc-journey${play.status === 'running' ? ' spc-journey--playing' : ''}`}>
          <JourneyLegend carriers={right.journey.carriers} />
          <PlayBlock journey={right.journey} handlers={handlers} play={play} actionError={actionError} />
          <JourneyTimeline journey={right.journey} onSeek={handlers.stepSeek} />
          <div className="spc-journey__foot"><BackButton onClick={handlers.backToNetwork} /></div>
        </div>
      );
  }
}

function ReadyLayout({
  view, focus, layers, panTo, legendOpen, compare, handlers, movers, play,
}: SimPageLayoutProps & { view: SimReadyView }) {
  const c = view.controls;
  const pk = view.packageList;
  const left = (
    <>
      {view.actionError && (
        <div className="spc-action-error" role="alert">
          <p>{view.actionError}</p>
          <button type="button" className="sw-btn" onClick={handlers.dismissActionError}>Dismiss</button>
        </div>
      )}
      <PanelSection title="Playback">
        <PlaybackControls clock={c.clock} simStartMin={c.simStartMin} simEndMin={c.simEndMin}
          nextEventMin={c.nextEventMin} busy={c.busy} onControl={handlers.control} />
      </PanelSection>
      <PanelSection title="Scenario">
        <ScenarioControls value={c.scenario} phase={c.clock.phase} busy={c.busy} onGenerate={handlers.generate} />
      </PanelSection>
      <PanelSection title="Planning cycle">
        <PlanningControls phase={c.clock.phase} busy={c.busy} onReset={handlers.resetPlanning} onRecompute={handlers.recompute} />
      </PanelSection>
      <PanelSection title="Layers">
        <LayerToggles layers={layers} onToggle={handlers.toggleLayer} />
      </PanelSection>
      <PanelSection title="Focus">
        <FocusSelector employees={view.focusOptions.employees} businesses={view.focusOptions.businesses}
          focus={focus} onChange={handlers.setFocus} />
      </PanelSection>
      <PanelSection title="Packages">
        {pk.kind === 'panel' ? (
          <PackagePanel sim={pk.sim} map={pk.map} selectedId={view.selectedPackageId} onSelect={handlers.selectPackage} />
        ) : (
          <PackageList items={pk.items} selectedId={view.selectedPackageId} onSelect={handlers.selectPackage} />
        )}
      </PanelSection>
      <CompareSection response={compare.response} loading={compare.loading} error={compare.error}
        disabled={compare.disabled} onRun={handlers.runCompare} />
    </>
  );
  const map = (
    <div className="spc-map">
      <GoogleBaseMap {...view.map} movers={movers ?? view.map.movers} panTo={panTo} onSelect={handlers.mapSelect} />
      <div className="spc-legend" data-legend-mode={view.legend.label}>
        <MapLegend mode={view.legend.mode} layers={layers} hasSelection={view.legend.hasSelection}
          focus={view.legend.focus} open={legendOpen} onOpenChange={handlers.setLegendOpen} />
      </div>
      {view.reconnecting && <p className="spc-banner" role="status">{RECONNECTING_TEXT}</p>}
      {view.mapPending && <p className="spc-banner spc-banner--quiet" role="status">{MAP_PENDING_TEXT}</p>}
    </div>
  );
  return (
    <SimWorkspace
      left={left}
      map={map}
      right={<RightPanel right={view.right} handlers={handlers} play={play ?? PLAY_IDLE} actionError={view.actionError} />}
      onClearSelection={handlers.clearSelection}
      journey={view.mode === 'journey' ? { title: view.journeyTitle ?? 'Package', onExit: handlers.backToNetwork } : undefined}
    />
  );
}

export function SimPageLayout(props: SimPageLayoutProps) {
  const { view, handlers } = props;
  switch (view.view) {
    case 'loading':
      return (
        <div className="spc-state">
          <div className="spc-state__panel spc-state__panel--loading">
            <Spinner label={LOADING_TEXT} />
            <span aria-hidden="true">{LOADING_TEXT}</span>
            {view.reconnecting && <p className="spc-state__note">{RECONNECTING_TEXT}</p>}
          </div>
        </div>
      );
    case 'unavailable':
      return <StateScreen title="Simulator unavailable" message={view.message} reconnecting={view.reconnecting} onRetry={handlers.retry} />;
    case 'error':
      return <StateScreen title="Simulator could not load" message={view.message} reconnecting={view.reconnecting} onRetry={handlers.retry} />;
    case 'ready':
      return <ReadyLayout {...props} view={view} />;
  }
}

// ---------- Stateful body ----------
export type SimPageBodyProps = {
  /** The value of `useSimulatorV2()`; tests pass a hand-built one. */
  sim: SimulatorV2;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  initialFocus?: Focus;
  initialLayers?: LayerVisibility;
  /**
   * The page's Esc key asks this first (#496): it stops a running Play journey and returns true, so
   * the first Esc stops the journey and the next one goes back to the network.
   */
  escapeRef?: { current: (() => boolean) | null };
};

const NO_MOVERS: MapMover[] = [];
const NO_CLOCK: TweenClock = { runId: '', timeMin: 0, playing: false, speed: 0 };

export function SimPageBody({ sim, selection, onSelectionChange, initialFocus, initialLayers, escapeRef }: SimPageBodyProps) {
  const [focus, setFocus] = useState<Focus>(initialFocus ?? NO_FOCUS);
  const [layers, setLayers] = useState<LayerVisibility>(initialLayers ?? DEFAULT_LAYERS);
  const [panTo, setPanTo] = useState<MapPanTarget | undefined>(undefined);
  // Page state, not view state: a poll gives a new `sim`, never a new legend or comparison.
  const [legendOpen, setLegendOpen] = useState(true);
  const [compare, setCompare] = useState<CompareState>(COMPARE_IDLE);
  const panSeq = useRef(0);

  // #579: a new run (Random city, an import, a new planning cycle) numbers its IDs anew, so the
  // focus of the old run goes back to "All". Adjusted during render, so no frame shows the old focus.
  // A new `version` of the same run keeps it; the first run the page sees is not a change. Layers,
  // the legend and the panels stay; the selection is the page's (`useSimPageState` clears it) and
  // Play journey stops on its own (useJourneyPlay watches the runId).
  const runId = sim.sim?.runId ?? null;
  const [focusRunId, setFocusRunId] = useState(runId);
  if (runId !== null && runId !== focusRunId) {
    setFocusRunId(runId);
    if (focusRunId !== null) setFocus(NO_FOCUS);
  }

  const view = useMemo(() => simPageView({ data: sim, selection, focus, layers }), [sim, selection, focus, layers]);
  const ready = view.view === 'ready' ? view : null;
  const polled = sim.sim;

  // ---- Play journey ----
  const journeyPlay = useJourneyPlay({
    control: sim.control,
    runId: polled?.runId ?? null,
    clockPlaying: polled?.clock.playing ?? false,
    shipmentId: selection?.kind === 'package' ? selection.id : null,
    journey: ready?.right.kind === 'journey' ? ready.right.journey : null,
  });
  const stopJourney = journeyPlay.stop;
  useEffect(() => {
    if (!escapeRef) return undefined;
    escapeRef.current = stopJourney;
    return () => {
      if (escapeRef.current === stopJourney) escapeRef.current = null;
    };
  }, [escapeRef, stopJourney]);

  // ---- Movers between polls, along their route lines ----
  const linesKey = polled ? mapKey(polled) : '';
  // The lines change only with the map or the set of plans, so routeTween's per-path cache holds.
  const lines = useMemo(() => buildMoverLines(polled?.plans ?? [], sim.map), [sim.map, linesKey]);
  const clock: TweenClock = polled
    ? { runId: polled.runId, timeMin: polled.clock.timeMin, playing: polled.clock.playing, speed: polled.clock.speed }
    : NO_CLOCK;
  const movers = useTweenedMovers(
    ready ? ready.map.movers : NO_MOVERS, clock, pathForMovers(lines, clock.timeMin),
    { journey: journeyPlay.state.status === 'running' },
  );

  const handlers = createSimPageHandlers({
    sim, view, selection, onSelectionChange, setFocus, setLayers, setPanTo, setLegendOpen, compare, setCompare,
    nextPanSeq: () => ++panSeq.current,
    journeyPlay: { play: journeyPlay.play, stop: stopJourney },
  });
  return (
    <SimPageLayout view={view} focus={focus} layers={layers} panTo={panTo} legendOpen={legendOpen}
      compare={compareView(compare, view, polled?.runId ?? null)} handlers={handlers}
      movers={movers} play={journeyPlay.state} />
  );
}
