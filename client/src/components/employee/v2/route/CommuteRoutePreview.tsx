// Commute route preview for the MVP II Employee workspace (#419): the saved commute on the NYC
// map, the selected delivery's stops on top, and the same facts as text under the map so nothing
// depends on the map loading. The page fetches GET /api/v2/map once per run and passes it in.
import { useMemo } from 'react';
import type { EmployeeJobView, MapResponse } from '../../../../../../shared/v2/api';
import type { Employee, Home, NetworkBusiness, Trip } from '../../../../../../shared/v2/types';
import { GoogleBaseMap } from '../../../map/GoogleBaseMap';
import { BASELINE, toneLabelColor } from '../../../map/layers';
import type { LayerVisibility } from '../../../map/types';
import { buildCommuteRoute } from './commuteRouteModel';
import './commuteRoute.css';

export type CommuteRoutePreviewProps = {
  employee: Employee;
  home: Home;
  trips: Trip[];
  businesses: NetworkBusiness[];
  map: MapResponse | null;
  job?: EmployeeJobView | null;
};

const VISIBLE: LayerVisibility = { routes: true, businesses: true, homes: true, packages: false };
const NO_MOVERS: never[] = [];
const COMMUTE_COLOR = `rgb(${BASELINE[0]}, ${BASELINE[1]}, ${BASELINE[2]})`;
const DELIVERY_COLOR = toneLabelColor('leg1');

export function CommuteRoutePreview({ employee, home, trips, businesses, map, job = null }: CommuteRoutePreviewProps) {
  const model = useMemo(
    () => buildCommuteRoute({ employee, home, trips, businesses, map, job }),
    [employee, home, trips, businesses, map, job],
  );

  return (
    <section className="ecr" aria-label="Your commute on the map">
      <div className="ecr__map">
        {model.loading ? (
          <div className="ecr__loading" role="status">Loading map…</div>
        ) : (
          <GoogleBaseMap
            places={model.places}
            routes={model.routes}
            movers={NO_MOVERS}
            visible={VISIBLE}
            stops={model.stops}
            fitTo={model.fitTo ?? 'places'}
          />
        )}
      </div>

      <ul className="ecr__legend" aria-label="Map legend">
        <li>
          <span className="ecr__swatch ecr__swatch--commute" style={{ background: COMMUTE_COLOR }} aria-hidden="true" />
          Your normal commute
        </li>
        <li>
          <span className="ecr__swatch ecr__swatch--delivery" style={{ background: DELIVERY_COLOR }} aria-hidden="true" />
          Delivery route
        </li>
      </ul>

      {model.notes.map((note) => (
        <p key={note} className="ecr__note">{note}</p>
      ))}

      {model.summary.length > 0 && (
        <ul className="ecr__summary">
          {model.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {model.stopLabels.length > 0 && (
        <ol className="ecr__stops" aria-label="Delivery stops">
          {model.stopLabels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default CommuteRoutePreview;
