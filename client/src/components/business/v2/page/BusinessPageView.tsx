// MVP II Business page (#461): puts the merged Business pieces together. Props only, so tests render
// every screen without the data hook. Local UI state: the table's search, filters and sort, whether the
// New delivery form is open, and the retry-match status. All data comes from the hook state, and the
// page changes only `?shipment=` (through onOpenShipment / onCloseShipment).
// The shell has the only <main> (#581, DECISIONS pass 60), so the page's root is a <div>.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ShipmentResponse } from '../../../../../../shared/v2/api';
import type { CreateShipmentRequest } from '../../../../../../shared/v2/schemas';
import { BusinessHeader } from '../activity/BusinessHeader';
import { NotificationsPanel } from '../activity/NotificationsPanel';
import { DeliveryDetails } from '../DeliveryDetails';
import { RECONNECTING_TEXT, RUN_CHANGED_NOTE, type BusinessWorkspaceState } from '../live/businessWorkspaceState';
import { NewDeliveryForm } from '../NewDeliveryForm';
import { ShipmentsTable } from '../ShipmentsTable';
import { ShipmentsToolbar } from '../ShipmentsToolbar';
import { NO_FILTERS, nextSort } from '../shipmentsTableModel';
import {
  DELIVERY_FAILED_TEXT, DELIVERY_LOADING_TITLE, DELIVERY_MISSING_TEXT, DELIVERY_MISSING_TITLE, ERROR_TITLE,
  INITIAL_TABLE, LOADING_TEXT, NOT_FOUND_TEXT, NOT_FOUND_TITLE, NO_BUSINESSES_TEXT, UNAVAILABLE_TITLE,
  heldHereText, isHeldHere, matchErrorText, newDeliveryClosedText, pageScreen, simulatorHref, tableModel,
  type TableState,
} from './businessPageModel';
import './businessPage.css';

export type BusinessPageViewProps = {
  state: BusinessWorkspaceState;
  /** The `?shipment=` value, null when absent. */
  shipmentId: string | null;
  createShipment: (req: CreateShipmentRequest) => Promise<ShipmentResponse>;
  matchShipment: (id: string) => Promise<ShipmentResponse>;
  refetchNow: () => Promise<void>;
  dismissRunChanged: () => void;
  /** Sets `?shipment=`. */
  onOpenShipment: (shipmentId: string) => void;
  /** Removes `?shipment=`. */
  onCloseShipment: () => void;
  /** Link to another business's workspace on this same route (for the not-found state). */
  businessHref: (businessId: string) => string;
  /** Starting UI state, for static renders. */
  initialNewOpen?: boolean;
  initialTable?: TableState;
  /** The open delivery's route map (#549), shown above its details; the page passes it in. */
  deliveryRoute?: ReactNode;
};

