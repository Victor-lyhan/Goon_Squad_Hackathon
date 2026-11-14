import { useMemo } from 'react';
import type { Metrics } from '../../../../shared/types';
import { toMetricCards, type MetricCard } from './metricsModel';
import './MetricsCards.css';

export type MetricsCardsProps = { metrics: Metrics };

function Group({ title, cards }: { title: string; cards: MetricCard[] }) {
  return (
    <section className="mc-group" aria-label={title}>
      <h3 className="mc-title">{title}</h3>
      <div className="mc-grid">
        {cards.map((c) => (
          <div key={c.key} className={`mc-card mc-${c.kind}`} data-testid={`metric-${c.key}`}>
            <div className="mc-label">{c.label}</div>
            <div className="mc-value">{c.value}</div>
            <div className="mc-caption">{c.caption}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MetricsCards({ metrics }: MetricsCardsProps) {
  const cards = useMemo(() => toMetricCards(metrics), [metrics]);
  return (
    <div className="mc" aria-label="Metrics">
      <Group title="Projected" cards={cards.filter((c) => c.kind === 'projected')} />
      <Group title="So far" cards={cards.filter((c) => c.kind === 'actual')} />
    </div>
  );
}
