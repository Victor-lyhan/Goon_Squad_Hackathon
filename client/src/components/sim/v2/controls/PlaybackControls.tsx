import { RESET_LABEL, type PlayButtonView } from './controlsModel';
import './controls.css';

export type PlaybackControlsProps = {
  /** The one Play/Pause button, from `playButtonView` (compose/journeyPlay.ts). */
  button: PlayButtonView;
  /** The `role="status"` step line of a playing journey; an empty string keeps the live region in place. */
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

/**
 * The simulator's playback block (#648): one Play/Pause button and "Back to start". Stateless:
 * the page says what the button plays (the picked package's journey, or with no package every commute, #790).
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
          aria-describedby={button.note ? noteId : undefined} onClick={disabled ? undefined : onToggle}>
          {button.label}
        </button>
        <button type="button" className="ctl-btn" aria-disabled={!!resetDisabled || undefined}
          aria-describedby={resetDisabled ? (resetNote ? resetNoteId : noteId) : undefined} onClick={resetDisabled ? undefined : onReset}>
          {RESET_LABEL}
        </button>
      </div>
      {button.note && <p className="ctl-note" id={noteId}>{button.note}</p>}
      {resetNote && <p className="ctl-note" id={resetNoteId}>{resetNote}</p>}
      {/* #842: the step line shown is at most two lines, cut with an ellipsis (controls.css), so it cannot
          push Play/Pause up in a narrow map. Its full text is its title (hover) and the live region under
          it, which is visually hidden and read by screen readers; the shown copy is hidden from them, so
          each step is heard once. */}
      {status && <p className="ctl-line" aria-hidden="true" title={status}>{status}</p>}
      <p className="ctl-status" role="status">{status}</p>
      {error && <p className="ctl-error" role="alert">{error}</p>}
    </div>
  );
}
