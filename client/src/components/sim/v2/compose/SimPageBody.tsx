// The simulator page body (#426, completed in #460; one Play/Pause button in #648): the merged pieces in one workspace.
// left = the package panel, the focus and the direct-only vs relay comparison; center = the NYC map with its
// legend and, floating at its bottom center, Play/Pause and "Back to start" (#831); right = run summary /
// business or employee inspector / package journey.
//
// `SimPageBody` holds the page's UI state (focus, pan target, legend open, comparison) and takes the data hook's
// value and the selection as props, so tests pass a hand-built hook value. `SimPageLayout` is the
// stateless render of one `simPageView`, so tests can call it and reach every handler without a DOM.
// Nothing about a delivery is computed here: every control calls the hook's actions.
//
// #496: the map's movers are tweened between polls along their route lines (motion/useTweenedMovers,
// lines from moverPaths.ts). #648: with a package picked the one Play/Pause button plays its journey
// (journeyPlay.ts), which steps the server clock with `seek` and shows the overnight card in place
// of the night; with no package (#790) the same player steps through every carrier's commute. Every
// position on screen is a polled one or a point between two.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../../ui';
import { GoogleBaseMap } from '../../../map/GoogleBaseMap';
import type { MapMover, MapPanTarget } from '../../../map/types';
import { FocusSelector } from '../FocusSelector';
import { PackageList } from '../PackageList';
import { PackagePanel } from '../packages/PackagePanel';
import { BusinessInspector } from '../inspector/BusinessInspector';
import { EmployeeInspector } from '../inspector/EmployeeInspector';
import { MapLegend } from '../legend/MapLegend';
import { CompareSection } from '../compare/CompareSection';
import { PanelSection } from '../PanelSection';
import { RunSummary } from '../RunSummary';
import { SimWorkspace } from '../SimWorkspace';
import { DEFAULT_LAYERS, NO_FOCUS, type Focus, type FocusKind } from '../workspaceModel';
import { PlaybackControls } from '../controls/PlaybackControls';
import { PAUSE_REQUEST, RESET_REQUEST, resetDisabledReason, type PlayButtonView } from '../controls/controlsModel';
import { JourneyLegend } from '../journey/JourneyLegend';
import { JourneyTimeline } from '../journey/JourneyTimeline';
import type { JourneyResult } from '../journey/journeyModel';
import type { SimulatorV2 } from '../live/useSimulatorV2';
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
  PLAY_IDLE, overnightText, playButtonView, playErrorText, playStatusText, type PlayState,
} from './journeyPlay';
import { buildMoverLines, pathForMovers } from './moverPaths';
import { OvernightCard } from './OvernightCard';
import { SimStateFrame } from '../page/SimStateFrame';
import { useJourneyPlay } from './useJourneyPlay';
import './compose.css';

// ---------- The one Play/Pause button ----------

/** The accessible name of the floating playback group on the map (#831); it was the left panel's "Playback" heading. */
export const PLAYBACK_LABEL = 'Playback';

/** The picked package's journey as the right panel has it: null in network mode, while pending and when missing. */
function journeyOf(view: SimReadyView): JourneyResult | null {
  return view.right.kind === 'journey' || view.right.kind === 'unmatched' ? view.right.journey : null;
}

/** The button for one page view and play state. */
export function pagePlayButton(view: SimReadyView, play: PlayState): PlayButtonView {
  const c = view.controls;
  return playButtonView({
    packagePicked: view.mode === 'journey',
    journey: journeyOf(view),
    play,
    clock: c.clock,
    busy: c.busy,
    simEndMin: c.simEndMin,
  });
}

// ---------- Handlers ----------
export type SimPageHandlers = {
  /**
   * The one Play/Pause button, and the Space key: plays or pauses the picked package's journey, or
   * with no package every carrier's commute (#790); pauses a server clock playing on its own.
   * Nothing while the button is disabled.
   */
  togglePlay: () => void;
  /** "Back to start": the server's `reset_playback`. */
  backToStart: () => void;
  retry: () => void;
  dismissActionError: () => void;
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
};

/** The journey player as the handlers see it; `pause` says whether a journey was running. */
export type JourneyPlayControls = { play: () => void; pause: () => boolean; reset: () => void };

