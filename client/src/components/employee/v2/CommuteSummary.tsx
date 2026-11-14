import type { CommuteSummaryModel } from './employeeWorkspaceModel';

export type CommuteSummaryProps = {
  model: CommuteSummaryModel;
  /** Edit commute action; hidden when absent. */
  onEdit?: () => void;
  /** Disables the edit action (locked run). */
  editDisabled?: boolean;
};

/** The saved commute: the first block of the Employee workspace. Renders the model; derives nothing. */
export function CommuteSummary({ model, onEdit, editDisabled }: CommuteSummaryProps) {
  return (
    <section className="ew-section ew-commute" aria-labelledby="ew-commute-heading">
      <div className="ew-section-head">
        <h2 id="ew-commute-heading">Saved commute</h2>
        {onEdit && (
          <button type="button" className="ew-btn" onClick={onEdit} disabled={editDisabled}>
            Edit commute
          </button>
        )}
      </div>
      <p className="ew-workplace">
        <span className="ew-strong">{model.workplaceName}</span>
        {model.workplaceNeighborhood && <span className="ew-muted"> · {model.workplaceNeighborhood}</span>}
        {model.workplaceAddress && <span className="ew-muted ew-address">{model.workplaceAddress}</span>}
      </p>
      <ul className="ew-trips" aria-label="Commute trips">
        {model.trips.map((t) => (
          <li key={t.direction} className={`ew-trip${t.available ? '' : ' is-off'}`}>
            <span className="ew-trip-label">{t.label}</span>
            <span className="ew-trip-route">
              {t.from} <span aria-hidden="true">→</span><span className="ew-sr"> to </span> {t.to}
            </span>
            {t.available ? (
              <span className="ew-trip-data">
                <span className="ew-mono">Departs {t.departure}</span>
                <span className="ew-mono">{t.duration}</span>
                <span className="ew-mono">{t.distance}</span>
              </span>
            ) : (
              <span className="ew-trip-data ew-muted">{t.unavailableText}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="ew-detour">
        <span className="ew-muted">Detour limit</span> <span className="ew-mono">{model.detourLimit}</span>
      </p>
    </section>
  );
}
