// Google's key rejection (gm_authFailure) for the NYC map (#510): the watcher on a plain object in
// place of `window`, and the status after each order of events.
import { describe, expect, it, vi } from 'vitest';
import {
  initialStatus,
  nextMapStatus,
  watchAuthFailure,
  type AuthFailureTarget,
  type MapEvent,
  type MapStatus,
} from '../../client/src/components/map/mapModel';

const fire = (t: AuthFailureTarget) => (t.gm_authFailure as () => void)();
const run = (start: MapStatus, events: MapEvent[]) => events.reduce(nextMapStatus, start);

describe('watchAuthFailure', () => {
  it('sets gm_authFailure on the target', () => {
    const target: AuthFailureTarget = {};
    watchAuthFailure(target, () => {});
    expect(typeof target.gm_authFailure).toBe('function');
  });

  it('calls onFailure once per Google call (once, then twice)', () => {
    const target: AuthFailureTarget = {};
    const onFailure = vi.fn();
    watchAuthFailure(target, onFailure);
    expect(onFailure).not.toHaveBeenCalled();
    fire(target);
    expect(onFailure).toHaveBeenCalledTimes(1);
    fire(target);
    expect(onFailure).toHaveBeenCalledTimes(2);
  });

  it('restore removes the property when there was none', () => {
    const target: AuthFailureTarget = {};
    const restore = watchAuthFailure(target, () => {});
    restore();
    expect('gm_authFailure' in target).toBe(false);
  });

  it('still calls a handler that existed before, and restore puts it back', () => {
    const before = vi.fn();
    const target: AuthFailureTarget = { gm_authFailure: before };
    const onFailure = vi.fn();
    const restore = watchAuthFailure(target, onFailure);
    expect(target.gm_authFailure).not.toBe(before);
    fire(target);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(before).toHaveBeenCalledTimes(1);
    restore();
    expect(target.gm_authFailure).toBe(before);
    fire(target);
    expect(onFailure).toHaveBeenCalledTimes(1); // ours is gone
    expect(before).toHaveBeenCalledTimes(2);
  });

  it('restores an own property that held a non-function value', () => {
    const target: AuthFailureTarget = { gm_authFailure: undefined };
    const restore = watchAuthFailure(target, () => {});
    restore();
    expect(Object.prototype.hasOwnProperty.call(target, 'gm_authFailure')).toBe(true);
    expect(target.gm_authFailure).toBeUndefined();
  });

  it('after restore, onFailure never fires and a later handler is left in place', () => {
    const target: AuthFailureTarget = {};
    const onFailure = vi.fn();
    const restore = watchAuthFailure(target, onFailure);
    const ours = target.gm_authFailure as () => void;
    const later = () => {};
    target.gm_authFailure = later;
    restore();
    expect(target.gm_authFailure).toBe(later);
    ours();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('two maps on one page: both hear the failure, and unmounting in reverse order restores the original', () => {
    const target: AuthFailureTarget = {};
    const a = vi.fn();
    const b = vi.fn();
    const restoreA = watchAuthFailure(target, a);
    const restoreB = watchAuthFailure(target, b);
    fire(target);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    restoreB();
    restoreA();
    expect('gm_authFailure' in target).toBe(false);
  });
});

describe('nextMapStatus', () => {
  it('starts in auth-error when Google already rejected the key on this page', () => {
    expect(initialStatus('k', true)).toBe('auth-error');
    expect(initialStatus('k', false)).toBe('loading');
    expect(initialStatus(null, true)).toBe('missing-key');
  });

  it('the normal load: loading, then ready', () => {
    expect(run('loading', ['load-start', 'loaded'])).toBe('ready');
  });

  it('load then failure: ready becomes auth-error', () => {
    expect(run('loading', ['load-start', 'loaded', 'auth-failed'])).toBe('auth-error');
  });

  it('failure then load: a load that resolves later does not switch it to ready', () => {
    expect(run('loading', ['load-start', 'auth-failed', 'loaded'])).toBe('auth-error');
  });

  it('failure then Retry: Retry (a new load-start) keeps auth-error, whatever the load does next', () => {
    expect(run('loading', ['load-start', 'auth-failed', 'load-start'])).toBe('auth-error');
    expect(run('loading', ['load-start', 'auth-failed', 'load-start', 'loaded'])).toBe('auth-error');
    expect(run('loading', ['load-start', 'auth-failed', 'load-start', 'load-failed'])).toBe('auth-error');
  });

  it('load error then failure: auth-error wins over the Retry view', () => {
    expect(run('loading', ['load-start', 'load-failed', 'auth-failed'])).toBe('auth-error');
  });

  it('a load error without auth failure still retries to ready', () => {
    expect(run('loading', ['load-start', 'load-failed', 'load-start', 'loaded'])).toBe('ready');
  });

  it('missing-key never changes (no script is loaded, so Google cannot call back)', () => {
    expect(run('missing-key', ['auth-failed', 'load-start', 'loaded'])).toBe('missing-key');
  });
});
