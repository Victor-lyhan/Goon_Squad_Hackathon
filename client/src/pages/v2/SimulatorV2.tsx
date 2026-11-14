// MVP II simulator page, first cut (#426). Mounted at /nyc/simulator by p2-a until the cutover
// (DECISIONS pass 46). The one data hook owns all server traffic; the body renders it.
// Selection is local state, seeded once from `?package=<shipmentId>` so a link opens the journey.
// The full URL state (#407) replaces this in the follow-up.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SimPageBody } from '../../components/sim/v2/compose/SimPageBody';
import { initialSelectionFromSearch } from '../../components/sim/v2/compose/simPageView';
import { useSimulatorV2 } from '../../components/sim/v2/live/useSimulatorV2';
import type { Selection } from '../../components/sim/v2/network/selectionModel';

export default function SimulatorV2() {
  const sim = useSimulatorV2();
  const [params] = useSearchParams();
  const [selection, setSelection] = useState<Selection>(() => initialSelectionFromSearch(params));
  return <SimPageBody sim={sim} selection={selection} onSelectionChange={setSelection} />;
}
