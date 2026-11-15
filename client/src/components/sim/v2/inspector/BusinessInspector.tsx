import type { ReactNode } from 'react';
import { Details } from '../Details';
import type { BusinessInspectorModel, PackageRow, PlaceRef } from './inspectorModel';
import './inspector.css';

// ---------- Small pieces shared with EmployeeInspector ----------
export function InspectorHeader(props: { ident: string; name: string; kind: string; onClear: () => void }) {
  return (
    <header className="insp-head">
      <div className="insp-head-text">
        <div className="insp-ident">{props.ident}</div>
        <h2 className="insp-title">{props.name}</h2>
      </div>
      <button type="button" className="insp-close" aria-label={`Close ${props.kind} inspector`} onClick={props.onClear}>
        <span aria-hidden="true">×</span>
      </button>
    </header>
  );
}

export function DefRows({ rows }: { rows: { key: string; label: string; value: ReactNode }[] }) {
  return (
    <dl className="insp-defs">
      {rows.map((r) => (
        <div key={r.key} className="insp-def" data-testid={`insp-def-${r.key}`}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A business name as a button, or plain text when it does not resolve. */
export function BusinessLink({ place, onSelect }: { place: PlaceRef; onSelect: (id: string) => void }) {
  if (!place.id) return <span className="insp-unknown">{place.name}</span>;
  const id = place.id;
  return (
    <button type="button" className="insp-link" aria-label={`Inspect business ${place.name}`} onClick={() => onSelect(id)}>
      {place.name}
    </button>
  );
}

export function NotInCity({ kind, onClear }: { kind: 'business' | 'employee'; onClear: () => void }) {
  return (
    <div className="insp" data-testid="insp-missing">
      <InspectorHeader ident={kind === 'business' ? 'Business' : 'Employee'} name="Not in the current city" kind={kind} onClear={onClear} />
      <p className="insp-empty">This {kind} is not part of the current run.</p>
    </div>
  );
}

// ---------- Package rows ----------
type RowHandlers = {
  onSelectPackage: (shipmentId: string) => void;
  onSelectEmployee: (employeeId: string) => void;
  onSelectBusiness: (businessId: string) => void;
};

function PackageRowItem({ row, h }: { row: PackageRow; h: RowHandlers }) {
  const meta = [...new Set([row.planKind, row.statusLabel])].filter(Boolean).join(' · ');
  return (
    <li className="insp-row" data-testid={`insp-row-${row.shipmentId}`}>
      <button
        type="button"
        className="insp-row-main"
        aria-label={`Open package ${row.label}`}
        onClick={() => h.onSelectPackage(row.shipmentId)}
      >
        <span className="insp-row-title">{row.label}</span>
        <span className="insp-row-meta">{meta}</span>
      </button>
      {/* #832: the row is one line; the time, the money, the minutes, the links and the reason are details. */}
      <Details about={row.label}>
      <div className="insp-row-figs" data-testid={`insp-figs-${row.shipmentId}`}>
        <span className="insp-row-role">{row.role}</span>
        {row.timeLabel && <span className="insp-fig insp-mono">{row.timeLabel}</span>}
        {row.noMatchLabel ? (
          <span className="insp-nomatch">{row.noMatchLabel}</span>
        ) : (
          <>
            {row.rewardLabel && (
              <span className="insp-fig">
                <span className="insp-fig-label">Reward</span> <span className="insp-mono">{row.rewardLabel}</span>
              </span>
            )}
            {row.extraLabel && (
              <span className="insp-fig">
                <span className="insp-fig-label">Extra</span> <span className="insp-mono">{row.extraLabel}</span>
              </span>
            )}
          </>
        )}
      </div>
      <div className="insp-row-links">
        {row.parties.map((p) => (
          <span key={p.role} className="insp-party">
            <span className="insp-role">{p.role}</span>
            <BusinessLink place={p.business} onSelect={h.onSelectBusiness} />
          </span>
        ))}
        {row.carriers.map((c, i) => (
          <span key={`${c.id}-${i}`} className="insp-party">
            <span className="insp-role">{row.carriers.length > 1 ? `Leg ${i + 1}` : 'Carrier'}</span>
            <button
              type="button"
              className="insp-link"
              aria-label={`Inspect carrier ${c.name}`}
              onClick={() => h.onSelectEmployee(c.id)}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>
      {row.reason && <p className="insp-reason">{row.reason}</p>}
      </Details>
    </li>
  );
}

function PackageList(props: { title: string; testId: string; rows: PackageRow[]; empty: string; h: RowHandlers }) {
  return (
    <section className="insp-section" data-testid={props.testId}>
      <h3 className="insp-section-title">
        {props.title} <span className="insp-count">{props.rows.length}</span>
      </h3>
      {props.rows.length === 0 ? (
        <p className="insp-empty">{props.empty}</p>
      ) : (
        <ul className="insp-rows">
          {props.rows.map((r) => <PackageRowItem key={r.shipmentId} row={r} h={props.h} />)}
        </ul>
      )}
    </section>
  );
}

// ---------- Business panel ----------
export type BusinessInspectorProps = RowHandlers & {
  model: BusinessInspectorModel | null;
  onFocus: (businessId: string) => void;
  onClear: () => void;
};

/** Right panel for a selected business: what it sends, receives and holds overnight as a relay point. */
export function BusinessInspector({ model, onFocus, onClear, ...h }: BusinessInspectorProps) {
  if (!model) return <NotInCity kind="business" onClear={onClear} />;
  return (
    <div className="insp" data-testid="insp-business">
      <InspectorHeader ident={model.ident} name={model.name} kind="business" onClear={onClear} />
      <DefRows
        rows={[
          { key: 'area', label: 'Neighborhood', value: `${model.neighborhood}, ${model.borough}` },
          { key: 'commuters', label: 'Commuters', value: <span className="insp-mono">{model.commuters}</span> },
        ]}
      />
      <Details about={model.name}>
        <DefRows rows={[{ key: 'address', label: 'Address', value: model.address }]} />
      </Details>
      <div className="insp-actions">
        <button type="button" className="insp-btn" aria-label={`Focus on this business: ${model.name}`} onClick={() => onFocus(model.id)}>
          Focus on this business
        </button>
      </div>
      <PackageList title="Sent" testId="insp-sent" rows={model.sent} empty="No packages sent." h={h} />
      <PackageList title="Received" testId="insp-received" rows={model.received} empty="No packages received." h={h} />
      <PackageList
        title="Held overnight"
        testId="insp-held"
        rows={model.held}
        empty="No packages held."
        h={h}
      />
    </div>
  );
}
