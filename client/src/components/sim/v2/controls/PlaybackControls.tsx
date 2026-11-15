import { PAUSE_LABEL, RESET_LABEL, type PlayButtonView } from './controlsModel';
import './controls.css';

export type PlaybackControlsProps = {
  /** The one Play/Pause button, from `playButtonView` (compose/journeyPlay.ts). */
  button: PlayButtonView;
  /**
   * The step of a playing journey, for screen readers only (#852: nothing of it is shown on the map; the
   * side panel and the map symbols show it). An empty string keeps the live region in place.
   */
  status?: string;
  /** A journey step the simulator refused. */
  error?: string | null;
  /** Why "Back to start" is disabled, or null. */
  resetDisabled?: string | null;
  onToggle(): void;
  onReset(): void;
};

/** One playback block per page, so fixed IDs for the two notes (and no hook: tests call it as a function). */
export const PLAY_NOTE_ID = 'ctl-play-note';
export const RESET_NOTE_ID = 'ctl-reset-note';

/** 16 px, drawn in the label's colour; the label next to it is the button's name. */
function Icon({ d }: { d: string }) {
  return (
    <svg className="ctl-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  );
}
const PLAY_ICON = 'M4 2.5v11l9-5.5z';
const PAUSE_ICON = 'M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z';
/** A bar and a triangle pointing at it: back to the first minute. */
const RESET_ICON = 'M3 2.5h2v11H3zM13.5 2.5v11L6 8z';

/**
 * The simulator's playback block (#648): one Play/Pause button and "Back to start". Stateless:
 * the page says what the button plays (the picked package's journey, or with no package every commute, #790).
 *
 * #852: on the map it is a dark pill that shows the two buttons and nothing else (controls.css). Why a
 * button is disabled is its `title` and, for screen readers, its visually hidden note; the step of a
 * playing journey is in the visually hidden live region. Only a refused step is shown, above the pill.
 */
export function PlaybackControls({ button, status = '', error = null, resetDisabled = null, onToggle, onReset }: PlaybackControlsProps) {
  const noteId = PLAY_NOTE_ID;
  const resetNoteId = RESET_NOTE_ID;
  const disabled = button.action === null;
  // The same reason is on the page once.
  const resetNote = resetDisabled && resetDisabled !== button.note ? resetDisabled : null;
  return (
    <div className="ctl-block ctl-playback" data-play-action={button.action ?? 'none'}>
      <div className="ctl-row">
        {/* #725: `aria-disabled`, not `disabled`. A press of either button makes the run busy for a moment,
            and a focused button that turns `disabled` drops keyboard focus to <body>. These stay in the Tab
            order (their note says why they do nothing) and have no click handler while disabled. */}
        <button type="button" className="ctl-btn ctl-primary" aria-disabled={disabled || undefined}
          aria-describedby={button.note ? noteId : undefined} title={button.note ?? undefined}
          onClick={disabled ? undefined : onToggle}>
          <Icon d={button.label === PAUSE_LABEL ? PAUSE_ICON : PLAY_ICON} />
          <span className="ctl-label">{button.label}</span>
        </button>
        <button type="button" className="ctl-btn" aria-disabled={!!resetDisabled || undefined}
          aria-describedby={resetDisabled ? (resetNote ? resetNoteId : noteId) : undefined} title={resetDisabled ?? undefined}
          onClick={resetDisabled ? undefined : onReset}>
          <Icon d={RESET_ICON} />
          <span className="ctl-label">{RESET_LABEL}</span>
        </button>
      </div>
      {button.note && <p className="ctl-note" id={noteId}>{button.note}</p>}
      {resetNote && <p className="ctl-note" id={resetNoteId}>{resetNote}</p>}
      {/* #725: one polite announcement per step change. Always in the page, so its next text is announced. */}
      <p className="ctl-status" role="status">{status}</p>
      {error && <p className="ctl-error" role="alert">{error}</p>}
    </div>
  );
}
