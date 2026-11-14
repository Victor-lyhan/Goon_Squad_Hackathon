import { formatCents } from '../../ui';

export function EarningsSummary({ earnedCents, projectedCents }: { earnedCents: number; projectedCents: number }) {
  return (
    <section className="earnings" aria-label="Earnings">
      <div className="earnings__item">
        <span className="earnings__label">Earned</span>
        <strong className="earnings__value">{formatCents(earnedCents)}</strong>
      </div>
      <div className="earnings__item">
        <span className="earnings__label">Projected</span>
        <strong className="earnings__value">{formatCents(projectedCents)}</strong>
      </div>
    </section>
  );
}
