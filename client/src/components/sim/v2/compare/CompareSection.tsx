import type { CompareResponse } from '../../../../../../shared/v2/api';
import { Button } from '../../../../ui/Button';
import { Details } from '../Details';
import { PanelSection } from '../PanelSection';
import {
  COMPARE_INTRO, DIRECT_HEADING, PROJECTION_NOTE, RELAY_HEADING, RELAY_POINT_NOTE, compareRows, compareSummary,
} from './compareModelV2';
import './compare.css';

export const COMPARE_TITLE = 'Direct only vs relay points';

export type CompareSectionProps = {
  response: CompareResponse | null;
  loading: boolean;
  error: string | null;
  onRun(): void;
  disabled?: boolean;
};

/** The long explanations, under the Details toggle (#832). */
function CompareNotes() {
  return (
    <Details about="comparison">
      <p className="cmp-note">{RELAY_POINT_NOTE}</p>
      <p className="cmp-note">{PROJECTION_NOTE}</p>
    </Details>
  );
}

function CompareTable({ response }: { response: CompareResponse }) {
  const rows = compareRows(response);
  const summary = compareSummary(response);
  return (
    <>
      <p className={`cmp-summary cmp-summary--${summary.tone}`} role="status">{summary.line}</p>
      <table className="cmp-table">
        <caption className="cmp-sr-only">Direct only compared with relay points, for the current scenario</caption>
        <thead>
          <tr>
            <th scope="col"><span className="cmp-sr-only">Measure</span></th>
            <th scope="col">{DIRECT_HEADING}</th>
            <th scope="col">{RELAY_HEADING}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.emphasis ? 'cmp-row is-emphasis' : 'cmp-row'}>
              <th scope="row">{row.label}</th>
              <td className="cmp-num">{row.direct}</td>
              <td className="cmp-num">{row.relay}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CompareNotes />
    </>
  );
}

/** Side-panel section: one POST /api/v2/matches/compare response, direct only vs with relay points. */
export function CompareSection({ response, loading, error, onRun, disabled = false }: CompareSectionProps) {
  let body;
  if (loading) {
    body = (
      <>
        <p className="cmp-text">Comparing…</p>
        <Button variant="secondary" className="cmp-run" loading disabled>Compare</Button>
      </>
    );
  } else if (error) {
    body = (
      <>
        <p className="cmp-error" role="alert">{error}</p>
        <Button variant="secondary" className="cmp-run" onClick={onRun} disabled={disabled}>Try again</Button>
      </>
    );
  } else if (response) {
    body = (
      <>
        <CompareTable response={response} />
        <Button variant="ghost" className="cmp-run" onClick={onRun} disabled={disabled}>Compare again</Button>
      </>
    );
  } else {
    body = (
      <>
        <p className="cmp-text">{COMPARE_INTRO}</p>
        <CompareNotes />
        <Button variant="secondary" className="cmp-run" onClick={onRun} disabled={disabled}>Compare</Button>
      </>
    );
  }
  return (
    <PanelSection title={COMPARE_TITLE}>
      <div className="cmp" aria-busy={loading || undefined}>{body}</div>
    </PanelSection>
  );
}
