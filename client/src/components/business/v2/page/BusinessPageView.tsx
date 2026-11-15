// MVP II Business page (#461): puts the merged Business pieces together. Props only, so tests render
// every screen without the data hook. Local UI state: the table's search, filters and sort, what New
// delivery shows (the request text box, then the form), and the retry-match status. All data comes from the
// hook state, and the page changes only `?shipment=` (through onOpenShipment / onCloseShipment).
// New delivery (MVP IV F1, docs/mvp4.md): it opens on one text box; the server reads the sentence and the
// existing form opens prefilled as the confirmation card (DECISIONS pass 81). Only the form's button sends.
// Above that card, the Options card (#863): the server's priced variants of the request (POST /api/v2/advise).
// Choosing one sets the form's ready and deliver-by times. It follows the form (#948): without an option it
// says why, the form marks the field the options wait for, and the card asks again when that field is filled.
// The shell has the only <main> (#581, DECISIONS pass 60), so the page's root is a <div>.
import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode,
} from 'react';
import type { ShipmentResponse } from '../../../../../../shared/v2/api';
import type { ParseRequestResponse } from '../../../../../../shared/v2/parseRequest';
import type { CreateShipmentRequest } from '../../../../../../shared/v2/schemas';
import { advise as apiAdvise, parseRequest as apiParseRequest } from '../../../../api/v2';
import { BusinessHeader } from '../activity/BusinessHeader';
import { adviseAsk, askMissing, sameAsk, type AdviseAsk, type AdviseCall } from '../adviceModel';
import { AdviceOptions } from '../AdviceOptions';
import { NotificationsPanel } from '../activity/NotificationsPanel';
import { DeliveryDetails } from '../DeliveryDetails';
import { useHiddenDeliveries } from '../hiddenDeliveries';
import { RECONNECTING_TEXT, RUN_CHANGED_NOTE, type BusinessWorkspaceState } from '../live/businessWorkspaceState';
import { NewDeliveryForm, isEchoPress, pressOf, type Press } from '../NewDeliveryForm';
import type { DraftTimes, NewDeliveryDraft } from '../newDeliveryModel';
import { ParsedRequestNote, RequestTextBox, type ParseRequestCall } from '../RequestTextBox';
import { parsedRequest, type ParsedRequest } from '../requestTextModel';
import { ShipmentsTable } from '../ShipmentsTable';
import { ShipmentsToolbar } from '../ShipmentsToolbar';
import { NO_FILTERS, nextSort } from '../shipmentsTableModel';
import {
  DELIVERY_FAILED_TEXT, DELIVERY_LOADING_TITLE, DELIVERY_MISSING_TEXT, DELIVERY_MISSING_TITLE, ERROR_TITLE,
  INITIAL_TABLE, LOADING_TEXT, NOT_FOUND_TEXT, NOT_FOUND_TITLE, NO_BUSINESSES_TEXT, STACKED_QUERY, UNAVAILABLE_TITLE,
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
  /** Reads a typed request (New delivery's text box). Default: POST /api/v2/parse-request. */
  parseRequest?: ParseRequestCall;
  /** Asks for the options of a read request (the Options card). Default: POST /api/v2/advise. */
  advise?: AdviseCall;
  /** Starting UI state, for static renders: New delivery open on the empty form. */
  initialNewOpen?: boolean;
  /** Starting UI state, for static renders: New delivery open on the request text box. */
  initialRequestOpen?: boolean;
  initialTable?: TableState;
  /** The open delivery's route map (#549), shown above its details; the page passes it in. */
  deliveryRoute?: ReactNode;
};

/**
 * What New delivery shows. `text`: the request text box, holding `text` when it is reopened. `form`: the New
 * delivery form, prefilled from `parsed` (the confirmation card) or empty ("Fill in the form instead");
 * `key` is new for every opening, so the form always starts from the draft it is given. A read request
 * (`parsed`) comes with the Options card, which asks about the request as the form holds it.
 */
type NewView =
  | { kind: 'closed' }
  | { kind: 'text'; text: string }
  | { kind: 'form'; key: number; parsed: ParsedRequest | null };

