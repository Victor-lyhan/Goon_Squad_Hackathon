import type { BusinessDashboard } from '../../../../../../shared/v2/api';
import { headerModel, type HeaderModel } from './activityModel';
import './activity.css';

type Props = { dashboard: BusinessDashboard };

/** Who this business is and the server's totals, as one compact strip. Props only. */
export function BusinessHeader({ dashboard }: Props) {
  return <BusinessHeaderView model={headerModel(dashboard)} />;
}

/**
 * One hierarchy (#892): the name is the page's heading and the only strong text. Under it, in reading
 * order: where the business is, whether deliveries can be added now, and what "relay point" means here.
 * The totals sit beside that block when there is room and under it when there is not.
 */
export function BusinessHeaderView({ model: m }: { model: HeaderModel }) {
  return (
    <header className="ba-header">
      <div className="ba-header__main">
        <div className="ba-header__who">
          <h1 className="ba-header__name">{m.name}</h1>
          <span className="ba-header__id">{m.id}</span>
        </div>
        <p className="ba-header__place">
          <span>{m.address}</span>
          {m.area && <span className="ba-header__area">{m.area}</span>}
        </p>
        <p className="ba-header__phase">
          <span className="ba-header__phase-label">{m.phaseLabel}</span>
          <span className="ba-header__phase-text">{m.phaseText}</span>
        </p>
        <p className="ba-header__role">{m.role}</p>
      </div>
      <dl className="ba-totals" aria-label={`Totals: ${m.totalsLine}`}>
        {m.totals.map((t) => (
          <div key={t.key} className="ba-totals__item">
            <dt className="ba-totals__label">{t.label}</dt>
            <dd className="ba-totals__value">{t.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
