import { useMemo } from 'react';
import type { Employee, Hub, Shipment, SimEvent } from '../../../shared/types';
import { toTimelineRows } from './sim/timelineModel';
import './sim/Timeline.css';

export type TimelineProps = {
  events: SimEvent[];
  timeMin: number;
  shipments: Shipment[];
  employees: Employee[];
  hubs: Hub[];
};

export default function Timeline({ events, timeMin, shipments, employees, hubs }: TimelineProps) {
  const rows = useMemo(
    () => toTimelineRows(events, timeMin, shipments, employees, hubs),
    [events, timeMin, shipments, employees, hubs],
  );
  if (rows.length === 0) return <div className="tl tl-empty">No deliveries scheduled yet</div>;
  return (
    <section className="tl" aria-label="Event timeline">
      <ul className="tl-list">
        {rows.map((r) => (
          <li key={r.id} className={`tl-row tl-${r.state}`} aria-current={r.state === 'next' ? 'step' : undefined}>
            <span className="tl-time">{r.timeLabel}</span>
            <span className="tl-text">{r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
