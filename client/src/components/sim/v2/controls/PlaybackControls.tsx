import { useId, useState } from 'react';
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import type { Clock } from '../../../../../../shared/v2/types';
import {
  SCRUB_IDLE, SPEED_OPTIONS, formatScrub, playbackRequest, scrubDrag, scrubRelease, scrubShown, speedRequest,
  toPlaybackView, type PlaybackAction, type ScrubState,
} from './controlsModel';
import './controls.css';

export type PlaybackControlsProps = {
  clock: Clock;
  simStartMin: number;
  simEndMin: number;
  nextEventMin: number | null;
  busy?: boolean;
  onControl(req: SimControlRequest): void;
};

const STEP_BUTTONS: { action: PlaybackAction; key: 'nextEvent' | 'jumpToMorning' | 'finish' | 'reset'; label: string }[] = [
  { action: 'nextEvent', key: 'nextEvent', label: 'Next event' },
  { action: 'jumpToMorning', key: 'jumpToMorning', label: 'Jump to morning' },
  { action: 'finish', key: 'finish', label: 'Finish' },
  { action: 'reset', key: 'reset', label: 'Reset playback' },
];

/** Playback block for the simulator's left panel. Every control sends exactly one SimControlRequest. */
export function PlaybackControls({ clock, simStartMin, simEndMin, nextEventMin, busy = false, onControl }: PlaybackControlsProps) {
  const w = { simStartMin, simEndMin };
  const v = toPlaybackView(clock, w, nextEventMin, busy);
  const id = useId();
  const scrubId = `${id}-scrub`;
  const reasonsId = `${id}-reasons`;
  // The drag value lives here, so a 1 s poll never moves the thumb mid-drag (DECISIONS pass 43).
  const [scrub, setScrub] = useState<ScrubState>(SCRUB_IDLE);
  const shown = scrubShown(scrub, clock, w);
  const release = () => {
    const r = scrubRelease(scrub, clock, w);
    if (r.state !== scrub) setScrub(r.state);
    if (r.request) onControl(r.request);
  };
  const describedBy = (reason: string | undefined) => (reason ? reasonsId : undefined);

  return (
    <div className="ctl-block ctl-playback">
      <div className="ctl-row">
        <button type="button" className="ctl-btn ctl-primary" title={v.disabled.play ?? v.playTitle}
          aria-describedby={describedBy(v.disabled.play)} disabled={!!v.disabled.play}
          onClick={() => onControl(playbackRequest('playPause', clock))}>
          {v.playLabel}
        </button>
        <div className="ctl-seg" role="group" aria-label="Playback speed">
          {SPEED_OPTIONS.map((o) => (
            <button key={o.speed} type="button" className="ctl-btn ctl-seg-btn" title={o.title}
              aria-label={`Speed ${o.label}: ${o.title}`} aria-pressed={v.speed === o.speed}
              aria-describedby={describedBy(v.disabled.speed)} disabled={!!v.disabled.speed}
              onClick={() => onControl(speedRequest(o.speed))}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ctl-field">
        <div className="ctl-label-row">
          <label htmlFor={scrubId}>Simulation time</label>
          <output className="ctl-mono" htmlFor={scrubId} aria-live="off">{formatScrub(shown)}</output>
        </div>
        <input id={scrubId} type="range" className="ctl-range" min={simStartMin} max={simEndMin} step={1} value={shown}
          aria-valuetext={formatScrub(shown)} aria-describedby={describedBy(v.disabled.scrub)} disabled={!!v.disabled.scrub}
          onChange={(e) => setScrub(scrubDrag(e.target.value, w))}
          onPointerUp={release}
          onKeyUp={(e) => { if (e.key !== 'Tab' && e.key !== 'Shift') release(); }}
          onBlur={release} />
        <div className="ctl-range-ends ctl-mono" aria-hidden="true">
          <span>{formatScrub(simStartMin)}</span><span>{formatScrub(simEndMin)}</span>
        </div>
      </div>

      <div className="ctl-grid">
        {STEP_BUTTONS.map((b) => {
          const reason = v.disabled[b.key];
          return (
            <button key={b.key} type="button" className="ctl-btn" title={reason} aria-describedby={describedBy(reason)}
              disabled={!!reason} onClick={() => onControl(playbackRequest(b.action, clock))}>
              {b.label}
            </button>
          );
        })}
      </div>

      {v.reasons.length > 0 && (
        <ul className="ctl-notes" id={reasonsId} role="status">
          {v.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}
