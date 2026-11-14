// MVP II simulator page. Mounted at /nyc/simulator by p2-a until the cutover (DECISIONS pass 46).
// The one data hook owns all server traffic; the body renders it (#426).
// #459: the selection lives in the URL (`?package=`, `?employee=`, `?business=`, pass 47), so a link
// opens it and Back undoes it; Esc, Space and `.` drive the page; below 900 px only the
// desktop-only notice renders, so the data hook (its poll and map request) and the map never mount.
import { SimPageBody } from '../../components/sim/v2/compose/SimPageBody';
import { useSimulatorV2, type SimulatorV2 } from '../../components/sim/v2/live/useSimulatorV2';
import { DesktopOnlyNotice } from '../../components/sim/v2/page/DesktopOnlyNotice';
import type { MatchMediaFn } from '../../components/sim/v2/page/simPageState';
import { useNarrowScreen, useSimPageState } from '../../components/sim/v2/page/useSimPageState';

/** The workspace for one data hook value; tests pass a hand-built one. */
export function SimulatorV2Workspace({ sim }: { sim: SimulatorV2 }) {
  const { selection, setSelection } = useSimPageState(sim);
  return <SimPageBody sim={sim} selection={selection} onSelectionChange={setSelection} />;
}

function LiveWorkspace() {
  const sim = useSimulatorV2();
  return <SimulatorV2Workspace sim={sim} />;
}

export type SimulatorV2PageProps = {
  /** Defaults to the browser's; tests pass a fake to render the narrow layout. */
  matchMedia?: MatchMediaFn;
};

export default function SimulatorV2({ matchMedia }: SimulatorV2PageProps = {}) {
  const narrow = useNarrowScreen(matchMedia);
  if (narrow) return <DesktopOnlyNotice />;
  return <LiveWorkspace />;
}
