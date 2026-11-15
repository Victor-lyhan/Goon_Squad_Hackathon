import { useMemo, useState } from 'react';
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import { PackageList } from '../PackageList';
import { PackageFilterBar } from './PackageFilterBar';
import {
  buildPackageRows, filterPackageRows, NO_FILTERS, statusFilters, toListItems, type StatusFilter,
} from './packageListModel';
import './packages.css';

export type PackagePanelProps = {
  sim: SimulatorResponse;
  map: MapResponse;
  selectedId?: string;
  onSelect: (shipmentId: string) => void;
};

/**
 * The left panel's package list with search and status filters. The filter state is local, so a
 * 1 s poll (new `sim` object) never resets the search text or the chosen filter (DECISIONS pass 43).
 */
export function PackagePanel({ sim, map, selectedId, onSelect }: PackagePanelProps) {
  const [query, setQuery] = useState(NO_FILTERS.query);
  const [status, setStatus] = useState<StatusFilter>(NO_FILTERS.status);

  const rows = useMemo(() => buildPackageRows(sim, map), [sim, map]);
  const options = statusFilters(rows, status);
  const shown = filterPackageRows(rows, { status, query });
  const filtered = status !== NO_FILTERS.status || query.trim() !== '';
  const clear = () => { setQuery(NO_FILTERS.query); setStatus(NO_FILTERS.status); };

  return (
    <div className="pk-panel">
      {rows.length > 0 && (
        <PackageFilterBar
          query={query}
          onQueryChange={setQuery}
          status={status}
          onStatusChange={setStatus}
          options={options}
        />
      )}
      {rows.length > 0 && (
        <p className="pk-total sw-mono" aria-live="polite">{shown.length} of {rows.length} packages</p>
      )}
      {rows.length > 0 && shown.length === 0 ? (
        <div className="pk-empty">
          <p>No packages match these filters.</p>
          <button type="button" className="sw-btn" onClick={clear}>Clear filters</button>
        </div>
      ) : (
        <PackageList items={toListItems(shown)} selectedId={selectedId} onSelect={onSelect} />
      )}
      {filtered && shown.length > 0 && (
        <button type="button" className="pk-clear" onClick={clear}>Clear filters</button>
      )}
    </div>
  );
}
