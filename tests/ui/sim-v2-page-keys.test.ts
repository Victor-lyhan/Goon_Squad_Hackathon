import { describe, expect, it } from 'vitest';
import { simKeyAction, type SimKeyEvent, type SimKeyState } from '../../client/src/components/sim/v2/page/keyMap';

const journey = (over: Partial<SimKeyState> = {}): SimKeyState => ({ mode: 'journey', playing: false, ...over });
const network = (over: Partial<SimKeyState> = {}): SimKeyState => ({ mode: 'network', playing: false, ...over });
const ev = (key: string, over: Partial<SimKeyEvent> = {}): SimKeyEvent => ({ key, target: { tagName: 'BODY' }, ...over });

describe('simKeyAction', () => {
  it('maps every key in journey mode', () => {
    expect(simKeyAction(ev('Escape'), journey())).toBe('exit_journey');
    expect(simKeyAction(ev('Esc'), journey())).toBe('exit_journey');
    expect(simKeyAction(ev(' '), journey())).toBe('toggle_play');
    expect(simKeyAction(ev(' '), journey({ playing: true }))).toBe('toggle_play');
    expect(simKeyAction(ev('.'), journey())).toBe('next_event');
  });

  it('maps every key in network mode', () => {
    expect(simKeyAction(ev('Escape'), network())).toBe('clear_selection');
    expect(simKeyAction(ev('Escape'), network({ hasSelection: true }))).toBe('clear_selection');
    expect(simKeyAction(ev('Escape'), network({ hasSelection: false }))).toBeNull();
    expect(simKeyAction(ev(' '), network())).toBe('toggle_play');
    expect(simKeyAction(ev('Spacebar'), network({ playing: true }))).toBe('toggle_play');
    expect(simKeyAction(ev('.'), network())).toBe('next_event');
  });

  it('exits the journey on Esc even if hasSelection is false', () => {
    expect(simKeyAction(ev('Escape'), journey({ hasSelection: false }))).toBe('exit_journey');
  });

  it('returns null for other keys', () => {
    for (const k of ['a', 'n', 'Enter', 'ArrowRight', ',', '>', 'Tab']) {
      expect(simKeyAction(ev(k), journey())).toBeNull();
      expect(simKeyAction(ev(k), network())).toBeNull();
    }
  });

  it('works with no target or a plain element target', () => {
    expect(simKeyAction({ key: '.' }, network())).toBe('next_event');
    expect(simKeyAction({ key: '.', target: null }, network())).toBe('next_event');
    expect(simKeyAction(ev('.', { target: { tagName: 'DIV' } }), network())).toBe('next_event');
    expect(simKeyAction(ev(' ', { target: { tagName: 'canvas' } }), network())).toBe('toggle_play');
  });

  it('a text field keeps every key, in either mode: text, search, number and a bare input, a textarea, editable text', () => {
    const fields: SimKeyEvent['target'][] = [
      { tagName: 'INPUT' }, { tagName: 'input' },
      { tagName: 'INPUT', type: 'text' }, { tagName: 'INPUT', type: 'search' }, { tagName: 'INPUT', type: 'number' },
      { tagName: 'INPUT', type: 'TEXT' }, { tagName: 'INPUT', type: 'date' }, { tagName: 'INPUT', type: '' },
      { tagName: 'TEXTAREA' }, { tagName: 'textarea' }, { tagName: 'TEXTAREA', type: 'textarea' },
      { tagName: 'DIV', isContentEditable: true },
    ];
    for (const mode of [journey(), network()]) {
      for (const key of ['Escape', 'Esc', ' ', 'Spacebar', '.']) {
        for (const target of fields) expect(simKeyAction(ev(key, { target }), mode)).toBeNull();
      }
    }
  });

  // #607: a click on the scrubber, a layer checkbox or the focus dropdown leaves the focus there.
  it('Esc and "." work from a range input, a checkbox, a radio and a select', () => {
    const controls: SimKeyEvent['target'][] = [
      { tagName: 'INPUT', type: 'range' }, { tagName: 'INPUT', type: 'checkbox' }, { tagName: 'INPUT', type: 'radio' },
      { tagName: 'input', type: 'RANGE' }, { tagName: 'SELECT' }, { tagName: 'select', type: 'select-one' },
    ];
    for (const target of controls) {
      expect(simKeyAction(ev('Escape', { target }), journey())).toBe('exit_journey');
      expect(simKeyAction(ev('Esc', { target }), network())).toBe('clear_selection');
      expect(simKeyAction(ev('Escape', { target }), network({ hasSelection: false }))).toBeNull();
      expect(simKeyAction(ev('.', { target }), journey())).toBe('next_event');
      expect(simKeyAction(ev('.', { target }), network())).toBe('next_event');
      expect(simKeyAction(ev('Escape', { target, ctrlKey: true }), journey())).toBeNull();
    }
  });

  it('Space plays or pauses from the scrubber and the focus dropdown', () => {
    for (const target of [{ tagName: 'INPUT', type: 'range' }, { tagName: 'SELECT' }, { tagName: 'select', type: 'select-one' }]) {
      expect(simKeyAction(ev(' ', { target }), journey())).toBe('toggle_play');
      expect(simKeyAction(ev('Spacebar', { target }), network({ playing: true }))).toBe('toggle_play');
      expect(simKeyAction(ev(' ', { target, repeat: true }), network())).toBeNull();
    }
  });

  it('Esc from a focused button still leaves the journey or clears the selection (#511, doc §1)', () => {
    for (const tagName of ['BUTTON', 'button']) {
      expect(simKeyAction(ev('Escape', { target: { tagName } }), journey())).toBe('exit_journey');
      expect(simKeyAction(ev('Esc', { target: { tagName } }), network())).toBe('clear_selection');
      expect(simKeyAction(ev('Escape', { target: { tagName } }), network({ hasSelection: false }))).toBeNull();
    }
  });

  it('"." from a focused button is next event (after a click on Play journey the focus is on Stop)', () => {
    for (const target of [{ tagName: 'BUTTON' }, { tagName: 'button', type: 'button' }, { tagName: 'INPUT', type: 'submit' }]) {
      expect(simKeyAction(ev('.', { target }), journey())).toBe('next_event');
      expect(simKeyAction(ev('.', { target }), network())).toBe('next_event');
    }
  });

  it('never returns an action for Space when a button, checkbox or radio has focus, so its own click or toggle is not doubled', () => {
    const pressed: SimKeyEvent['target'][] = [
      { tagName: 'BUTTON' }, { tagName: 'button', type: 'submit' },
      { tagName: 'INPUT', type: 'checkbox' }, { tagName: 'INPUT', type: 'radio' }, { tagName: 'input', type: 'Checkbox' },
      { tagName: 'INPUT', type: 'button' }, { tagName: 'INPUT', type: 'submit' }, { tagName: 'INPUT', type: 'reset' },
    ];
    for (const playing of [false, true]) {
      for (const mode of [journey({ playing }), network({ playing })]) {
        for (const target of pressed) {
          expect(simKeyAction(ev(' ', { target }), mode)).toBeNull();
          expect(simKeyAction(ev('Spacebar', { target }), mode)).toBeNull();
        }
      }
    }
  });

  it('does nothing with Ctrl, Cmd or Alt held', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      for (const key of ['Escape', ' ', '.']) {
        expect(simKeyAction(ev(key, { [mod]: true }), journey())).toBeNull();
        expect(simKeyAction(ev(key, { [mod]: true }), network())).toBeNull();
      }
    }
  });

  it('ignores a held Space (auto-repeat) so play does not flicker', () => {
    expect(simKeyAction(ev(' ', { repeat: true }), network())).toBeNull();
  });
});
