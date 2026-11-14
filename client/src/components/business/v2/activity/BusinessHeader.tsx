import type { BusinessDashboard } from '../../../../../../shared/v2/api';
import { headerModel, type HeaderModel } from './activityModel';
import './activity.css';

type Props = { dashboard: BusinessDashboard };

/** Who this business is and the server's totals, as one compact strip. Props only. */
export function BusinessHeader({ dashboard }: Props) {
  return <BusinessHeaderView model={headerModel(dashboard)} />;
}

export function BusinessHeaderView({ model: m }: { model: HeaderModel }) {
  return (
    <header className="ba-header" aria-label={`${m.name}, ${m.role}`}>
      <div className="ba-header__who">
        <h1 className="ba-header__name">{m.name}</h1>
        <span className="ba-header__id">{m.id}</span>
      </div>
      <p className="ba-header__place">
        <span>{m.address}</span>
        {m.area && <span className="ba-header__area">{m.area}</span>}
      </p>
      <p className="ba-header__meta">
        <span className="ba-header__role">{m.role}</span>
        <span className="ba-header__phase" title={m.phaseText}>
          <span className="ba-header__phase-label">{m.phaseLabel}</span>
          <span className="ba-header__phase-text">{m.phaseText}</span>
        </span>
      </p>
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
