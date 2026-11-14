import { useState } from 'react';
import type { Clock, Settings } from '../../../../shared/types';
import type { SimControlRequest } from '../../../../shared/schemas';
import { formatMin } from '../../ui/format';
import { SPEEDS, clampScrub, toPlaybackModel } from './playbackModel';
import './PlaybackBar.css';

export type PlaybackBarProps = {
  clock: Clock;
  nextEventMin: number | null;
  settings: Pick<Settings, 'simStartMin' | 'simEndMin'>;
  busy?: boolean;
  onControl: (req: SimControlRequest) => void;
};

export function PlaybackBar({ clock, nextEventMin, settings, busy = false, onControl }: PlaybackBarProps) {
  const m = toPlaybackModel(clock, nextEventMin, settings, busy);
  // Local value while dragging; one seek is sent on release / key press, not per pixel.
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? clampScrub(clock.timeMin, settings);
  const commit = () => {
    if (draft === null) return;
    const t = clampScrub(draft, settings);
    setDraft(null);
    if (t !== clock.timeMin) onControl({ action: 'seek', timeMin: t });
  };
  return (
    <div className="playback-bar" role="toolbar" aria-label="Simulation playback">
      <span className="pb-time" aria-live="off">{draft === null ? m.timeLabel : formatMin(shown)}</span>
      <input type="range" className="pb-scrub" aria-label="Simulation time"
        min={settings.simStartMin} max={settings.simEndMin} step={1} value={shown}
        aria-valuetext={formatMin(shown)} disabled={busy}
        onChange={(e) => setDraft(clampScrub(Number(e.target.value), settings))}
        onPointerUp={commit}
        onKeyUp={(e) => { if (e.key !== 'Tab' && e.key !== 'Shift') commit(); }} />
      <button type="button" className="pb-btn pb-primary" aria-label={m.playLabel === 'Play' ? 'Play simulation' : 'Pause simulation'}
        disabled={m.disabled.play} onClick={() => onControl({ action: clock.playing ? 'pause' : 'play' })}>
        {m.playLabel}
      </button>
      <div className="pb-speed" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" className="pb-btn" aria-label={`Speed ${s} times`} aria-pressed={m.speed === s}
            disabled={m.disabled.speed} onClick={() => onControl({ action: 'speed', speed: s })}>
            {s}×
          </button>
        ))}
      </div>
      <button type="button" className="pb-btn" aria-label="Jump to next event" disabled={m.disabled.nextEvent}
        onClick={() => onControl({ action: 'next_event' })}>Next event</button>
      <button type="button" className="pb-btn" aria-label="Jump to morning" disabled={m.disabled.jumpToMorning}
        onClick={() => onControl({ action: 'jump_to_morning' })}>Jump to morning</button>
      <button type="button" className="pb-btn" aria-label="Finish simulation" disabled={m.disabled.finish}
        onClick={() => onControl({ action: 'finish' })}>Finish</button>
      <button type="button" className="pb-btn" aria-label="Reset playback" disabled={m.disabled.reset}
        onClick={() => onControl({ action: 'reset_playback' })}>Reset</button>
    </div>
  );
}