export type SimPageHandlerDeps = {
  sim: SimulatorV2;
  view: SimPageView;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  setFocus: (focus: Focus) => void;
  setPanTo: (target: MapPanTarget | undefined) => void;
  setLegendOpen: (open: boolean) => void;
  compare: CompareState;
  setCompare: (state: CompareState) => void;
  /** A new number per call; makes each pan request unique. */
  nextPanSeq: () => number;
  /** The play state on screen; decides what the one button does. Defaults to idle. */
  play?: PlayState;
  /** Absent where the body has no player (tests of the handlers alone): Play does nothing, Pause pauses the clock. */
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
  return {
    togglePlay: () => {
      if (d.view.view !== 'ready') return;
      switch (pagePlayButton(d.view, d.play ?? PLAY_IDLE).action) {
        case 'play_journey':
        case 'play_network':
          // Issue 923: a new Play takes the last failed action's message away, as every other control does
          // (the hook clears it when a control starts). Play only sends seeks, which are quiet, so without
          // this the red box of a step that failed while the server was away stayed to the end of the journey.
          d.sim.dismissActionError();
          d.journeyPlay?.play();
          return;
        case 'pause_journey': d.journeyPlay?.pause(); return;
        case 'pause_clock': void d.sim.control(PAUSE_REQUEST); return;
        case null: return;
      }
    },
    // Any other clock action ends a running journey first, so the two never fight.
    backToStart: () => { d.journeyPlay?.reset(); void d.sim.control(RESET_REQUEST); },
    retry: () => d.sim.refetch(),
    dismissActionError: () => d.sim.dismissActionError(),
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
      d.journeyPlay?.pause();
      void d.sim.control({ action: 'seek', timeMin });
      const target = panTargetFor(d.view, placeId, d.nextPanSeq());
      if (target) d.setPanTo(target);
    },
  };
}

// ---------- Stateless layout ----------
export type SimPageLayoutProps = {
  view: SimPageView;
  focus: Focus;
  panTo?: MapPanTarget;
  legendOpen: boolean;
  compare: SimCompareView;
  handlers: SimPageHandlers;
  /** The movers to draw this frame (tweened); defaults to the polled `view.map.movers`. */
  movers?: MapMover[];
  /** The journey player's state for the package on screen; defaults to idle. */
  play?: PlayState;
  /** `useJourneyPlay().settling`: the step announcement stays empty until Play's first step has landed (#725). */
  stepLineHeld?: boolean;
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

type RightPanelProps = { right: SimRightView; handlers: SimPageHandlers; play: PlayState };

function RightPanel({ right, handlers, play }: RightPanelProps) {
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
          <div className="spc-journey__foot"><BackButton onClick={handlers.backToNetwork} /></div>
        </div>
      );
    case 'journey':
      return (
        <div className={`spc-journey${play.status === 'running' ? ' spc-journey--playing' : ''}`}>
          <JourneyLegend carriers={right.journey.carriers} />
          <JourneyTimeline journey={right.journey} onSeek={handlers.stepSeek} />
          <div className="spc-journey__foot"><BackButton onClick={handlers.backToNetwork} /></div>
        </div>
      );
  }
}

