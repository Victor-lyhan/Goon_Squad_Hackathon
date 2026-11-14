import { useState } from 'react';
import { SimulatorView } from '../components/sim/SimulatorView';
import { SetupDrawer } from '../components/sim/SetupDrawer';
import { useSimulatorData } from '../components/sim/useSimulatorData';
import { resolveSelection } from '../components/sim/simPageModel';
import { Button } from '../ui';

function SimulatorBody() {
  const { sim, map, employees, error, busy, control } = useSimulatorData();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  return (
    <SimulatorView sim={sim} map={map} employees={employees} error={error} busy={busy}
      selectedId={resolveSelection(selectedId, sim?.shipments ?? [])}
      onSelect={setSelectedId} onControl={(r) => { void control(r); }} />
  );
}

export default function Simulator() {
  const [setupOpen, setSetupOpen] = useState(false);
  // Remounting the body restarts useSimulatorData, which refetches simulator + map + employees at once.
  const [epoch, setEpoch] = useState(0);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px 0' }}>
        <Button variant="secondary" onClick={() => setSetupOpen(true)}>Setup</Button>
      </div>
      <SimulatorBody key={epoch} />
      <SetupDrawer open={setupOpen} onClose={() => setSetupOpen(false)} onChanged={() => setEpoch((n) => n + 1)} />
    </>
  );
}
