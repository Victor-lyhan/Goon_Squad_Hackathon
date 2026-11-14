import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, Card, Drawer, EmptyState, Spinner, Toast, useToasts } from '../ui';
import { useBusinessDashboard } from '../components/business/useBusinessDashboard';
import { NAV_ITEMS, newMatchedNotifications, type NavKey } from '../components/business/businessPortalModel';
import { SummaryCards } from '../components/business/SummaryCards';
import { NotificationList } from '../components/business/NotificationList';
import { SendPackagePanel } from '../components/business/SendPackagePanel';
import { ShipmentList } from '../components/business/ShipmentList';
import { StaleShipmentNotice, TrackingDetail } from '../components/business/TrackingDetail';
import { BusinessNotFound } from '../components/business/BusinessNotFound';
import { lookupShipment } from '../components/business/trackingModel';
import { formFromShipment, type FormState } from '../components/business/shipmentFormModel';
import '../components/business/BusinessPortal.css';

export default function BusinessPortal() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const state = useBusinessDashboard(id);
  const { dashboard, businesses, hubs, employees } = state;
  const { toasts, push, dismiss } = useToasts();
  const [nav, setNav] = useState<NavKey>('overview');
  const [resetKey, setResetKey] = useState(0);
  const [prefill, setPrefill] = useState<Partial<FormState> | undefined>(undefined);

  // Toast for a new delivery_matched notification seen on a poll.
  const seen = useRef<{ id: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!dashboard) return;
    const prev = seen.current && seen.current.id === id ? seen.current.ids : null;
    for (const n of newMatchedNotifications(prev, dashboard.notifications).reverse()) push(n.message, 'success');
    seen.current = { id, ids: new Set(dashboard.notifications.map((n) => n.id)) };
  }, [dashboard, id, push]);

  const selectedId = params.get('shipment');
  const lookup = useMemo(() => lookupShipment(selectedId, dashboard), [dashboard, selectedId]);
  const selected = lookup.kind === 'found' ? lookup.view : undefined;
  // Switching business closes the drawer: drop ?shipment when the id changes.
  const prevId = useRef(id);
  useEffect(() => {
    if (prevId.current === id) return;
    prevId.current = id;
    setParams((p) => { const n = new URLSearchParams(p); n.delete('shipment'); return n; }, { replace: true });
  }, [id, setParams]);
  const select = (sid: string | null) => {
    const next = new URLSearchParams(params);
    if (sid) next.set('shipment', sid); else next.delete('shipment');
    setParams(next, { replace: true });
  };

  if (state.status === 'not_found') return <BusinessNotFound businesses={businesses} />;
  if (state.status === 'loading') return <div className="bp-main"><Spinner label="Loading your dashboard" /></div>;
  if (state.status === 'error' || !dashboard) {
    return (
      <div className="bp-main" role="alert">
        <EmptyState title="Could not load the business portal" description={state.error ?? 'Unknown error'} action={<Button onClick={() => void state.refetch()}>Try again</Button>} />
      </div>
    );
  }

  const locked = dashboard.phase === 'locked';
  const empty = dashboard.outgoing.length === 0 && dashboard.incoming.length === 0;

  return (
    <div className="bp">
      <nav className="bp-nav" aria-label="Business sections">
        {NAV_ITEMS.map((n) => (
          <button key={n.key} type="button" aria-current={nav === n.key ? 'page' : undefined} onClick={() => { setPrefill(undefined); setNav(n.key); }}>{n.label}</button>
        ))}
      </nav>
      <div className="bp-main">
        <h1>{dashboard.business.name}</h1>
        {state.error && <div className="bp-error" role="alert">Connection problem: {state.error}</div>}
        {nav === 'overview' && (
          <>
            <SummaryCards totals={dashboard.totals} />
            {empty && (
              <EmptyState title="No packages yet" description="Send your first package to see it here."
                action={<Button onClick={() => setNav('send')}>Send a package</Button>} />
            )}
            <NotificationList notifications={dashboard.notifications} onSelect={select} />
          </>
        )}
        {nav === 'send' && (
          <SendPackagePanel
            origin={dashboard.business}
            businesses={businesses}
            hubs={hubs}
            employees={employees}
            locked={locked}
            initial={prefill}
            resetKey={resetKey}
            onViewTracking={select}
            onChanged={state.refetch}
            onError={(m) => push(m, 'error')}
          />
        )}
        {nav === 'outgoing' && (
          <Card title="Outgoing"><ShipmentList views={dashboard.outgoing} direction="outgoing" businesses={businesses} hubs={hubs} selectedId={selectedId ?? undefined} onSelect={select} /></Card>
        )}
        {nav === 'incoming' && (
          <Card title="Incoming"><ShipmentList views={dashboard.incoming} direction="incoming" businesses={businesses} hubs={hubs} selectedId={selectedId ?? undefined} onSelect={select} /></Card>
        )}
      </div>
      <Drawer open={lookup.kind !== 'none'} onClose={() => select(null)} title="Tracking">
        {lookup.kind === 'missing' && <StaleShipmentNotice onClose={() => select(null)} />}
        {selected && (
          <>
            <TrackingDetail view={selected} businesses={businesses} hubs={hubs} employees={employees} />
            {selected.shipment.originBusinessId === dashboard.business.id && (
              <div className="bp-drawer-actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPrefill(formFromShipment(selected.shipment));
                    setResetKey((k) => k + 1);
                    select(null);
                    setNav('send');
                  }}
                >
                  Duplicate request
                </Button>
              </div>
            )}
          </>
        )}
      </Drawer>
      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