function ReadyLayout({
  view, focus, panTo, legendOpen, compare, handlers, movers, play = PLAY_IDLE, stepLineHeld = false,
}: SimPageLayoutProps & { view: SimReadyView }) {
  const pk = view.packageList;
  const journey = journeyOf(view);
  const overnight = overnightText(journey, play);
  const left = (
    <>
      {view.actionError && (
        <div className="spc-action-error" role="alert">
          <p>{view.actionError}</p>
          <button type="button" className="sw-btn" onClick={handlers.dismissActionError}>Dismiss</button>
        </div>
      )}
      {/* First in the panel (#607, pass 61; Playback moved onto the map in #831): the list that opens a
          journey is reached without scrolling. */}
      <PanelSection title="Packages">
        {pk.kind === 'panel' ? (
          <PackagePanel sim={pk.sim} map={pk.map} selectedId={view.selectedPackageId} onSelect={handlers.selectPackage} />
        ) : (
          <PackageList items={pk.items} selectedId={view.selectedPackageId} onSelect={handlers.selectPackage} />
        )}
      </PanelSection>
      <PanelSection title="Focus">
        <FocusSelector employees={view.focusOptions.employees} businesses={view.focusOptions.businesses}
          focus={focus} onChange={handlers.setFocus} />
      </PanelSection>
      <CompareSection response={compare.response} loading={compare.loading} error={compare.error}
        disabled={compare.disabled} onRun={handlers.runCompare} />
    </>
  );
  const map = (
    <div className="spc-map">
      {/* The one Play/Pause button (#648): the picked package's journey, or with no package every commute
          (#790). #831: it floats at the bottom center of the map with "Back to start" next to it, so it is on
          screen whatever the panels show (scrolled, collapsed). Before the map in the page, so Tab reaches
          it before the map's own stops. #852: a dark pill with the two buttons only; the step text
          (`status`) goes to its visually hidden live region, the journey panel and the map symbols show it. */}
      <div className="spc-playbar" role="group" aria-label={PLAYBACK_LABEL}>
        <PlaybackControls button={pagePlayButton(view, play)} status={stepLineHeld ? '' : playStatusText(journey, play, view.controls.clock.timeMin)}
          error={playErrorText(play, view.actionError)} resetDisabled={resetDisabledReason(view.controls.busy)}
          onToggle={handlers.togglePlay} onReset={handlers.backToStart} />
      </div>
      <GoogleBaseMap {...view.map} movers={movers ?? view.map.movers} panTo={panTo} onSelect={handlers.mapSelect} />
      <div className="spc-legend" data-legend-mode={view.legend.label}>
        <MapLegend mode={view.legend.mode} hasSelection={view.legend.hasSelection}
          focus={view.legend.focus} open={legendOpen} onOpenChange={handlers.setLegendOpen} />
      </div>
      {/* #894: one sentence (unreachable, or answering with an error) over the last good data. */}
      {view.reconnecting && <p className="spc-banner" role="status">{view.reconnectingText ?? RECONNECTING_TEXT}</p>}
      {view.mapPending && <p className="spc-banner spc-banner--quiet" role="status">{MAP_PENDING_TEXT}</p>}
      {/* #725: the live region is always in the page and the card goes into it, so a screen reader announces
          the card once when it appears (a region inserted together with its text is often not read). */}
      <div className="spc-announce" role="status">{overnight && <OvernightCard text={overnight} />}</div>
    </div>
  );
  return (
    <SimWorkspace
      left={left}
      map={map}
      right={<RightPanel right={view.right} handlers={handlers} play={play} />}
      onClearSelection={handlers.clearSelection}
      journey={view.mode === 'journey' ? { title: view.journeyTitle ?? 'Package', onExit: handlers.backToNetwork } : undefined}
    />
  );
}

export function SimPageLayout(props: SimPageLayoutProps) {
  const { view, handlers } = props;
  switch (view.view) {
    // #894: the first load and a failed first load keep the workspace's frame (panels and map area),
    // so the page is never blank; the map area holds the one line. The poll goes on under both.
    case 'loading':
      return <SimStateFrame kind="loading" text={LOADING_TEXT} />;
    case 'error':
      return <SimStateFrame kind="error" text={view.message} onRetry={handlers.retry} />;
    // A 503 from the travel data is a setup fault with its own instructions: the whole page says so.
    case 'unavailable':
      return <StateScreen title="Simulator unavailable" message={view.message} reconnecting={view.reconnecting} onRetry={handlers.retry} />;
    case 'ready':
      return <ReadyLayout {...props} view={view} />;
  }
}

// ---------- Stateful body ----------

/** What the page's key map asks of the body (#496, #648). */
export type SimBodyKeys = {
  /** Esc asks this first: it pauses a running journey or network Play and returns true, so the next Esc goes back to the network. */
  stopJourney: () => boolean;
  /** Space: exactly the one Play/Pause button. */
  togglePlay: () => void;
};

export type SimPageBodyProps = {
  /** The value of `useSimulatorV2()`; tests pass a hand-built one. */
  sim: SimulatorV2;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  initialFocus?: Focus;
  /** Filled by the body while it is mounted; the page's key map reads it at key time. */
  keysRef?: { current: SimBodyKeys | null };
  /**
   * `?play=1` is in the URL (#648): once the selection is loaded, a matched package's journey starts
   * playing, once, and `onAutoPlayDone` is called so the page takes the key out of the URL. An
   * unknown or unmatched package, or no package, plays nothing and is reported done as well.
   */
  autoPlay?: boolean;
  onAutoPlayDone?: () => void;
};

