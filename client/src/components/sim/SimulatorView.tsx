import type { Employee } from '../../../../shared/types';
import type { MapResponse, SimulatorResponse } from '../../../../shared/api';
import type { SimControlRequest } from '../../../../shared/schemas';
import { CityMap } from '../CityMap';
import Timeline from '../Timeline';
import { EmptyState, Spinner } from '../../ui';
import { MapMarkers } from './MapMarkers';
import { MetricsCards } from './MetricsCards';
import { PackageDetail } from './PackageDetail';
import { PackageQueue } from './PackageQueue';
import { PlaybackBar } from './PlaybackBar';
import { resolveSelection, selectedRoutes } from './simPageModel';
import './SimulatorPage.css';

export type SimulatorViewProps = {
  sim: SimulatorResponse | null;
  map: MapResponse | null;
  employees: Employee[];
  selectedId?: string;
  onSelect: (shipmentId: string) => void;
  onControl: (req: SimControlRequest) => void;
  busy?: boolean;
  error?: string | null;
};

// SimulatorResponse carries no settings; these are the contract defaults (Day 1 15:30 to Day 2 12:00).
const SIM_WINDOW = { simStartMin: 930, simEndMin: 2160 };

export function SimulatorView({ sim, map, employees, selectedId, onSelect, onControl, busy = false, error = null }: SimulatorViewProps) {
  const banner = error ? <div className="sp-error" role="alert">Connection problem: {error}. Showing the last good data.</div> : null;
  if (!sim || !map) {
    return (
      <div className="sp">
        {banner}
        {error ? <EmptyState title="Simulator unavailable" description="Could not load the simulator yet. Retrying every second." />
          : <div className="sp-loading"><Spinner label="Loading simulator" /></div>}
      </div>
    );
  }
  const selected = resolveSelection(selectedId, sim.shipments);
  const routes = selectedRoutes(sim, selected);
  return (
    <div className="sp">
      {banner}
      <PlaybackBar clock={sim.clock} nextEventMin={sim.nextEventMin} settings={SIM_WINDOW} busy={busy} onControl={onControl} />
      <div className="sp-main">
        <div className="sp-map">
          <CityMap graph={map.graph} businesses={map.businesses} hubs={map.hubs} homes={map.homes}
            highlightRoutes={routes.legs} baselineRoutes={routes.baselines}>
            <MapMarkers graph={map.graph} snapshot={sim.snapshot} clock={sim.clock} />
          </CityMap>
        </div>
        <aside className="sp-side">
          {sim.shipments.length === 0 ? (
            <EmptyState title="No packages in this run yet" description="Create shipments in the business portal." />
          ) : (
            <PackageQueue shipments={sim.shipments} plans={sim.plans} snapshot={sim.snapshot}
              businesses={map.businesses} selectedId={selected} onSelect={onSelect} />
          )}
          <PackageDetail sim={sim} businesses={map.businesses} hubs={map.hubs} employees={employees} selectedId={selected} />
        </aside>
      </div>
      <MetricsCards metrics={sim.snapshot.metrics} />
      <Timeline events={sim.snapshot.occurredEvents} timeMin={sim.snapshot.timeMin}
        shipments={sim.shipments} employees={employees} hubs={map.hubs} />
    </div>
  );
}
