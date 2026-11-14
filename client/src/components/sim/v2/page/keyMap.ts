/**
 * Keyboard map of the MVP II simulator page (docs/mvp2-ui-redesign.md §1):
 * Esc leaves the journey (or clears a network selection), Space plays/pauses,
 * `.` jumps to the next event. Pure: the page passes the keydown event in.
 */

export type SimKeyAction = 'exit_journey' | 'clear_selection' | 'toggle_play' | 'next_event';

/** The parts of a KeyboardEvent the map reads. A DOM KeyboardEvent with `target as HTMLElement` fits. */
export type SimKeyEvent = {
  key: string;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** Auto-repeat from a held key. */
  repeat?: boolean;
};

export type SimKeyState = {
  mode: 'journey' | 'network';
  playing: boolean;
  /** Network mode only: false when nothing is selected, so Esc does nothing. Defaults to true. */
  hasSelection?: boolean;
};

/** Focus in one of these keeps every key for the control itself (typing, choosing, a button's own Space/Enter). */
const CONTROL_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);

export function isControlTarget(target: SimKeyEvent['target']): boolean {
  if (!target) return false;
  return CONTROL_TAGS.has((target.tagName ?? '').toUpperCase()) || target.isContentEditable === true;
}

/** A control that keeps Esc for itself (typing, choosing); a button has no Esc of its own. */
export function isTextTarget(target: SimKeyEvent['target']): boolean {
  return isControlTarget(target) && (target?.tagName ?? '').toUpperCase() !== 'BUTTON';
}

const isEscapeKey = (key: string) => key === 'Escape' || key === 'Esc';

/**
 * The page action for a key press, or null. Nothing fires with Ctrl, Cmd or Alt held. Space and `.`
 * never fire from a form control or a button (so a focused button's Space click is not doubled).
 * Esc fires from a focused button too (#511, doc §1 "A clear exit (Back to network / Esc)"): after a
 * click on a package row or a timeline step the focus is on that button, and Esc must still leave.
 * Esc in an input, select or textarea stays with that control.
 */
export function simKeyAction(event: SimKeyEvent, state: SimKeyState): SimKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isEscapeKey(event.key) ? isTextTarget(event.target) : isControlTarget(event.target)) return null;
  switch (event.key) {
    case 'Escape':
    case 'Esc':
      if (state.mode === 'journey') return 'exit_journey';
      return state.hasSelection === false ? null : 'clear_selection';
    case ' ':
    case 'Spacebar':
      return event.repeat ? null : 'toggle_play';
    case '.':
      return 'next_event';
    default:
      return null;
  }
}
