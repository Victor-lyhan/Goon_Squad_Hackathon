// Simulator page. Mounted at /simulator since the cutover (#548, PR #559); /nyc/simulator redirects here.
// The one data hook owns all server traffic; the body renders it (#426).
// #459: the selection lives in the URL (`?package=`, `?employee=`, `?business=`, pass 47), so a link
// opens it and Back undoes it; Esc and Space drive the page; below 900 px only the desktop-only
// notice renders, so the data hook (its poll and map request) and the map never mount.
// #496: a running journey takes the first Esc (it pauses); the next one exits.
// #648: `?package=<id>&play=1` opens the journey and starts playing, once; Space is the one Play/Pause button.
import { useRef } from 'react';
import { SimPageBody, type SimBodyKeys } from '../../components/sim/v2/compose/SimPageBody';
import { useSimulatorV2, type SimulatorV2 } from '../../components/sim/v2/live/useSimulatorV2';
import { DesktopOnlyNotice } from '../../components/sim/v2/page/DesktopOnlyNotice';
import type { MatchMediaFn } from '../../components/sim/v2/page/simPageState';
import { useNarrowScreen, useSimPageState, type SimKeysRef } from '../../components/sim/v2/page/useSimPageState';

/** The workspace for one data hook value; tests pass a hand-built one. */
export function SimulatorV2Workspace({ sim }: { sim: SimulatorV2 }) {
  const keysRef: SimKeysRef = useRef<SimBodyKeys | null>(null);
  const { selection, setSelection, autoPlay, clearAutoPlay } = useSimPageState(sim, keysRef);
  return (
    <SimPageBody sim={sim} selection={selection} onSelectionChange={setSelection} keysRef={keysRef}
      autoPlay={autoPlay} onAutoPlayDone={clearAutoPlay} />
  );
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
