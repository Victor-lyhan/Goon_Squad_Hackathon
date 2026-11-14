import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYERS, INITIAL_PANELS, LAYERS, NETWORK_MODE, clearFocus, enterJourney, exitJourney,
  isTypingTarget, panelReducer, setFocus, toggleLayer, toggleLeft, toggleRight, workspaceKeyAction,
} from '../../client/src/components/sim/v2/workspaceModel';

describe('panel reducer', () => {
  it('starts with both panels open and toggles each side independently', () => {
    expect(INITIAL_PANELS).toEqual({ leftOpen: true, rightOpen: true });
    const a = panelReducer(INITIAL_PANELS, { type: 'toggleLeft' });
    expect(a).toEqual({ leftOpen: false, rightOpen: true });
    const b = panelReducer(a, { type: 'toggleRight' });
    expect(b).toEqual({ leftOpen: false, rightOpen: false });
    expect(panelReducer(b, { type: 'toggleLeft' })).toEqual({ leftOpen: true, rightOpen: false });
  });
  it('helpers match the reducer and never mutate', () => {
    const s = { ...INITIAL_PANELS };
    expect(toggleLeft(s)).toEqual({ leftOpen: false, rightOpen: true });
    expect(toggleRight(s)).toEqual({ leftOpen: true, rightOpen: false });
    expect(toggleLeft(toggleLeft(s))).toEqual(s);
    expect(s).toEqual(INITIAL_PANELS);
  });
});

describe('layers', () => {
  it('has the four layers, all visible by default', () => {
    expect(LAYERS.map((l) => l.key)).toEqual(['routes', 'businesses', 'homes', 'packages']);
    expect(DEFAULT_LAYERS).toEqual({ routes: true, businesses: true, homes: true, packages: true });
  });
  it('toggleLayer flips only one layer', () => {
    const v = toggleLayer(DEFAULT_LAYERS, 'homes');
    expect(v).toEqual({ routes: true, businesses: true, homes: false, packages: true });
    expect(toggleLayer(v, 'homes')).toEqual(DEFAULT_LAYERS);
    expect(DEFAULT_LAYERS.homes).toBe(true);
  });
});

describe('focus', () => {
  it('is exclusive: an employee or a business, never both', () => {
    let f = setFocus('employee', 'emp-1');
    expect(f).toEqual({ kind: 'employee', id: 'emp-1' });
    f = setFocus('business', 'biz-a');
    expect(f).toEqual({ kind: 'business', id: 'biz-a' });
    expect(Object.keys(f).sort()).toEqual(['id', 'kind']);
  });
  it('clears, and an empty id means no focus', () => {
    expect(clearFocus()).toEqual({ kind: 'none' });
    expect(setFocus('employee', '')).toEqual({ kind: 'none' });
  });
});

describe('journey mode', () => {
  it('enters and exits', () => {
    expect(NETWORK_MODE).toEqual({ mode: 'network' });
    expect(enterJourney('shp-001')).toEqual({ mode: 'journey', shipmentId: 'shp-001' });
    expect(exitJourney()).toEqual({ mode: 'network' });
    expect(enterJourney('')).toEqual({ mode: 'network' });
  });
});

describe('workspaceKeyAction', () => {
  const net = { inJourney: false };
  const jour = { inJourney: true };
  it('maps Escape to clear selection', () => {
    expect(workspaceKeyAction({ key: 'Escape' }, net)).toBe('clear_selection');
    expect(workspaceKeyAction({ key: 'Escape', target: { tagName: 'BUTTON' } }, net)).toBe('clear_selection');
    expect(workspaceKeyAction({ key: 'Escape', target: null }, net)).toBe('clear_selection');
  });
  it('exits the journey first in journey mode', () => {
    expect(workspaceKeyAction({ key: 'Escape' }, jour)).toBe('exit_journey');
  });
  it('ignores other keys', () => {
    for (const key of ['Enter', ' ', 'e', 'Backspace']) expect(workspaceKeyAction({ key }, net)).toBeNull();
  });
  it('ignores Escape while typing in an input, select or textarea', () => {
    for (const tagName of ['INPUT', 'select', 'TEXTAREA']) {
      expect(workspaceKeyAction({ key: 'Escape', target: { tagName } }, net)).toBeNull();
      expect(workspaceKeyAction({ key: 'Escape', target: { tagName } }, jour)).toBeNull();
    }
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
  });
  it('ignores Escape another handler already took', () => {
    expect(workspaceKeyAction({ key: 'Escape', defaultPrevented: true }, net)).toBeNull();
  });
});
