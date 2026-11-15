import { useId } from 'react';
import type { StatusFilter, StatusFilterOption } from './packageListModel';
import './packages.css';

export type PackageFilterBarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  /** From statusFilters(rows, status). */
  options: StatusFilterOption[];
};

/**
 * A status chip's name for a screen reader (#883): "Delivered, 12 packages", not the bare "Delivered 12".
 * It starts with the visible word, so speech control ("click Delivered") still finds it.
 */
export function statusChipName(label: string, count: number): string {
  return `${label}, ${count} ${count === 1 ? 'package' : 'packages'}`;
}

/** Search box plus the status filter as a labelled button group. Controlled: the panel owns the state. */
export function PackageFilterBar({ query, onQueryChange, status, onStatusChange, options }: PackageFilterBarProps) {
  const searchId = useId();
  const groupLabelId = useId();
  return (
    <div className="pk-filters">
      <div className="pk-search">
        <label htmlFor={searchId}>Search packages</label>
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder="Name or business"
          autoComplete="off"
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>
      <span id={groupLabelId} className="pk-group-label">Status</span>
      <div className="pk-status" role="group" aria-labelledby={groupLabelId}>
        {options.map((o) => {
          const pressed = o.value === status;
          return (
            <button
              key={o.value}
              type="button"
              className={`pk-chip${pressed ? ' is-pressed' : ''}`}
              aria-pressed={pressed}
              aria-label={statusChipName(o.label, o.count)}
              onClick={() => onStatusChange(o.value)}
            >
              <span>{o.label}</span>
              <span className="pk-count">{o.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
