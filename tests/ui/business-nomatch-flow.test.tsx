import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { ShipmentResponse } from '../../shared/api';
import { MatchResultCard } from '../../client/src/components/business/MatchResultCard';
import { ShipmentList } from '../../client/src/components/business/ShipmentList';
import { ShipmentForm } from '../../client/src/components/ShipmentForm';
import { patchFromRequest } from '../../client/src/components/business/businessPortalModel';
import {
  actionErrorMessage, createSubmitGuard, formFromShipment, newClientRequestId, toRequest, validate,
} from '../../client/src/components/business/shipmentFormModel';
import { ApiRequestError, createShipment, getShipment, matchShipment, patchShipment } from '../../client/src/api';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;');

// Real server + real POSTs: ~0.9 s locally on the first test. Explicit 30 s (>3x, >=10 s) so a slow CI runner cannot hit the 5 s default (#307).
const SLOW = 30_000;
describe('no-match -> Edit request -> Try again -> Duplicate (real pipeline)', { timeout: SLOW }, () => {
  let server: Server;
  let store: ReturnType<typeof createStore>;
  const realFetch = globalThis.fetch;
  beforeEach(async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nomatch-')), 'state.json');
    store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
    server = createApp(store).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(typeof input === 'string' && input.startsWith('/') ? base + input : input, init)) as typeof fetch;
  }, SLOW);
  afterEach(async () => {
    globalThis.fetch = realFetch;
    await new Promise((r) => server.close(r));
  }, SLOW);

  const scenario = () => store.get().scenario;
  const origin = () => scenario().businesses[0]!;
  const dest = () => scenario().businesses[1]!;

  // Ready at sim start but due one minute later: no commute can make it.
  async function postUnmatched(extra = {}) {
    const { settings } = scenario();
    return createShipment({
      clientRequestId: 'nm-1', originBusinessId: origin().id, destinationBusinessId: dest().id,
      label: 'Tight contracts', category: 'envelope', description: 'Needs it fast', weightKg: 0.7,
      readyMin: settings.simStartMin + 60, deadlineMin: settings.simStartMin + 61,
      pickupInstructions: 'Front desk', dropoffInstructions: 'Ask for Sam', ...extra,
    });
  }

  const card = (response: ShipmentResponse, busy = false) => {
    const { businesses, hubs, employees } = scenario();
    return renderToStaticMarkup(
      <MemoryRouter><MatchResultCard response={response} businesses={businesses} hubs={hubs} employees={employees}
        busy={busy} onViewTracking={() => {}} onEdit={() => {}} onRetry={() => {}} /></MemoryRouter>,
    );
  };

  it('renders the card with the backend reason and keeps the package in Outgoing', async () => {
    const res = await postUnmatched();
    expect(res.matched).toBe(false);
    expect(res.unmatchedReason).toBeTruthy();
    const html = card(res);
    expect(html).toContain('No matching commute yet');
    expect(html).toContain(esc(res.unmatchedReason!));
    expect(html).toContain('Edit request');
    expect(html).toContain('Try again');
    expect(html).not.toMatch(/NaN|undefined|Delivery arranged/);

    const run = store.get();
    const d = businessDashboard(run, snapshotAt(run, run.clock.timeMin), origin().id)!;
    const row = d.outgoing.find((v) => v.shipment.id === res.shipment.id);
    expect(row).toBeDefined();
    expect(row!.plan).toBeFalsy();
    const list = renderToStaticMarkup(<ShipmentList views={d.outgoing} direction="outgoing" businesses={scenario().businesses} onSelect={() => {}} />);
    expect(list).toContain('Tight contracts');
    expect(list).toContain('No match yet');
  });

  it('busy disables Edit request and Try again', async () => {
    const html = card(await postUnmatched(), true);
    expect(html.match(/<button[^>]*disabled/g)?.length).toBe(2);
  });

  it('Edit request prefills every field from the stored shipment and PATCHes it', async () => {
    const res = await postUnmatched();
    const stored = (await getShipment(res.shipment.id)).shipment;
    const form = formFromShipment(stored);
    expect(form).toMatchObject({
      originBusinessId: origin().id, destinationBusinessId: dest().id, label: 'Tight contracts',
      category: 'envelope', description: 'Needs it fast', weightKg: '0.7',
      pickupInstructions: 'Front desk', dropoffInstructions: 'Ask for Sam',
    });
    const day = (m: number) => (m >= 1440 ? 2 : 1);
    expect(form.readyDay).toBe(day(stored.readyMin));
    expect(form.deadlineDay).toBe(day(stored.deadlineMin));
    // The rendered form shows them too.
    const html = renderToStaticMarkup(
      <ShipmentForm origin={origin()} businesses={scenario().businesses} locked={false} submitting={false} initial={form} onSubmit={() => {}} />,
    );
    expect(html).toContain('value="Tight contracts"');
    expect(html).toContain('value="0.7"');
    expect(html).toContain(form.readyTime);
    expect(html).toContain('Needs it fast');

    // Edit: relax the deadline to the end of the sim and save.
    const edited = { ...form, deadlineDay: 2 as const, deadlineTime: '10:00' };
    expect(validate(edited)).toEqual({});
    const req = toRequest(edited, 'ignored');
    const body = patchFromRequest(req);
    expect(body).not.toHaveProperty('clientRequestId');
    const patched = await patchShipment(stored.id, body);
    expect(patched.shipment.id).toBe(stored.id);
    expect(patched.shipment.deadlineMin).toBe(2040);
    expect(patched.shipment.weightGrams).toBe(700);
    expect(store.get().scenario.shipments.filter((s) => s.id === stored.id)).toHaveLength(1);
  });

  it('Try again calls POST /match and returns the same shipment', async () => {
    const res = await postUnmatched();
    const spy = vi.spyOn(globalThis, 'fetch');
    const again = await matchShipment(res.shipment.id);
    expect(again.shipment.id).toBe(res.shipment.id);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe(`/api/shipments/${res.shipment.id}/match`);
    expect(init?.method).toBe('POST');
    spy.mockRestore();
  });

  it('guard ignores a second call while one is pending (no double submit)', async () => {
    const guard = createSubmitGuard();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = guard(async () => { calls++; await gate; return 'a'; });
    const second = await guard(async () => { calls++; return 'b'; });
    expect(second).toBeUndefined();
    release();
    expect(await first).toBe('a');
    expect(calls).toBe(1);
    expect(await guard(async () => 'c')).toBe('c');
  });

  it('409 while locked shows the "Start a new planning cycle" message', async () => {
    const res = await postUnmatched();
    await store.mutate((r) => { r.clock.phase = 'locked'; });
    const errs: unknown[] = [];
    await patchShipment(res.shipment.id, { label: 'x' }).catch((e) => errs.push(e));
    await matchShipment(res.shipment.id).catch((e) => errs.push(e));
    await postUnmatched({ clientRequestId: 'nm-2' }).catch((e) => errs.push(e));
    expect(errs).toHaveLength(3);
    for (const e of errs) {
      expect(e).toBeInstanceOf(ApiRequestError);
      expect((e as ApiRequestError).status).toBe(409);
      expect(actionErrorMessage(e)).toMatch(/Start a new planning cycle/);
    }
    expect(actionErrorMessage(new ApiRequestError(409, 'Locked'))).toMatch(/Start a new planning cycle/);
    expect(actionErrorMessage(new ApiRequestError(500, 'Boom'))).toBe('Boom');
  });

  it('Duplicate prefills the same details and POSTs a second shipment, not a replay', async () => {
    const res = await postUnmatched();
    const stored = (await getShipment(res.shipment.id)).shipment;
    const form = formFromShipment(stored);
    const id = newClientRequestId(origin().id);
    expect(id).not.toBe(stored.clientRequestId);
    expect(newClientRequestId(origin().id)).not.toBe(id);
    const dup = await createShipment(toRequest(form, id));
    expect(dup.shipment.id).not.toBe(stored.id);
    expect(dup.shipment.clientRequestId).toBe(id);
    expect(dup.shipment).toMatchObject({
      label: stored.label, description: stored.description, weightGrams: stored.weightGrams,
      readyMin: stored.readyMin, deadlineMin: stored.deadlineMin, destinationBusinessId: stored.destinationBusinessId,
    });
    expect(store.get().scenario.shipments.filter((s) => s.label === 'Tight contracts')).toHaveLength(2);
    // Replaying the original id is still idempotent.
    const replay = await postUnmatched();
    expect(replay.shipment.id).toBe(stored.id);
  });
});
