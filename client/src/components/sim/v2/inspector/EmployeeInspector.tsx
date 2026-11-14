import type { EmployeeInspectorModel, LegBlock } from './inspectorModel';
import { BusinessLink, DefRows, InspectorHeader, NotInCity } from './BusinessInspector';
import './inspector.css';

type LegHandlers = {
  onSelectPackage: (shipmentId: string) => void;
  onSelectBusiness: (businessId: string) => void;
};

function LegItem({ leg, h }: { leg: LegBlock; h: LegHandlers }) {
  return (
    <li className="insp-leg" data-testid={`insp-leg-${leg.jobId}`}>
      <div className="insp-leg-head">
        <button
          type="button"
          className="insp-row-main"
          aria-label={`Open package ${leg.packageLabel}`}
          onClick={() => h.onSelectPackage(leg.shipmentId)}
        >
          <span className="insp-row-title">{leg.packageLabel}</span>
          <span className="insp-row-meta">{leg.legLabel} · {leg.statusLabel}</span>
        </button>
      </div>
      <ol className="insp-stops">
        {leg.stops.map((s) => (
          <li key={s.key} className={s.isRelay ? 'insp-stop is-relay' : 'insp-stop'}>
            <span className="insp-stop-time">{s.timeLabel}</span>
            <span className="insp-stop-sep" aria-hidden="true">·</span>
            <BusinessLink place={s.place} onSelect={h.onSelectBusiness} />
            <span className="insp-stop-kind">{s.kindLabel}</span>
            {s.isRelay && <span className="insp-tag">Relay point</span>}
          </li>
        ))}
      </ol>
      <dl className="insp-leg-nums">
        <div><dt>Finish</dt><dd>{leg.finishLabel}</dd></div>
        <div><dt>Extra</dt><dd>{leg.extraLabel}</dd></div>
        <div><dt>Reward</dt><dd>{leg.rewardLabel}</dd></div>
      </dl>
    </li>
  );
}

export type EmployeeInspectorProps = LegHandlers & {
  model: EmployeeInspectorModel | null;
  onFocus: (employeeId: string) => void;
  onClear: () => void;
};

/** Right panel for a selected employee: each leg they carry, its stops, ETA, extra minutes and reward. */
export function EmployeeInspector({ model, onFocus, onClear, ...h }: EmployeeInspectorProps) {
  if (!model) return <NotInCity kind="employee" onClear={onClear} />;
  return (
    <div className="insp" data-testid="insp-employee">
      <InspectorHeader ident={model.ident} name={model.name} kind="employee" onClear={onClear} />
      <DefRows
        rows={[
          { key: 'workplace', label: 'Works at', value: <BusinessLink place={model.workplace} onSelect={h.onSelectBusiness} /> },
          { key: 'home', label: 'Home', value: model.homeNeighborhood },
          { key: 'earned', label: 'Earned so far', value: <span className="insp-mono">{model.earnedLabel}</span> },
          { key: 'reward', label: 'Reward of all legs', value: <span className="insp-mono">{model.totalRewardLabel}</span> },
        ]}
      />
      <div className="insp-actions">
        <button type="button" className="insp-btn" aria-label={`Focus on this employee: ${model.name}`} onClick={() => onFocus(model.id)}>
          Focus on this employee
        </button>
      </div>
      <section className="insp-section" data-testid="insp-legs">
        <h3 className="insp-section-title">
          Legs <span className="insp-count">{model.legs.length}</span>
        </h3>
        {model.emptyMessage ? (
          <p className="insp-empty">{model.emptyMessage}</p>
        ) : (
          <ul className="insp-rows">
            {model.legs.map((l) => <LegItem key={l.jobId} leg={l} h={h} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
