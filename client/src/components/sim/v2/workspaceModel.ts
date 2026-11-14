// Pure state helpers for the MVP II simulator workspace frame (docs/mvp2-ui-redesign.md §1).
// No React, no DOM: everything here is tested in Node.
import { isTextTarget } from './page/keyMap';

// ---------- Panels ----------
export type PanelState = { leftOpen: boolean; rightOpen: boolean };
export type PanelAction = { type: 'toggleLeft' } | { type: 'toggleRight' };

export const INITIAL_PANELS: PanelState = { leftOpen: true, rightOpen: true };

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'toggleLeft': return { ...state, leftOpen: !state.leftOpen };
    case 'toggleRight': return { ...state, rightOpen: !state.rightOpen };
    default: return state;
  }
}

export const toggleLeft = (s: PanelState): PanelState => panelReducer(s, { type: 'toggleLeft' });
export const toggleRight = (s: PanelState): PanelState => panelReducer(s, { type: 'toggleRight' });

// ---------- Map layers ----------
// The layer checkboxes are gone (#648, docs/mvp3.md P2): the page always passes DEFAULT_LAYERS.
// The type stays because `simPageView` and the map still take a visibility record.
export type LayerVisibility = Record<'routes' | 'businesses' | 'homes' | 'packages', boolean>;

export const DEFAULT_LAYERS: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };

// ---------- Focus (one employee OR one business, never both) ----------
export type FocusKind = 'employee' | 'business';
export type Focus = { kind: 'none' } | { kind: FocusKind; id: string };

export const NO_FOCUS: Focus = { kind: 'none' };

/** Focus on one entity. The type allows only one focused entity, so focusing one clears the other. */
export function setFocus(kind: FocusKind, id: string): Focus {
  return id ? { kind, id } : NO_FOCUS;
}

export function clearFocus(): Focus {
  return NO_FOCUS;
}

// ---------- Mode (network view or one package's journey) ----------
export type WorkspaceMode = { mode: 'network' } | { mode: 'journey'; shipmentId: string };

export const NETWORK_MODE: WorkspaceMode = { mode: 'network' };

export function enterJourney(shipmentId: string): WorkspaceMode {
  return shipmentId ? { mode: 'journey', shipmentId } : NETWORK_MODE;
}

export function exitJourney(): WorkspaceMode {
  return NETWORK_MODE;
}

// ---------- Keyboard ----------
export type KeyLike = {
  key: string;
  defaultPrevented?: boolean;
  target?: { tagName?: string; type?: string; isContentEditable?: boolean } | null;
};

/**
 * True where the user types (a text, search or number input, a textarea, editable text). The rule
 * is the page key map's (#607), so both Esc listeners agree: a checkbox, a radio and a `<select>`
 * are not typing targets.
 */
export function isTypingTarget(target: KeyLike['target']): boolean {
  return isTextTarget(target);
}

export type EscapeAction = 'exit_journey' | 'clear_selection';

/**
 * What a key press does in the workspace. Only Escape does anything: in journey mode it exits the
 * journey first (one press = one step back); otherwise it clears the selection. Ignored while the
 * user is typing in a text field, and when another handler already took the event.
 */
export function workspaceKeyAction(e: KeyLike, ctx: { inJourney: boolean }): EscapeAction | null {
  if (e.key !== 'Escape' && e.key !== 'Esc') return null;
  if (e.defaultPrevented || isTypingTarget(e.target)) return null;
  return ctx.inJourney ? 'exit_journey' : 'clear_selection';
}
