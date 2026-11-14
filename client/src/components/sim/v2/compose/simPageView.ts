// First cut of the MVP II simulator page (#426): one pure function turns the data hook's state plus
// the page's local UI state (selection, focus, layers) into everything the page shows.
// No React, no DOM, tested in Node.
//
// It only reshapes the polled responses through the merged models (buildNetworkView, buildJourney).
// Statuses, metrics, times and positions are read from the response, never computed (AGENTS.md).
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import { GenerateScenarioRequest } from '../../../../../../shared/v2/schemas';
import type { Clock, Metrics } from '../../../../../../shared/v2/types';
import type { LatLngBounds, MapMover, MapPanTarget, MapPlace, MapRoute, MapStop } from '../../../map/types';
import type { PackageListItem } from '../PackageList';
import type { FocusOption } from '../FocusSelector';
import { NO_FOCUS, type Focus, type LayerVisibility } from '../workspaceModel';
import { CONNECTION_LOST_MESSAGE, type SimDataState } from '../live/simDataModel';
import { buildNetworkView } from '../network/networkModel';
import { selectionFromMapId, type Selection } from '../network/selectionModel';
import { UNKNOWN_PLACE, buildJourney, statusLabelOf, type Journey, type UnmatchedJourney } from '../journey/journeyModel';

// ---------- Copy ----------
export const LOADING_TEXT = 'Loading the simulator…';
export const RECONNECTING_TEXT = CONNECTION_LOST_MESSAGE;
export const MAP_PENDING_TEXT = 'Loading places…';
export const MISSING_PACKAGE_TEXT = 'This package is not in the current scenario';
export const MISSING_BUSINESS_TEXT = 'This business is not in the current scenario';
export const MISSING_EMPLOYEE_TEXT = 'This employee is not in the current scenario';
export const BACK_TO_NETWORK = 'Back to network';

/**
 * SimulatorResponse carries no settings, so the scrubber uses the planning window every scenario
 * uses today: Day 1 15:30 to Day 2 12:00 (Settings.simStartMin / simEndMin defaults).
 */
export const SIM_WINDOW = { simStartMin: 930, simEndMin: 2160 } as const;

/**
 * The scenario form's starting values: the schema's defaults for the demo preset. SimulatorResponse
 * does not say which preset or seed built the run, so the form starts from the defaults.
 */
export const DEFAULT_SCENARIO: GenerateScenarioRequest = GenerateScenarioRequest.parse({ preset: 'demo' });

// ---------- Output types ----------
export type SimMapProps = {
  places: MapPlace[];
  routes: MapRoute[];
  movers: MapMover[];
  visible: LayerVisibility;
  selectedIds: string[];
  stops: MapStop[];
  fitTo: 'places' | LatLngBounds;
};

export type SimControlsView = {
  clock: Clock;
  nextEventMin: number | null;
  busy: boolean;
  simStartMin: number;
  simEndMin: number;
  scenario: GenerateScenarioRequest;
};

/** Right panel content. */
export type SimRightView =
  | { kind: 'summary'; metrics: Metrics }
  | { kind: 'entity'; entity: 'business' | 'employee'; name: string; role: string }
  | { kind: 'missing'; message: string }
  /** The map response for this run has not arrived yet; the selection is shown once it does. */
  | { kind: 'pending'; message: string }
  | { kind: 'journey'; journey: Journey }
  | { kind: 'unmatched'; journey: UnmatchedJourney };

export type SimReadyView = {
  view: 'ready';
  reconnecting: boolean;
  mode: 'network' | 'journey';
  /** The map response has not arrived yet for this run (it follows the first poll). */
  mapPending: boolean;
  /** Title shown with "Back to network" at the top of the left panel; null in network mode. */
  journeyTitle: string | null;
  map: SimMapProps;
  packages: PackageListItem[];
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

function entityPanel(selection: Exclude<Selection, null>, map: MapResponse): SimRightView {
  if (selection.kind === 'business') {
    const b = map.businesses.find((x) => x.id === selection.id);
    if (!b) return { kind: 'missing', message: MISSING_BUSINESS_TEXT };
    const where = [b.neighborhood, b.borough].filter(Boolean).join(', ');
    return { kind: 'entity', entity: 'business', name: b.name || 'Network business', role: where ? `Network business · ${where}` : 'Network business' };
  }
  const e = map.employees.find((x) => x.id === selection.id);
  if (!e) return { kind: 'missing', message: MISSING_EMPLOYEE_TEXT };
  const employer = map.businesses.find((b) => b.id === e.businessId)?.name;
  return { kind: 'entity', entity: 'employee', name: e.name || 'Employee', role: employer ? `Commuter · works at ${employer}` : 'Commuter' };
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

  const base = {
    view: 'ready' as const,
    reconnecting,
    mapPending,
    packages: packageRows(sim, map, mapPending),
    focusOptions: focusOptions(map),
    controls: {
      clock: sim.clock,
      nextEventMin: sim.nextEventMin,
      busy: data.busy,
      ...SIM_WINDOW,
      scenario: DEFAULT_SCENARIO,
    },
    actionError: data.actionError,
  };

  const network = (sel: Selection): SimMapProps => {
    const v = buildNetworkView({ map, sim, selection: sel, focus });
    return { places: v.places, routes: v.routes, movers: v.movers, selectedIds: v.selectedIds, visible: layers, stops: [], fitTo: 'places' };
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
        selectedPackageId: known ? shipmentId : undefined,
        right: known ? { kind: 'pending', message: MAP_PENDING_TEXT } : { kind: 'missing', message: MISSING_PACKAGE_TEXT },
      };
    }
    if (journey.kind === 'unmatched') {
      // No plan: the network map with the package selected highlights its two businesses.
      return {
        ...base,
        mode: 'journey',
        journeyTitle: journey.title,
        map: network(selection),
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
        visible: layers,
        stops: journey.stops,
        fitTo: journey.bounds ?? 'places',
      },
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
    selectedPackageId: undefined,
    right: !selection
      ? { kind: 'summary', metrics: sim.snapshot.metrics }
      : mapPending ? { kind: 'pending', message: MAP_PENDING_TEXT } : entityPanel(selection, map),
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
