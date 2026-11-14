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

/** Focus on one employee or one business. Choosing one clears the other. */
export function FocusSelector({ employees, businesses, focus, onChange }: FocusSelectorProps) {
  const options = { employee: employees, business: businesses };
  return (
    <div className="sw-focus">
      {FIELDS.map((f) => (
        <div key={f.kind} className="sw-field">
          <label htmlFor={f.id}>{f.label}</label>
          <select
            id={f.id}
            value={focus.kind === f.kind ? focus.id : ''}
            onChange={(e) => onChange(e.target.value ? setFocus(f.kind, e.target.value) : clearFocus())}
          >
            <option value="">{f.none}</option>
            {options[f.kind].map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      ))}
      <button type="button" className="sw-btn" disabled={focus.kind === 'none'} onClick={() => onChange(clearFocus())}>
        Show everything
      </button>
    </div>
  );
}
