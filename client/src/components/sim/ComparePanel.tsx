import type { CompareResponse } from '../../../../shared/api';
import { toCompareView } from './compareModel';
import './SetupDrawer.css';
import './ComparePanel.css';

export type ComparePanelProps = { compare: CompareResponse };

/** The pitch's proof slide: direct-only vs with-relay, projected values straight from the API. */
export function ComparePanel({ compare }: ComparePanelProps) {
  const view = toCompareView(compare);
  return (
    <div className="cmp-panel">
      <p className={`cmp-delta ${view.tone}`} role="status">{view.deltaLine}</p>
      <table className="cmp" aria-label="Direct-only versus relay comparison">
        <thead>
          <tr><th scope="col">Projected metric</th><th scope="col">Direct only</th><th scope="col">With relay</th><th scope="col">Difference</th></tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.key} className={r.highlight ? 'cmp-hl' : undefined}>
              <th scope="row">{r.label}</th>
              <td className="cmp-direct">{r.direct}</td>
              <td className="cmp-relay">{r.relay}</td>
              <td className="cmp-diff">{r.diff}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cmp-note">{view.planNote}</p>
    </div>
  );
}
