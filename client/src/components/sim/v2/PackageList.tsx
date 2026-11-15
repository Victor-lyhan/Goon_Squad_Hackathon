import { useId, useState } from 'react';
import { DetailsToggle } from './Details';

export type PackageListItem = { id: string; label: string; statusLabel: string; routeLabel: string };

export type PackageListProps = {
  items: PackageListItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
};

export type PackageListViewProps = PackageListProps & {
  detailsOpen: boolean;
  onToggleDetails: () => void;
  /** The id of the list, which the Details toggle controls. */
  listId?: string;
};

/**
 * The left panel's package list. Renders what it is given; derives nothing. One line per package
 * (#832): name and status. The route line of every row is under the one "Details" toggle above the
 * list (a row is a button, so it cannot hold a button of its own); closed by default. The open state
 * is local, so a 1 s poll never closes it.
 */
export function PackageList(props: PackageListProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return <PackageListView {...props} detailsOpen={open} onToggleDetails={() => setOpen((o) => !o)} listId={listId} />;
}

/** The empty list (#883): what is missing, and where a package comes from. */
export const NO_PACKAGES_TEXT = 'No packages in this run yet. Send one from the Business page.';

/** The stateless render: tests call it as a function. */
export function PackageListView({ items, selectedId, onSelect, detailsOpen: open, onToggleDetails, listId = 'sw-pkgs' }: PackageListViewProps) {
  if (items.length === 0) {
    return <p className="sw-empty">{NO_PACKAGES_TEXT}</p>;
  }
  return (
    <>
      <DetailsToggle open={open} onToggle={onToggleDetails} controls={listId} about="packages" />
      <ul id={listId} className="sw-pkgs" aria-label="Packages">
        {items.map((p) => {
          const selected = p.id === selectedId;
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`sw-pkg${selected ? ' is-selected' : ''}`}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(p.id)}
              >
                <span className="sw-pkg-top">
                  <span className="sw-pkg-label" title={p.label}>{p.label}</span>
                  <span className="sw-pkg-status">{p.statusLabel}</span>
                </span>
                <span className="sw-pkg-route" data-details-body="" hidden={!open}>{p.routeLabel}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