const NO_MOVERS: MapMover[] = [];
const NO_CLOCK: TweenClock = { runId: '', timeMin: 0, playing: false, speed: 0 };

export function SimPageBody({ sim, selection, onSelectionChange, initialFocus, keysRef, autoPlay = false, onAutoPlayDone }: SimPageBodyProps) {
  const [focus, setFocus] = useState<Focus>(initialFocus ?? NO_FOCUS);
  const [panTo, setPanTo] = useState<MapPanTarget | undefined>(undefined);
  // Page state, not view state: a poll gives a new `sim`, never a new legend or comparison.
  const [legendOpen, setLegendOpen] = useState(true);
  const [compare, setCompare] = useState<CompareState>(COMPARE_IDLE);
  const panSeq = useRef(0);

  // #579: a new run numbers its IDs anew, so the focus of the old run goes back to "All". Adjusted
  // during render, so no frame shows the old focus. A new `version` of the same run keeps it; the
  // first run the page sees is not a change. The legend and the panels stay; the selection is the
  // page's (`useSimPageState` clears it) and the journey player resets on its own (useJourneyPlay
  // watches the runId).
  const runId = sim.sim?.runId ?? null;
  const [focusRunId, setFocusRunId] = useState(runId);
  if (runId !== null && runId !== focusRunId) {
    setFocusRunId(runId);
    if (focusRunId !== null) setFocus(NO_FOCUS);
  }

  // The layer checkboxes are gone (#648): the map always draws every layer.
  const view = useMemo(() => simPageView({ data: sim, selection, focus, layers: DEFAULT_LAYERS }), [sim, selection, focus]);
  const ready = view.view === 'ready' ? view : null;
  const polled = sim.sim;

  // ---- The journey player behind the one Play/Pause button ----
  const journeyPlay = useJourneyPlay({
    control: sim.control,
    runId: polled?.runId ?? null,
    clockPlaying: polled?.clock.playing ?? false,
    clockMin: polled?.clock.timeMin ?? 0,
    shipmentId: selection?.kind === 'package' ? selection.id : null,
    journey: ready?.right.kind === 'journey' ? ready.right.journey : null,
    network: polled,
    endMin: ready?.controls.simEndMin,
  });

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
    sim, view, selection, onSelectionChange, setFocus, setPanTo, setLegendOpen, compare, setCompare,
    nextPanSeq: () => ++panSeq.current,
    play: journeyPlay.state,
    journeyPlay,
  });

  // ---- Keys: Esc pauses a running journey first; Space is the button ----
  const pauseJourney = journeyPlay.pause;
  const latestToggle = useRef(handlers.togglePlay);
  latestToggle.current = handlers.togglePlay;
  useEffect(() => {
    if (!keysRef) return undefined;
    const keys: SimBodyKeys = { stopJourney: pauseJourney, togglePlay: () => latestToggle.current() };
    keysRef.current = keys;
    return () => {
      if (keysRef.current === keys) keysRef.current = null;
    };
  }, [keysRef, pauseJourney]);

  // ---- `?play=1`: start the journey once it is loaded, once ----
  const startJourney = journeyPlay.play;
  const settled = ready ? ready.right.kind : null;
  const autoPlayed = useRef(false);
  useEffect(() => {
    if (!autoPlay) {
      autoPlayed.current = false;
      return;
    }
    // Not loaded yet: the first poll, or the map the journey needs for its places.
    if (autoPlayed.current || settled === null || settled === 'pending') return;
    autoPlayed.current = true;
    if (settled === 'journey') startJourney();
    onAutoPlayDone?.();
  }, [autoPlay, settled, startJourney, onAutoPlayDone]);

  return (
    <SimPageLayout view={view} focus={focus} panTo={panTo} legendOpen={legendOpen}
      compare={compareView(compare, view, polled?.runId ?? null)} handlers={handlers}
      movers={movers} play={journeyPlay.state} stepLineHeld={journeyPlay.settling} />
  );
}
