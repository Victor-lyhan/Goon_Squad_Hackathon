import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SimulatorView } from '../components/sim/SimulatorView';
import { SetupDrawer } from '../components/sim/SetupDrawer';
import { useSimulatorData } from '../components/sim/useSimulatorData';
import { PACKAGE_PARAM, RECONNECTING_TEXT, isReconnecting, resolveDeepLink, stalePackageNote, withPackageParam } from '../components/sim/simPageModel';
import { hintEmployeeId } from '../components/sim/setupModel';
import { Button, Toast, useToasts } from '../ui';

export function SimNotes({ note, reconnecting }: { note: string | null; reconnecting: boolean }) {
  const style = { opacity: 0.7, fontSize: 13 };
  return (
    <>
      {reconnecting && <span className="sp-note" role="status" style={style}>{RECONNECTING_TEXT}</span>}
      {note && <span className="sp-note" role="status" style={style}>{note}</span>}
    </>
  );
}

export default function Simulator() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const { toasts, push, dismiss } = useToasts();
  const { sim, map, employees, error, networkError, busy, control, refresh } = useSimulatorData();

  const param = params.get(PACKAGE_PARAM);
  const { selectedId } = resolveDeepLink(param, sim?.shipments);

  const select = (id: string | undefined) => setParams((p) => withPackageParam(p, id), { replace: true });

  // A ?package= that is not in the loaded run (stale link, or a new runId after Generate / Import / new cycle)
  // is cleared with a note. The map refetch on a new runId is in the hook.
  const [note, setNote] = useState<string | null>(null);
  const stale = stalePackageNote(param, sim?.shipments);
  useEffect(() => {
    if (!stale) return;
    setNote(stale);
    setParams((p) => withPackageParam(p, undefined), { replace: true });
  }, [stale, setParams]);

  const choose = (id: string | undefined) => { if (id) setNote(null); select(id); };
  // Only a lost connection keeps the last frame with a note; HTTP errors show their message.
  const reconnecting = networkError && isReconnecting(error, !!(sim && map));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, padding: '8px 12px 0' }}>
        <SimNotes note={note} reconnecting={reconnecting} />
        <Button variant="secondary" onClick={() => setSetupOpen(true)}>Setup</Button>
      </div>
      <SimulatorView sim={sim} map={map} employees={employees} error={reconnecting ? null : error} busy={busy}
        selectedId={selectedId} onSelect={choose} onControl={(r) => { void control(r); }} />
      <SetupDrawer open={setupOpen} onClose={() => setSetupOpen(false)}
        phase={sim?.clock.phase} hintEmployeeId={hintEmployeeId(sim?.jobs, employees)}
        onChanged={(message) => { setSetupOpen(false); push(message ?? 'Run updated.', 'success'); void refresh(); }} />
      <Toast toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
