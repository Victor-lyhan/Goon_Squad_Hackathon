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

  it('does nothing from form controls, buttons or editable text, in either mode (except Esc from a button)', () => {
    const tags = ['INPUT', 'input', 'SELECT', 'select', 'TEXTAREA', 'textarea', 'BUTTON', 'button'];
    for (const mode of [journey(), network()]) {
      for (const key of ['Escape', ' ', '.']) {
        for (const tagName of tags) {
          if (key === 'Escape' && tagName.toUpperCase() === 'BUTTON') continue;
          expect(simKeyAction(ev(key, { target: { tagName } }), mode)).toBeNull();
        }
        expect(simKeyAction(ev(key, { target: { tagName: 'DIV', isContentEditable: true } }), mode)).toBeNull();
      }
    }
  });

  it('Esc from a focused button still leaves the journey or clears the selection (#511, doc §1)', () => {
    for (const tagName of ['BUTTON', 'button']) {
      expect(simKeyAction(ev('Escape', { target: { tagName } }), journey())).toBe('exit_journey');
      expect(simKeyAction(ev('Esc', { target: { tagName } }), network())).toBe('clear_selection');
      expect(simKeyAction(ev('Escape', { target: { tagName } }), network({ hasSelection: false }))).toBeNull();
    }
  });

  it('never returns an action for Space when a button has focus, so its own click is not doubled', () => {
    for (const playing of [false, true]) {
      for (const mode of [journey({ playing }), network({ playing })]) {
        expect(simKeyAction(ev(' ', { target: { tagName: 'BUTTON' } }), mode)).toBeNull();
        expect(simKeyAction(ev('Spacebar', { target: { tagName: 'button' } }), mode)).toBeNull();
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
