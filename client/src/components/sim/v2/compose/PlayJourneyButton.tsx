// The "Play journey" control of the journey panel (#496), rendered by the page body next to the
// timeline. Stateless and hook-free: the view (journeyPlay.ts) says which button to show; the body owns the player.
import { Button } from '../../../../ui';
import type { PlayButtonView } from './journeyPlay';

/** One journey panel per page, so one fixed ID for the hint or the note. */
export const PLAY_NOTE_ID = 'spc-play-note';
const noteId = PLAY_NOTE_ID;

export type PlayJourneyButtonProps = {
  button: PlayButtonView;
  /** The `role="status"` step line; an empty string keeps the live region in place. */
  status: string;
  error: string | null;
  onPlay: () => void;
  onStop: () => void;
};

export function PlayJourneyButton({ button, status, error, onPlay, onStop }: PlayJourneyButtonProps) {
  return (
    <div className="spc-play" data-state={button.kind}>
      {button.kind === 'stop' ? (
        <Button variant="secondary" className="spc-play__button" onClick={onStop}>{button.label}</Button>
      ) : (
        <Button
          className="spc-play__button"
          disabled={button.kind === 'unavailable'}
          aria-describedby={noteId}
          onClick={button.kind === 'play' ? onPlay : undefined}
        >
          {button.label}
        </Button>
      )}
      {button.kind === 'play' && <span id={noteId} className="spc-play__hint">{button.hint}</span>}
      {button.kind === 'unavailable' && <p id={noteId} className="spc-play__note">{button.note}</p>}
      <p className="spc-play__status" role="status">{status}</p>
      {error && <p className="spc-play__error" role="alert">{error}</p>}
    </div>
  );
}
