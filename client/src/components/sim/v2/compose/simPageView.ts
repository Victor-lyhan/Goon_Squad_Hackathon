// The MVP II simulator page (#426, completed in #460): one pure function turns the data hook's state
// plus the page's local UI state (selection, focus, layers) into everything the page shows.
// No React, no DOM, tested in Node.
//
// It only reshapes the polled responses through the merged models (buildNetworkView, buildJourney,
// the inspector models, the legend input). The inspector reads only SimulatorResponse and MapResponse
// (DECISIONS pass 46).
// Statuses, metrics, times and positions are read from the response, never computed (AGENTS.md).
import type { CompareResponse, MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import type { Clock, Metrics } from '../../../../../../shared/v2/types';
import type { LatLngBounds, MapMover, MapPanTarget, MapPlace, MapRoute, MapStop } from '../../../map/types';
import { dayNightAt, dayNightClockText, type DayNight } from '../../../map/dayNight';
import type { PackageListItem } from '../PackageList';
import type { FocusOption } from '../FocusSelector';
import { NO_FOCUS, type Focus, type LayerVisibility } from '../workspaceModel';
import { CONNECTION_LOST_MESSAGE, type SimDataState } from '../live/simDataModel';
import { buildNetworkView } from '../network/networkModel';
import { selectionFromMapId, type Selection } from '../network/selectionModel';
import {
  UNKNOWN_PLACE, boundsOf, buildJourney, statusLabelOf, type Journey, type UnmatchedJourney,
} from '../journey/journeyModel';
import {
  businessInspector, employeeInspector, type BusinessInspectorModel, type EmployeeInspectorModel,
} from '../inspector/inspectorModel';
import type { LegendMode } from '../legend/legendModel';

// ---------- Copy ----------
export const LOADING_TEXT = 'Loading the simulator…';
export const RECONNECTING_TEXT = CONNECTION_LOST_MESSAGE;
export const MAP_PENDING_TEXT = 'Loading places…';
export const MISSING_PACKAGE_TEXT = 'This package is not in the current scenario';
export const MISSING_BUSINESS_TEXT = 'This business is not in the current scenario';
export const MISSING_EMPLOYEE_TEXT = 'This employee is not in the current scenario';
export const BACK_TO_NETWORK = 'Back to network';
export const COMPARE_FAILED_TEXT = 'The comparison could not run. Try again.';

/**
 * The minute the run ends, where Play has nothing left and reads "Run finished". SimulatorResponse
 * carries no settings, so this is the end every run has today: Day 2 12:00 (the Settings.simEndMin default).
 */
export const SIM_END_MIN = 2160;

// ---------- Output types ----------
export type SimMapProps = {
  places: MapPlace[];
  routes: MapRoute[];
  movers: MapMover[];
  visible: LayerVisibility;
  selectedIds: string[];
  stops: MapStop[];
  fitTo: 'places' | LatLngBounds;
  /** Network view: name the businesses that are not dimmed, as many as fit without overlapping. */
  labelBusinesses: boolean;
  /** Journey: the sender, recipient and relay business are always named (never a carrier's home). */
  alwaysLabelIds: string[];
  /** Dark map with a moon or light map with a sun, from the polled clock (presentation only, #649). */
  dayNight: DayNight;
  /** The polled clock as the map badge shows it: "Day 1 · 6:12 PM". */
  clockText: string;
};

/** What the one Play/Pause button and "Back to start" read. */
export type SimControlsView = {
  clock: Clock;
  busy: boolean;
  simEndMin: number;
};

/** Right panel content. */
export type SimRightView =
  | { kind: 'summary'; metrics: Metrics }
  | { kind: 'business'; model: BusinessInspectorModel }
  | { kind: 'employee'; model: EmployeeInspectorModel }
  | { kind: 'missing'; message: string }
  /** The map response for this run has not arrived yet; the selection is shown once it does. */
  | { kind: 'pending'; message: string }
  | { kind: 'journey'; journey: Journey }
  | { kind: 'unmatched'; journey: UnmatchedJourney };

/**
 * The left panel's package list. Until the map arrives the rows cannot name their businesses, so
 * the plain list says "Loading places…"; then the package panel (filters, search, reason) takes over.
 */
export type SimPackagesView =
  | { kind: 'pending'; items: PackageListItem[] }
  | { kind: 'panel'; sim: SimulatorResponse; map: MapResponse };

/**
 * What the map legend describes. `label` is the page's mode: a journey, a focus or the whole network.
 * `mode`, `hasSelection` and `focus` are MapLegend's own props.
 */
export type SimLegendView = {
  label: 'network' | 'focus' | 'journey';
  mode: LegendMode;
  hasSelection: boolean;
  focus: Focus;
};

export type SimReadyView = {
  view: 'ready';
  reconnecting: boolean;
  mode: 'network' | 'journey';
  /** The map response has not arrived yet for this run (it follows the first poll). */
  mapPending: boolean;
  /** Title shown with "Back to network" at the top of the left panel; null in network mode. */
  journeyTitle: string | null;
  map: SimMapProps;
  /** Plain rows with the pending route label; shown only while `mapPending`. */
  packages: PackageListItem[];
  packageList: SimPackagesView;
  legend: SimLegendView;
  selectedPackageId: string | undefined;
  focusOptions: { employees: FocusOption[]; businesses: FocusOption[] };
  controls: SimControlsView;
  right: SimRightView;
  actionError: string | null;
};

export type SimPageView =
  | { view: 'loading'; reconnecting: boolean }
  | { view: 'unavailable'; message: string; reconnecting: boolean }
  | { view: 'error'; message: string; reconnecting: boolean }
  | SimReadyView;

export type SimPageInput = {
  data: SimDataState;
  selection: Selection;
  focus?: Focus;
  layers: LayerVisibility;
};

// ---------- Helpers ----------
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function emptyMap(runId: string): MapResponse {
  return { runId, businesses: [], homes: [], employees: [], polylines: [] };
}

function packageRows(sim: SimulatorResponse, map: MapResponse, mapPending: boolean): PackageListItem[] {
  const names = new Map(map.businesses.map((b) => [b.id, b.name]));
  const name = (id: string) => names.get(id) || UNKNOWN_PLACE;
  return [...sim.shipments]
    .sort((a, b) => a.createdSeq - b.createdSeq || byText(a.id, b.id))
    .map((s) => ({
      id: s.id,
      label: s.label?.trim() || 'Package',
      routeLabel: mapPending ? MAP_PENDING_TEXT : `${name(s.originBusinessId)} → ${name(s.destinationBusinessId)}`,
      statusLabel: statusLabelOf(sim.snapshot?.shipmentStatus?.[s.id]),
    }));
}

function focusOptions(map: MapResponse): SimReadyView['focusOptions'] {
  const sortOpts = (o: FocusOption[]) => o.sort((a, b) => byText(a.label, b.label) || byText(a.id, b.id));
  return {
    employees: sortOpts(map.employees.map((e) => ({ id: e.id, label: e.name || 'Employee' }))),
    businesses: sortOpts(map.businesses.map((b) => ({ id: b.id, label: b.name || 'Network business' }))),
  };
}

function inspectorPanel(selection: Exclude<Selection, null>, sim: SimulatorResponse, map: MapResponse): SimRightView {
  if (selection.kind === 'business') {
    const model = businessInspector(selection.id, sim, map);
    return model ? { kind: 'business', model } : { kind: 'missing', message: MISSING_BUSINESS_TEXT };
  }
  const model = employeeInspector(selection.id, sim, map);
  return model ? { kind: 'employee', model } : { kind: 'missing', message: MISSING_EMPLOYEE_TEXT };
}

function legendView(mode: 'network' | 'journey', selection: Selection, focus: Focus): SimLegendView {
  if (mode === 'journey') return { label: 'journey', mode: 'journey', hasSelection: false, focus: NO_FOCUS };
  const focused = focus.kind !== 'none';
  return { label: focused ? 'focus' : 'network', mode: 'network', hasSelection: selection !== null, focus };
}

// ---------- The view ----------
export function simPageView({ data, selection, focus = NO_FOCUS, layers }: SimPageInput): SimPageView {
  const { reconnecting } = data;
  if (data.view === 'unavailable') {
    return { view: 'unavailable', message: data.unavailable?.message || 'The simulator is unavailable.', reconnecting };
  }
  if (data.view === 'error') return { view: 'error', message: data.error || 'Request failed', reconnecting };
  if (data.view === 'loading' || !data.sim) return { view: 'loading', reconnecting };

  const sim = data.sim;
  const mapPending = data.map === null;
  const map = data.map ?? emptyMap(sim.runId);

  const packages = packageRows(sim, map, mapPending);
  const base = {
    view: 'ready' as const,
    reconnecting,
    mapPending,
    packages,
    packageList: mapPending ? { kind: 'pending' as const, items: packages } : { kind: 'panel' as const, sim, map },
    focusOptions: focusOptions(map),
    controls: { clock: sim.clock, busy: data.busy, simEndMin: SIM_END_MIN },
    actionError: data.actionError,
  };

  // Day or night and the badge's time, from the polled clock, the same in network and journey mode.
  const sky = { dayNight: dayNightAt(sim.clock.timeMin), clockText: dayNightClockText(sim.clock.timeMin) };

  const network = (sel: Selection): SimMapProps => {
    const v = buildNetworkView({ map, sim, selection: sel, focus });
    return {
      places: v.places, routes: v.routes, movers: v.movers, selectedIds: v.selectedIds, visible: layers, stops: [],
      fitTo: 'places', labelBusinesses: true, alwaysLabelIds: [], ...sky,
    };
  };

  // ---- Journey mode: a package is selected ----
  if (selection?.kind === 'package') {
    const shipmentId = selection.id;
    // Until the map arrives the journey cannot name its places; show the package as pending.
    const journey = mapPending ? null : buildJourney({ shipmentId, sim, map });
    const known = sim.shipments.some((s) => s.id === shipmentId);
    if (!journey) {
      const title = sim.shipments.find((s) => s.id === shipmentId)?.label?.trim() || 'Package';
      return {
        ...base,
        mode: 'journey',
        journeyTitle: known ? title : 'Unknown package',
        map: network(null),
        legend: legendView('network', null, focus),
        selectedPackageId: known ? shipmentId : undefined,
        right: known ? { kind: 'pending', message: MAP_PENDING_TEXT } : { kind: 'missing', message: MISSING_PACKAGE_TEXT },
      };
    }
    if (journey.kind === 'unmatched') {
      // No plan: the network map with the package selected highlights its two businesses, and the
      // camera fits them, as a matched journey fits its places.
      const shipment = sim.shipments.find((s) => s.id === shipmentId);
      const ends = map.businesses.filter((b) => b.id === shipment?.originBusinessId || b.id === shipment?.destinationBusinessId);
      const net = network(selection);
      const fit = boundsOf(ends.map((b) => [b.lng, b.lat] as [number, number]));
      return {
        ...base,
        mode: 'journey',
        journeyTitle: journey.title,
        map: fit ? { ...net, fitTo: fit } : net,
        legend: legendView('network', selection, focus),
        selectedPackageId: shipmentId,
        right: { kind: 'unmatched', journey },
      };
    }
    return {
      ...base,
      mode: 'journey',
      journeyTitle: journey.title,
      map: {
        places: journey.places,
        routes: journey.routes,
        movers: journey.movers,
        selectedIds: [],
        // The journey always shows its package, whatever the network's Packages toggle says.
        visible: { ...layers, packages: true },
        stops: journey.stops,
        fitTo: journey.bounds ?? 'places',
        labelBusinesses: false,
        alwaysLabelIds: journey.places.filter((p) => p.kind === 'business').map((p) => p.id),
        ...sky,
      },
      legend: legendView('journey', selection, focus),
      selectedPackageId: shipmentId,
      right: { kind: 'journey', journey },
    };
  }

  // ---- Network mode ----
  return {
    ...base,
    mode: 'network',
    journeyTitle: null,
    map: network(selection),
    legend: legendView('network', selection, focus),
    selectedPackageId: undefined,
    right: !selection
      ? { kind: 'summary', metrics: sim.snapshot.metrics }
      : mapPending ? { kind: 'pending', message: MAP_PENDING_TEXT } : inspectorPanel(selection, sim, map),
  };
}

// ---------- Direct-only vs relay comparison (page state, pure) ----------

/**
 * The comparison's local state. It is a read-only what-if (nothing is applied to the run), tagged
 * with the run it was asked for, so a result never outlives a new scenario.
 */
export type CompareState =
  | { status: 'idle' }
  | { status: 'loading'; runId: string }
  | { status: 'done'; runId: string; response: CompareResponse }
  | { status: 'error'; runId: string };

export const COMPARE_IDLE: CompareState = { status: 'idle' };

/** CompareSection's props from the page state. Disabled while another action keeps the hook busy. */
export type SimCompareView = { response: CompareResponse | null; loading: boolean; error: string | null; disabled: boolean };

export function compareView(state: CompareState, view: SimPageView, runId: string | null): SimCompareView {
  const busy = view.view === 'ready' && view.controls.busy;
  const current = state.status !== 'idle' && state.runId === runId ? state : COMPARE_IDLE;
  const loading = current.status === 'loading';
  return {
    response: current.status === 'done' ? current.response : null,
    loading,
    error: current.status === 'error' ? COMPARE_FAILED_TEXT : null,
    disabled: busy && !loading,
  };
}

// ---------- Interactions (pure, so tests can drive them) ----------

/**
 * The selection after a map click. In network mode: the clicked item's selection, or none for an
 * empty spot. In journey mode only another package opens (its journey); other clicks are ignored, so
 * a stray click on a stop marker or a route never drops the journey.
 */
export function selectionAfterMapClick(
  id: string | null, current: Selection, data: Pick<SimDataState, 'sim' | 'map'>,
): Selection {
  const inJourney = current?.kind === 'package';
  if (!data.sim || !data.map) return current;
  const next = id ? selectionFromMapId(id, data.map, data.sim) : null;
  if (inJourney) return next?.kind === 'package' ? next : current;
  return next;
}

/**
 * Where to pan when a journey step is clicked: the step's place. `seq` makes the key unique per
 * click, so the same step clicked twice pans twice. Null when the place has no coordinates.
 */
export function panTargetFor(view: SimPageView, placeId: string, seq: number): MapPanTarget | null {
  if (view.view !== 'ready' || view.right.kind !== 'journey') return null;
  const step = view.right.journey.steps.find((s) => s.placeId === placeId && s.lat !== null && s.lng !== null);
  if (!step || step.lat === null || step.lng === null) return null;
  return { lat: step.lat, lng: step.lng, key: `${placeId}#${seq}` };
}

/** `?package=<shipmentId>` opens that package's journey; anything else starts in network mode. */
export function initialSelectionFromSearch(search: string | URLSearchParams): Selection {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const id = params.get('package')?.trim();
  return id ? { kind: 'package', id } : null;
}
