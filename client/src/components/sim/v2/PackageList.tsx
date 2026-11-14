export type PackageListItem = { id: string; label: string; statusLabel: string; routeLabel: string };

export type PackageListProps = {
  items: PackageListItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
};

/** The left panel's package list. Renders what it is given; derives nothing. */
export function PackageList({ items, selectedId, onSelect }: PackageListProps) {
  if (items.length === 0) {
    return <p className="sw-empty">No packages in this run yet.</p>;
  }
  return (
    <ul className="sw-pkgs" aria-label="Packages">
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
                <span className="sw-pkg-label">{p.label}</span>
                <span className="sw-pkg-status sw-mono">{p.statusLabel}</span>
              </span>
              <span className="sw-pkg-route">{p.routeLabel}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
