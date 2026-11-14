import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SimulatorView } from '../components/sim/SimulatorView';
import { SetupDrawer } from '../components/sim/SetupDrawer';
import { useSimulatorData } from '../components/sim/useSimulatorData';
import { PACKAGE_PARAM, handleRunIdChange, resolveDeepLink, withPackageParam } from '../components/sim/simPageModel';
import { Button, Toast, useToasts } from '../ui';

export default function Simulator() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const { toasts, push, dismiss } = useToasts();
  const { sim, map, employees, error, busy, control, refresh } = useSimulatorData();

  const param = params.get(PACKAGE_PARAM);
  const { selectedId, notFound } = resolveDeepLink(param, sim?.shipments);

  const select = (id: string | undefined) => setParams((p) => withPackageParam(p, id), { replace: true });

  // On a new runId (Generate / Import / new cycle) drop a selection that is gone. The map refetch is in the hook.
  const seenRunId = useRef<string | null>(null);
  useEffect(() => {
    if (!sim) return;
    const r = handleRunIdChange(seenRunId.current, sim.runId, param, sim.shipments);
    seenRunId.current = sim.runId;
    if (r.clearSelection) setParams((p) => withPackageParam(p, undefined), { replace: true });
  }, [sim, param, setParams]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, padding: '8px 12px 0' }}>
        {notFound && <span className="sp-note" role="status" style={{ opacity: 0.7, fontSize: 13 }}>Package not found in this run</span>}
        <Button variant="secondary" onClick={() => setSetupOpen(true)}>Setup</Button>
      </div>
      <SimulatorView sim={sim} map={map} employees={employees} error={error} busy={busy}
        selectedId={selectedId} onSelect={select} onControl={(r) => { void control(r); }} />
      <SetupDrawer open={setupOpen} onClose={() => setSetupOpen(false)}
        onChanged={(message) => { setSetupOpen(false); push(message ?? 'Run updated.', 'success'); void refresh(); }} />
      <Toast toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
