import type { CompareResponse } from '../../../../shared/api';
import { toCompareRows } from './setupModel';
import './SetupDrawer.css';

export type ComparePanelProps = { compare: CompareResponse };

export function ComparePanel({ compare }: ComparePanelProps) {
  const rows = toCompareRows(compare);
  return (
    <table className="cmp" aria-label="Direct-only versus relay comparison">
      <thead>
        <tr><th scope="col">Metric</th><th scope="col">Direct only</th><th scope="col">With relay</th><th scope="col">Difference</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.label}</th>
            <td>{r.direct}</td>
            <td>{r.relay}</td>
            <td className="cmp-diff">{r.diff}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
