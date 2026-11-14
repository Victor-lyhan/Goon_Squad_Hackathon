import { useId, useState } from 'react';
import type { DirectionFilter, StatusCount, StatusFilter } from './shipmentsTableModel';
import './businessWorkspace.css';

export type ShipmentsToolbarProps = {
  /**
   * Starting search text. The typed text is local state afterwards, so a poll never resets it
   * (DECISIONS pass 43). To clear it on purpose ("Clear filters"), the page changes this component's `key`.
   */
  initialQuery?: string;
  onQueryChange: (query: string) => void;
  direction: DirectionFilter;
  onDirectionChange: (direction: DirectionFilter) => void;
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  /** From statusCounts(rows). */
  counts: StatusCount[];
  /** Total rows before filtering (for the "All statuses" option). */
  total: number;
  onNewDelivery: () => void;
  /** Disable the New delivery action (e.g. playback is locked). */
  newDeliveryDisabled?: boolean;
};

const DIRECTIONS: { value: DirectionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'outgoing', label: 'Outgoing' },
  { value: 'incoming', label: 'Incoming' },
];

export function ShipmentsToolbar(props: ShipmentsToolbarProps) {
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const searchId = useId();
  const statusId = useId();
  const directionLabelId = useId();
  // Only list statuses that exist, plus the selected one (so the select never loses its value).
  const options = props.counts.filter((c) => c.count > 0 || c.status === props.status);
  // Option values are positions, so internal enum names (e.g. at_hub) never reach the DOM.
  const selectedIndex = options.findIndex((c) => c.status === props.status);
  const selectValue = props.status === 'all' || selectedIndex === -1 ? 'all' : String(selectedIndex);

  return (
    <div className="bw-toolbar" role="search" aria-label="Shipments">
      <div className="bw-toolbar__field bw-toolbar__search">
        <label htmlFor={searchId} className="bw-toolbar__label">Search</label>
        <input
          id={searchId}
          type="search"
          className="bw-input"
          placeholder="Package, ID, business or relay point"
          value={query}
          onChange={(e) => { setQuery(e.target.value); props.onQueryChange(e.target.value); }}
          autoComplete="off"
        />
      </div>
      <div className="bw-toolbar__field">
        <span id={directionLabelId} className="bw-toolbar__label">Direction</span>
        <div className="bw-segmented" role="group" aria-labelledby={directionLabelId}>
          {DIRECTIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              className="bw-segmented__btn"
              aria-pressed={props.direction === d.value}
              onClick={() => props.onDirectionChange(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="bw-toolbar__field">
        <label htmlFor={statusId} className="bw-toolbar__label">Status</label>
        <select
          id={statusId}
          className="bw-input"
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            props.onStatusChange(v === 'all' ? 'all' : options[Number(v)]?.status ?? 'all');
          }}
        >
          <option value="all">All statuses ({props.total})</option>
          {options.map((c, i) => (
            <option key={c.status} value={String(i)}>{c.label} ({c.count})</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="bw-btn bw-btn--primary bw-toolbar__new"
        onClick={props.onNewDelivery}
        disabled={props.newDeliveryDisabled}
      >
        New delivery
      </button>
    </div>
  );
}