export function BusinessPageView({
  state, shipmentId, createShipment, matchShipment, refetchNow, dismissRunChanged,
  onOpenShipment, onCloseShipment, businessHref, initialNewOpen = false, initialTable = INITIAL_TABLE,
  deliveryRoute = null,
}: BusinessPageViewProps) {
  const [newOpen, setNewOpen] = useState(initialNewOpen);
  const [table, setTable] = useState<TableState>(initialTable);
  /** Bumped by "Clear filters" so the toolbar drops its typed search text. */
  const [toolbarKey, setToolbarKey] = useState(0);
  const [matching, setMatching] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<{ shipmentId: string; text: string } | null>(null);
  /** The button that opened New delivery; it gets focus back when the form closes (Cancel or Esc). */
  const newOpener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (newOpen || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (newOpener.current?.isConnected) newOpener.current.focus();
    newOpener.current = null;
  }, [newOpen]);

  const screen = pageScreen(state, shipmentId);
  const { dashboard, businesses, employees } = state;
  // Recomputed only when the hook hands over a new dashboard (a same-version poll keeps the object).
  const model = useMemo(
    () => (dashboard ? tableModel(dashboard, businesses, table) : null),
    [dashboard, businesses, table],
  );

  if (screen.kind === 'loading') {
    return <div className="bp"><p className="bp-state" role="status">{LOADING_TEXT}</p></div>;
  }
  if (screen.kind === 'not_found') {
    return (
      <div className="bp">
        <section className="bp-state" role="status">
          <h1>{NOT_FOUND_TITLE}</h1>
          <p>{screen.fallbackBusinessId ? NOT_FOUND_TEXT : NO_BUSINESSES_TEXT}</p>
          <p className="bp-links">
            {screen.fallbackBusinessId && (
              <a href={businessHref(screen.fallbackBusinessId)}>Open a business in the current city</a>
            )}
            <a href="/">Back to the start page</a>
          </p>
        </section>
      </div>
    );
  }
  if (screen.kind === 'unavailable' || screen.kind === 'error') {
    return (
      <div className="bp">
        <section className="bp-state bp-problem" role="alert">
          <h1>{screen.kind === 'unavailable' ? UNAVAILABLE_TITLE : ERROR_TITLE}</h1>
          <p>{screen.text}</p>
          <button type="button" className="bp-btn" onClick={() => { void refetchNow(); }}>Retry</button>
        </section>
      </div>
    );
  }

  const d = dashboard!;
  const m = model!;
  // The last package read as held here gives its notification a time; it stays after the panel is closed.
  const heldView = state.held?.view && isHeldHere(state.held.view, d.business.id) ? state.held.view : null;
  /** Set while the run is locked: New delivery is closed and this line says why. */
  const closedText = newDeliveryClosedText(d.phase);
  const setFilters = (f: Partial<TableState['filters']>) => setTable((t) => ({ ...t, filters: { ...t.filters, ...f } }));
  // Both New delivery buttons pass their click event through. Its currentTarget is the button even where a
  // click does not focus it (Safari); a keyboard user has it focused anyway.
  const openNew = (e?: unknown) => {
    if (closedText) return;
    const target = (e as { currentTarget?: unknown } | undefined)?.currentTarget;
    const active = document.activeElement;
    newOpener.current = target instanceof HTMLElement ? target
      : active instanceof HTMLElement && active !== document.body ? active : null;
    setNewOpen(true);
  };
  const closeNew = () => { restoreFocus.current = true; setNewOpen(false); };
  const clearFilters = () => { setTable((t) => ({ ...t, filters: NO_FILTERS })); setToolbarKey((k) => k + 1); };

  const retryMatch = async (id: string) => {
    if (matching) return;
    setMatching(id);
    setMatchError(null);
    try {
      await matchShipment(id);
    } catch (e) {
      setMatchError({ shipmentId: id, text: matchErrorText(e) });
    } finally {
      setMatching(null);
    }
  };

  let side;
  if (screen.kind === 'delivery') {
    const id = screen.view.shipment.id;
    side = (
      <>
        {matchError && matchError.shipmentId === id && (
          <p className="bp-notice bp-problem" role="alert">{matchError.text}</p>
        )}
        {screen.heldHere && <p className="bp-notice bp-held">{heldHereText(d.business.name)}</p>}
        {deliveryRoute}
        <DeliveryDetails
          key={id}
          view={screen.view}
          businesses={businesses}
          employees={employees}
          viewerBusinessId={d.business.id}
          phase={d.phase}
          busy={matching === id}
          onRetryMatch={() => { void retryMatch(id); }}
          onClose={onCloseShipment}
        />
      </>
    );
  } else if (screen.kind === 'delivery_loading') {
    side = (
      <section className="bp-missing" role="status" aria-labelledby="bp-loading-title">
        <h2 id="bp-loading-title">{DELIVERY_LOADING_TITLE}</h2>
        {screen.failed && <p>{DELIVERY_FAILED_TEXT}</p>}
        <p className="bp-mono">{screen.shipmentId}</p>
        <p className="bp-links">
          <button type="button" className="bp-btn" onClick={onCloseShipment}>Back to deliveries</button>
        </p>
      </section>
    );
  } else if (screen.kind === 'delivery_missing') {
    side = (
      <section className="bp-missing" role="status" aria-labelledby="bp-missing-title">
        <h2 id="bp-missing-title">{DELIVERY_MISSING_TITLE}</h2>
        <p>{DELIVERY_MISSING_TEXT}</p>
        <p className="bp-mono">{screen.shipmentId}</p>
        <p className="bp-links">
          <button type="button" className="bp-btn" onClick={onCloseShipment}>Back to deliveries</button>
          <a href={simulatorHref(screen.shipmentId)}>Look for it in the simulator</a>
        </p>
      </section>
    );
  }

  return (
    <div className="bp">
      <BusinessHeader dashboard={d} />
      <div className="bp-notices">
        {state.reconnecting && (
          <p className="bp-notice bp-problem" role="status">
            {RECONNECTING_TEXT}{state.unavailable ? ` ${state.unavailable.message}` : ''}
          </p>
        )}
        {state.runChanged && (
          <p className="bp-notice" role="status">
            {RUN_CHANGED_NOTE}{' '}
            <button type="button" className="bp-btn bp-btn-link" onClick={dismissRunChanged}>Dismiss</button>
          </p>
        )}
      </div>
      <div className={side ? 'bp-layout bp-layout--open' : 'bp-layout'}>
        <section className="bp-main" aria-label="Deliveries">
          <ShipmentsToolbar
            key={toolbarKey}
            initialQuery={table.filters.query}
            onQueryChange={(query) => setFilters({ query })}
            direction={table.filters.direction}
            onDirectionChange={(direction) => setFilters({ direction })}
            status={table.filters.status}
            onStatusChange={(status) => setFilters({ status })}
            counts={m.counts}
            total={m.all.length}
            onNewDelivery={openNew}
            newDeliveryDisabled={closedText !== null}
          />
          {/* The open form says the same itself, so the line shows only while the form is closed. */}
          {closedText && !newOpen && <p className="bp-notice bp-closed">{closedText}</p>}
          {newOpen && (
            <div className="bp-new">
              <NewDeliveryForm
                origin={d.business}
                businesses={businesses}
                phase={d.phase}
                onSubmit={createShipment}
                onOpenDelivery={onOpenShipment}
                onCancel={closeNew}
              />
            </div>
          )}
          <ShipmentsTable
            rows={m.rows}
            totalCount={m.all.length}
            sort={table.sort}
            onSort={(key) => setTable((t) => ({ ...t, sort: nextSort(t.sort, key) }))}
            selectedId={shipmentId}
            onSelect={onOpenShipment}
            onNewDelivery={openNew}
            newDeliveryDisabled={closedText !== null}
            onClearFilters={clearFilters}
          />
        </section>
        <aside className="bp-side" aria-label="Delivery details and notifications">
          {side && <div className="bp-details">{side}</div>}
          <NotificationsPanel
            dashboard={d}
            businesses={businesses}
            onOpenShipment={onOpenShipment}
            held={heldView}
          />
        </aside>
      </div>
    </div>
  );
}
