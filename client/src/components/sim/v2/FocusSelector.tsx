import { useEffect, useRef } from 'react';
import { clearFocus, setFocus, type Focus, type FocusKind } from './workspaceModel';

export type FocusOption = { id: string; label: string };

export type FocusSelectorProps = {
  employees: FocusOption[];
  businesses: FocusOption[];
  focus: Focus;
  onChange: (focus: Focus) => void;
};

const FIELDS: { kind: FocusKind; label: string; id: string; none: string }[] = [
  { kind: 'employee', label: 'Focus on employee', id: 'sw-focus-employee', none: 'All employees' },
  { kind: 'business', label: 'Focus on business', id: 'sw-focus-business', none: 'All businesses' },
];

/**
 * Focus on one employee or one business. Choosing one clears the other.
 * Keyboard and screen reader (#907): native `<select>`s with a visible `<label for>`, so the arrow keys
 * change the focus and the screen reader reads the choice. "Show everything" disables itself once it has
 * cleared the focus, which would drop keyboard focus to the page; it hands it to the select it just
 * cleared instead, which reads out "All employees" / "All businesses".
 */
export function FocusSelector({ employees, businesses, focus, onChange }: FocusSelectorProps) {
  const options = { employee: employees, business: businesses };
  const selects = useRef<Partial<Record<FocusKind, HTMLSelectElement | null>>>({});
  // The select to focus once the cleared value is on screen, so it is read as "All employees".
  const refocus = useRef<FocusKind | null>(null);
  useEffect(() => {
    const kind = refocus.current;
    if (!kind || focus.kind !== 'none') return;
    refocus.current = null;
    selects.current[kind]?.focus();
  }, [focus]);
  const showEverything = () => {
    if (focus.kind === 'none') return;
    refocus.current = focus.kind;
    onChange(clearFocus());
  };
  return (
    <div className="sw-focus">
      {FIELDS.map((f) => (
        <div key={f.kind} className="sw-field">
          <label htmlFor={f.id}>{f.label}</label>
          <select
            id={f.id}
            ref={(el) => { selects.current[f.kind] = el; }}
            value={focus.kind === f.kind ? focus.id : ''}
            onChange={(e) => onChange(e.target.value ? setFocus(f.kind, e.target.value) : clearFocus())}
          >
            <option value="">{f.none}</option>
            {options[f.kind].map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      ))}
      <button type="button" className="sw-btn" disabled={focus.kind === 'none'} onClick={showEverything}>
        Show everything
      </button>
    </div>
  );
}
