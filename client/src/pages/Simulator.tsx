import { useState } from 'react';
import { SimulatorView } from '../components/sim/SimulatorView';
import { useSimulatorData } from '../components/sim/useSimulatorData';
import { resolveSelection } from '../components/sim/simPageModel';

export default function Simulator() {
  const { sim, map, employees, error, busy, control } = useSimulatorData();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  return (
    <SimulatorView sim={sim} map={map} employees={employees} error={error} busy={busy}
      selectedId={resolveSelection(selectedId, sim?.shipments ?? [])}
      onSelect={setSelectedId} onControl={(r) => { void control(r); }} />
  );
}