/** The browser's answer for the one-column width, or null where there is none to ask (tests, old browsers). */
function stackedMedia(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(STACKED_QUERY) : null;
}

function watchStacked(onChange: () => void): () => void {
  const media = stackedMedia();
  if (!media || typeof media.addEventListener !== 'function') return () => {};
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * True while the page is one column (businessPage.css, the same width). The stylesheet shows the open
 * delivery above the table there, so the page puts it before the table in the document too: Tab and a
 * screen reader then meet the parts in the order the eye does (#892). Two columns where it cannot be asked.
 */
function useStacked(): boolean {
  return useSyncExternalStore(watchStacked, () => stackedMedia()?.matches ?? false, () => false);
}

export function BusinessPageView({
  state, shipmentId, createShipment, matchShipment, refetchNow, dismissRunChanged,
  onOpenShipment, onCloseShipment, businessHref, parseRequest = apiParseRequest, advise = apiAdvise, initialNewOpen = false,
  initialRequestOpen = false, initialTable = INITIAL_TABLE, deliveryRoute = null,
}: BusinessPageViewProps) {
  const [newView, setNewView] = useState<NewView>(
    () => (initialNewOpen ? { kind: 'form', key: 0, parsed: null } : initialRequestOpen ? { kind: 'text', text: '' } : { kind: 'closed' }),
  );
  const newOpen = newView.kind !== 'closed';
  const formKey = useRef(0);
  /** The New delivery area; set when the text box has just turned into the form, which then gets focus. */
  const newArea = useRef<HTMLDivElement>(null);
  /**
   * The last pointer press on a button of the text box. "Read my request" and "Fill in the form instead"
   * replace the box with the form, so the second press of a double press would land on the form (#807):
   * `dropEcho` on the form's area drops it, before the browser opens a list or moves the focus.
   */
  const boxPress = useRef<Press | null>(null);
  const dropEcho = (e: ReactMouseEvent) => {
    if (isEchoPress(e, boxPress.current)) { e.preventDefault(); e.stopPropagation(); }
  };
  const focusForm = useRef(false);
  const [table, setTable] = useState<TableState>(initialTable);
  /** Bumped by "Clear filters" so the toolbar drops its typed search text. */
  const [toolbarKey, setToolbarKey] = useState(0);
  const [matching, setMatching] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<{ shipmentId: string; text: string } | null>(null);
  /** The button that opened New delivery; it gets focus back when the form closes (Cancel or Esc). */
  const newOpener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  /** The option chosen in the Options card: its times, for the form to take in (once per `seq`). */
  const [timesPatch, setTimesPatch] = useState<{ seq: number; times: DraftTimes } | null>(null);
  /**
   * The read request as the open form holds it now: what the Options card asks about, and marks its options
   * against. Null without a read request. Unchanged values keep the object.
   */
  const [ask, setAsk] = useState<AdviseAsk | null>(null);
  const senderId = state.dashboard?.business.id ?? '';
  const noteDraft = useCallback((draft: NewDeliveryDraft) => {
    const next = adviseAsk(draft, senderId);
    setAsk((a) => (a && sameAsk(a, next) ? a : next));
  }, [senderId]);

  useEffect(() => {
    if (newOpen || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (newOpener.current?.isConnected) newOpener.current.focus();
    newOpener.current = null;
  }, [newOpen]);

  // The pressed button ("Read my request", "Fill in the form instead") went away with the text box. A
  // prefilled form takes focus itself, on its first "Check this" field; otherwise its first field gets it.
  // A read request's card without scrolling, like the form's own focus (#807): the Options card and the
  // request's lines are above the form, and a browser that scrolled to the field moved them off the screen (#863).
  useEffect(() => {
    if (newView.kind !== 'form' || !focusForm.current) return;
    focusForm.current = false;
    const form = newArea.current?.querySelector('form.nd');
    if (form && !form.contains(document.activeElement)) {
      form.querySelector<HTMLElement>('select, input')?.focus({ preventScroll: newView.parsed !== null });
    }
  }, [newView]);

  const stacked = useStacked();
  const screen = pageScreen(state, shipmentId);
  const { dashboard, businesses, employees } = state;
  // Deliveries this business removed from its list (#949): hidden in this browser only, nothing is cancelled.
  const hidden = useHiddenDeliveries(dashboard?.business.id ?? null, state.runId);
  // Recomputed only when the hook hands over a new dashboard (a same-version poll keeps the object).
  const model = useMemo(
    () => (dashboard ? tableModel(dashboard, businesses, table, hidden.ids) : null),
    [dashboard, businesses, table, hidden.ids],
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
    // Only from closed: a press while the box or the form is open never throws away what is typed there.
    setNewView((v) => (v.kind === 'closed' ? { kind: 'text', text: '' } : v));
  };
  const closeNew = () => { restoreFocus.current = true; setNewView({ kind: 'closed' }); };
  const openForm = (parsed: ParsedRequest | null) => {
    formKey.current += 1;
    focusForm.current = true;
    setTimesPatch(null);
    setAsk(parsed ? adviseAsk(parsed.draft, d.business.id) : null);
    setNewView({ kind: 'form', key: formKey.current, parsed });
  };
  const showParsed = (answer: ParseRequestResponse, text: string) =>
    openForm(parsedRequest(answer, { origin: d.business, businesses }, text));
  // A matched answer empties the form for the next package, so the lines about the request just sent go
  // with it. The form itself stays as it is (same key): it shows "Delivery arranged".
  const sendDelivery = async (req: CreateShipmentRequest) => {
    const answer = await createShipment(req);
    if (answer.matched) setNewView((v) => (v.kind === 'form' && v.parsed ? { ...v, parsed: null } : v));
    return answer;
  };
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
        {/* One column: the open delivery is the first thing shown, so it is the first thing in the document. */}
        {stacked && side && <div className="bp-details">{side}</div>}
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
          {newView.kind === 'text' && (
            <div className="bp-new" ref={newArea}
              onClickCapture={(e) => { boxPress.current = pressOf(e, 'button') ?? boxPress.current; }}>
              <RequestTextBox
                origin={d.business}
                businesses={businesses}
                phase={d.phase}
                initialText={newView.text}
                parseRequest={parseRequest}
                onParsed={showParsed}
                onFillForm={() => openForm(null)}
                onCancel={closeNew}
              />
            </div>
          )}
          {newView.kind === 'form' && (
            <div className="bp-new" ref={newArea} onMouseDownCapture={dropEcho} onClickCapture={dropEcho}>
              {newView.parsed && ask && (
                <AdviceOptions
                  key={`options-${newView.key}`}
                  request={ask}
                  sentence={newView.parsed.text}
                  businesses={businesses}
                  advise={advise}
                  onChoose={(times) => setTimesPatch((patch) => ({ seq: (patch?.seq ?? 0) + 1, times }))}
                />
              )}
              {newView.parsed && (
                <ParsedRequestNote
                  parsed={newView.parsed}
                  onEdit={() => setNewView({ kind: 'text', text: newView.parsed?.text ?? '' })}
                />
              )}
              <NewDeliveryForm
                key={newView.key}
                origin={d.business}
                businesses={businesses}
                phase={d.phase}
                dashboardVersion={d.version}
                initialDraft={newView.parsed?.draft}
                needsInput={newView.parsed?.needsInput}
                fieldNotes={newView.parsed?.fieldNotes}
                optionsNeed={newView.parsed && ask ? askMissing(ask) : undefined}
                timesPatch={timesPatch ?? undefined}
                onDraftChange={newView.parsed ? noteDraft : undefined}
                onSubmit={sendDelivery}
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
            onRemove={hidden.hide}
            removedCount={m.removed}
            onShowAll={hidden.showAll}
          />
        </section>
        {/* In one column the aside holds the notifications only, and their own heading names them. */}
        <aside className="bp-side" aria-label={stacked ? undefined : 'Delivery details and notifications'}>
          {!stacked && side && <div className="bp-details">{side}</div>}
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
