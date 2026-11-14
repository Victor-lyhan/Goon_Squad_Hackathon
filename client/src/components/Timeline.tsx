import { useEffect, useMemo, useRef, useState } from 'react';
import type { Employee, Hub, Shipment, SimEvent } from '../../../shared/types';
import type { SimControlRequest } from '../../../shared/schemas';
import { formatMin } from '../ui/format';
import {
  DEFAULT_SCRUB_WINDOW, clampSeek, createFrameSeeker, scrubKeyTarget,
  toScrubLabels, toScrubTicks, toTimelineRows, type ScrubWindow,
} from './sim/timelineModel';
import './sim/Timeline.css';

export type TimelineProps = {
  events: SimEvent[];
  timeMin: number;
  shipments: Shipment[];
  employees: Employee[];
  hubs: Hub[];
  /** Optional: all known events for tick marks (defaults to `events`). */
  allEvents?: SimEvent[];
  /** Optional: sim window (defaults to Day 1 15:30 – Day 2 12:00). */
  settings?: ScrubWindow;
  /** Optional: when given, the scrubber is shown and sends `seek` controls through it. */
  onControl?: (req: SimControlRequest) => void;
  busy?: boolean;
};

function Scrubber({ events, timeMin, shipments, settings, onControl, busy }: {
  events: SimEvent[]; timeMin: number; shipments: Shipment[]; settings: ScrubWindow;
  onControl: (req: SimControlRequest) => void; busy: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const sendRef = useRef(onControl);
  sendRef.current = onControl;
  const seeker = useMemo(() => createFrameSeeker(
    (t) => sendRef.current({ action: 'seek', timeMin: t }),
    (cb) => requestAnimationFrame(cb), (id) => cancelAnimationFrame(id),
  ), []);
  useEffect(() => () => seeker.cancel(), [seeker]);
  const ticks = useMemo(() => toScrubTicks(events, shipments, settings), [events, shipments, settings]);
  const labels = useMemo(() => toScrubLabels(events, settings), [events, settings]);
  const shown = clampSeek(draft ?? timeMin, settings);
  const seekNow = (t: number) => { setDraft(null); seeker.now(t); };
  return (
    <div className="tl-scrub">
      <div className="tl-ticks" role="group" aria-label="Event markers">
        {ticks.map((t) => (
          <button key={t.timeMin} type="button" className="tl-tick" style={{ left: `${t.pct}%` }}
            title={t.title} aria-label={t.title} disabled={busy} onClick={() => seekNow(t.timeMin)}>
            {t.count > 1 ? <span className="tl-tick-n">{t.count}</span> : null}
          </button>
        ))}
      </div>
      <input type="range" className="tl-slider" aria-label="Timeline scrubber"
        min={settings.simStartMin} max={settings.simEndMin} step={1} value={shown}
        aria-valuetext={formatMin(shown)} disabled={busy}
        onChange={(e) => {
          const t = clampSeek(Number(e.target.value), settings);
          setDraft(t);
          seeker.push(t);
        }}
        onPointerUp={() => setDraft(null)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          const t = scrubKeyTarget(e.key, shown, settings, e);
          if (t === null) {
            // Home/End/arrows at an edge, or a non-scrub key: swallow scrub keys so the native 1-min step never fires.
            if (['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) e.preventDefault();
            return;
          }
          e.preventDefault();
          seekNow(t);
        }} />
      <div className="tl-labels" aria-hidden="true">
        {labels.map((l) => (
          <span key={`${l.kind}-${l.text}`} className={`tl-label tl-label-${l.kind}`}
            style={{ left: `${l.pct}%` }}>{l.text}</span>
        ))}
      </div>
    </div>
  );
}

export default function Timeline({
  events, timeMin, shipments, employees, hubs, allEvents, settings = DEFAULT_SCRUB_WINDOW, onControl, busy = false,
}: TimelineProps) {
  const rows = useMemo(
    () => toTimelineRows(events, timeMin, shipments, employees, hubs),
    [events, timeMin, shipments, employees, hubs],
  );
  const scrubber = onControl
    ? <Scrubber events={allEvents ?? events} timeMin={timeMin} shipments={shipments} settings={settings}
        onControl={onControl} busy={busy} />
    : null;
  if (rows.length === 0 && !scrubber) return <div className="tl tl-empty">No deliveries scheduled yet</div>;
  return (
    <section className="tl" aria-label="Event timeline">
      {scrubber}
      {rows.length === 0 ? <div className="tl-empty">No deliveries scheduled yet</div> : (
        <ul className="tl-list">
          {rows.map((r) => (
            <li key={r.id} className={`tl-row tl-${r.state}`} aria-current={r.state === 'next' ? 'step' : undefined}>
              <span className="tl-time">{r.timeLabel}</span>
              <span className="tl-text">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
