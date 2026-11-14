import { useMemo } from 'react';
import type { Metrics } from '../../../../shared/types';
import { toMetricCards, type MetricCard } from './metricsModel';
import './MetricsCards.css';

export type MetricsCardsProps = { metrics: Metrics };

export function MetricsCards({ metrics }: MetricsCardsProps) {
  const cards = useMemo(() => toMetricCards(metrics), [metrics]);
  return (
    <div className="mc" aria-label="Metrics">
      <div className="mc-grid">
        {cards.map((c: MetricCard) => (
          <div key={c.key} className={`mc-card mc-${c.kind}`} data-testid={`metric-${c.key}`}>
            <div className="mc-label">{c.label}</div>
            <div className="mc-value">{c.value}</div>
            <div className="mc-caption">{c.caption}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
