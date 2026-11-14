import { describe, expect, it } from 'vitest';
import { keyToControl, type KeyState } from '../../client/src/components/sim/playbackModel';

const settings = { simStartMin: 0, simEndMin: 2000 };
const clock = (over = {}) => ({ timeMin: 100, playing: false, speed: 120, ...over }) as KeyState['clock'];
const st = (over: Partial<KeyState> = {}): KeyState => ({ clock: clock(), nextEventMin: 200, settings, busy: false, ...over });

describe('keyToControl', () => {
  it('maps each key', () => {
    expect(keyToControl({ key: ' ' }, st())).toEqual({ action: 'play' });
    expect(keyToControl({ key: ' ' }, st({ clock: clock({ playing: true }) }))).toEqual({ action: 'pause' });
    expect(keyToControl({ key: 'n' }, st())).toEqual({ action: 'next_event' });
    expect(keyToControl({ key: 'M' }, st())).toEqual({ action: 'jump_to_morning' });
    expect(keyToControl({ key: 'f' }, st())).toEqual({ action: 'finish' });
    expect(keyToControl({ key: 'r' }, st())).toEqual({ action: 'reset_playback' });
    expect(keyToControl({ key: '1' }, st())).toEqual({ action: 'speed', speed: 30 });
    expect(keyToControl({ key: '2' }, st())).toEqual({ action: 'speed', speed: 120 });
    expect(keyToControl({ key: '3' }, st())).toEqual({ action: 'speed', speed: 600 });
  });
  it('returns null for unknown keys', () => {
    expect(keyToControl({ key: 'x' }, st())).toBeNull();
    expect(keyToControl({ key: '4' }, st())).toBeNull();
  });
  it('ignores typing targets', () => {
    for (const tagName of ['INPUT', 'select', 'TEXTAREA']) {
      expect(keyToControl({ key: 'n', target: { tagName } }, st())).toBeNull();
    }
    expect(keyToControl({ key: 'n', target: { tagName: 'DIV', isContentEditable: true } }, st())).toBeNull();
    expect(keyToControl({ key: 'n', target: { tagName: 'DIV' } }, st())).not.toBeNull();
  });
  it('ignores modifier keys', () => {
    for (const m of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
      expect(keyToControl({ key: 'r', [m]: true }, st())).toBeNull();
    }
  });
  it('ignores everything while a request is pending', () => {
    for (const key of [' ', 'n', 'm', 'f', 'r', '1', '2', '3']) {
      expect(keyToControl({ key }, st({ busy: true }))).toBeNull();
    }
  });
  it('matches disabled buttons and leaves Space on buttons alone', () => {
    expect(keyToControl({ key: 'n' }, st({ nextEventMin: null }))).toBeNull();
    expect(keyToControl({ key: 'f' }, st({ clock: clock({ timeMin: 2000 }) }))).toBeNull();
    expect(keyToControl({ key: ' ', target: { tagName: 'BUTTON' } }, st())).toBeNull();
  });
});
