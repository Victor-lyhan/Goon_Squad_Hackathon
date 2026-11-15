import type { CommuteSummaryModel } from './employeeWorkspaceModel';

export type CommuteSummaryProps = {
  model: CommuteSummaryModel;
  /** Edit commute action; hidden when absent. */
  onEdit?: () => void;
  /** Disables the edit action (locked run). */
  editDisabled?: boolean;
};

/**
 * The saved commute. Each trip is a route strip (issue 957): the place it leaves from on the left, the
 * place it arrives at on the right, and a line between the two stations. The workplace is the filled
 * station and home the open one, so the evening and the morning strip read as the same line travelled
 * both ways. Renders the model; derives nothing.
 */
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
      <ul className="ew-trips" aria-label="Commute trips">
        {model.trips.map((t) => {
          const evening = t.direction === 'evening';
          return (
            <li key={t.direction} className={`ew-trip${t.available ? '' : ' is-off'}`}>
              <span className="ew-trip-label">{t.label}</span>
              {t.available ? (
                <span className="ew-trip-data">
                  <span className="ew-mono">Departs {t.departure}</span>
                  <span className="ew-mono">{t.duration}</span>
                  <span className="ew-trip-distance">{t.distance}</span>
                </span>
              ) : (
                <span className="ew-trip-data ew-muted">{t.unavailableText}</span>
              )}
              <span className="ew-trip-route">
                <span className={`ew-station ${evening ? 'is-work' : 'is-home'}`}>{t.from}</span>
                <span className="ew-sr"> to </span>
                <span className={`ew-station ${evening ? 'is-home' : 'is-work'}`}>{t.to}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="ew-commute-facts">
        <p className="ew-workplace">
          <span className="ew-fact-label">Workplace</span>{' '}
          <span className="ew-strong">{model.workplaceName}</span>
          {model.workplaceNeighborhood && <span>, {model.workplaceNeighborhood}</span>}
          {model.workplaceAddress && <span className="ew-muted ew-address">{model.workplaceAddress}</span>}
        </p>
        <p className="ew-detour">
          <span className="ew-fact-label">Detour limit</span> <span className="ew-mono">{model.detourLimit}</span>
        </p>
      </div>
    </section>
  );
}
