// The MVP II simulator page body (#426, completed in #460): the merged pieces in one workspace.
// left = controls, the package panel and the direct-only vs relay comparison; center = the NYC map
// with its legend; right = run summary / business or employee inspector / package journey.
//
// `SimPageBody` holds the page's UI state (focus, layers, pan target, legend open, comparison) and takes the data hook's
// value and the selection as props, so tests pass a hand-built hook value. `SimPageLayout` is the
// stateless render of one `simPageView`, so tests can call it and reach every handler without a DOM.
// Nothing about a delivery is computed here: every control calls the hook's actions.
import { useMemo, useRef, useState } from 'react';
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import { Button, Spinner } from '../../../../ui';
import { GoogleBaseMap } from '../../../map/GoogleBaseMap';
import type { MapPanTarget } from '../../../map/types';
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
import type { GenerateRequest, SimulatorV2 } from '../live/useSimulatorV2';
import type { Selection } from '../network/selectionModel';
import {
  BACK_TO_NETWORK, COMPARE_IDLE, LOADING_TEXT, MAP_PENDING_TEXT, RECONNECTING_TEXT, compareView, panTargetFor,
  selectionAfterMapClick, simPageView,
  type CompareState, type SimCompareView, type SimPageView, type SimReadyView, type SimRightView,
} from './simPageView';
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
};

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
    control: (req) => void d.sim.control(req),
    generate: (req) => void d.sim.generate(req),
    resetPlanning: () => void d.sim.resetPlanning(),
    recompute: () => void d.sim.recompute(),
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
  layers: LayerVisibility;
  panTo?: MapPanTarget;
  legendOpen: boolean;
  compare: SimCompareView;
  handlers: SimPageHandlers;
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

function RightPanel({ right, handlers }: { right: SimRightView; handlers: SimPageHandlers }) {
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
        <div className="spc-journey">
          <JourneyLegend carriers={right.journey.carriers} />
          <JourneyTimeline journey={right.journey} onSeek={handlers.stepSeek} />
          <div className="spc-journey__foot"><BackButton onClick={handlers.backToNetwork} /></div>
        </div>
      );
  }
}

function ReadyLayout({ view, focus, layers, panTo, legendOpen, compare, handlers }: SimPageLayoutProps & { view: SimReadyView }) {
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
      <GoogleBaseMap {...view.map} panTo={panTo} onSelect={handlers.mapSelect} />
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
      right={<RightPanel right={view.right} handlers={handlers} />}
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
};

export function SimPageBody({ sim, selection, onSelectionChange, initialFocus, initialLayers }: SimPageBodyProps) {
  const [focus, setFocus] = useState<Focus>(initialFocus ?? NO_FOCUS);
  const [layers, setLayers] = useState<LayerVisibility>(initialLayers ?? DEFAULT_LAYERS);
  const [panTo, setPanTo] = useState<MapPanTarget | undefined>(undefined);
  // Page state, not view state: a poll gives a new `sim`, never a new legend or comparison.
  const [legendOpen, setLegendOpen] = useState(true);
  const [compare, setCompare] = useState<CompareState>(COMPARE_IDLE);
  const panSeq = useRef(0);

  const view = useMemo(() => simPageView({ data: sim, selection, focus, layers }), [sim, selection, focus, layers]);
  const handlers = createSimPageHandlers({
    sim, view, selection, onSelectionChange, setFocus, setLayers, setPanTo, setLegendOpen, compare, setCompare,
    nextPanSeq: () => ++panSeq.current,
  });
  return (
    <SimPageLayout view={view} focus={focus} layers={layers} panTo={panTo} legendOpen={legendOpen}
      compare={compareView(compare, view, sim.sim?.runId ?? null)} handlers={handlers} />
  );
}
