/**
 * Keyboard map of the MVP II simulator page (docs/mvp2-ui-redesign.md §1):
 * Esc leaves the journey (or clears a network selection), Space plays/pauses,
 * `.` jumps to the next event. Pure: the page passes the keydown event in.
 */

export type SimKeyAction = 'exit_journey' | 'clear_selection' | 'toggle_play' | 'next_event';

/**
 * The parts of the focused element the map reads. A DOM element fits: an `<input>` reports its
 * `type` in lower case ("text" when the attribute is missing or unknown).
 */
export type SimKeyTargetLike = { tagName?: string; type?: string; isContentEditable?: boolean };

/** The parts of a KeyboardEvent the map reads. A DOM KeyboardEvent with `target as HTMLElement` fits. */
export type SimKeyEvent = {
  key: string;
  target?: SimKeyTargetLike | null;
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

const tagOf = (target: SimKeyEvent['target']) => (target?.tagName ?? '').toUpperCase();
const typeOf = (target: SimKeyEvent['target']) => (target?.type ?? '').toLowerCase();

const CONTROL_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);
/** `<input>` types that are pressed, not typed in: Space is their own click or toggle. */
const PRESS_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image']);

/** A form control, a button or editable text. */
export function isControlTarget(target: SimKeyEvent['target']): boolean {
  if (!target) return false;
  return CONTROL_TAGS.has(tagOf(target)) || target.isContentEditable === true;
}

/**
 * A place where the user types, which keeps every key (Esc clears a search box, Space and `.` are
 * text): a textarea, editable text, and every `<input>` except the ones with nothing to type
 * (#607: the range scrubber, a checkbox, a radio, a button-like input). An `<input>` with no type
 * or a type not known here (text, search, number, date, ...) is a text field. A `<select>` is not
 * one (pass 61): after the focus dropdown was used, Esc and Space still drive the page.
 */
export function isTextTarget(target: SimKeyEvent['target']): boolean {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = tagOf(target);
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = typeOf(target);
  return type !== 'range' && !PRESS_INPUT_TYPES.has(type);
}

/** A control whose own Space does something (a button's click, a checkbox's or radio's toggle). */
export function isPressTarget(target: SimKeyEvent['target']): boolean {
  const tag = tagOf(target);
  return tag === 'BUTTON' || (tag === 'INPUT' && PRESS_INPUT_TYPES.has(typeOf(target)));
}

/**
 * The page action for a key press, or null. Nothing fires with Ctrl, Cmd or Alt held, and nothing
 * fires from a text field (`isTextTarget`), which keeps its keys.
 *
 * From anywhere else every key works (#607), so the keys do not die after a click on the scrubber,
 * a layer checkbox, the focus dropdown, a package row or a timeline step (#511, doc §1 "A clear
 * exit (Back to network / Esc)"). The one exception: Space on a focused button, checkbox or radio
 * is left to that control, so its own click or toggle is not doubled by play/pause.
 */
export function simKeyAction(event: SimKeyEvent, state: SimKeyState): SimKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTextTarget(event.target)) return null;
  switch (event.key) {
    case 'Escape':
    case 'Esc':
      if (state.mode === 'journey') return 'exit_journey';
      return state.hasSelection === false ? null : 'clear_selection';
    case ' ':
    case 'Spacebar':
      return event.repeat || isPressTarget(event.target) ? null : 'toggle_play';
    case '.':
      return 'next_event';
    default:
      return null;
  }
}
