import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { MatchResultCard } from '../../client/src/components/business/MatchResultCard';
import { ShipmentForm } from '../../client/src/components/ShipmentForm';
import {
  createRequestIdHolder, defaultForm, formAfterResult, nextPackageForm,
} from '../../client/src/components/business/shipmentFormModel';
import { createShipment } from '../../client/src/api';

describe('send-a-package result flow: model', () => {
  const typed = { ...defaultForm(), originBusinessId: 'biz-1', destinationBusinessId: 'biz-2', label: 'Contracts', weightKg: '1.2', deadlineTime: '09:00' };

  it('Send another clears package fields and keeps the sender', () => {
    const next = nextPackageForm('biz-1');
    expect(next).toEqual({ ...defaultForm(), originBusinessId: 'biz-1' });
    expect(next.label).toBe('');
  });

  it('a match starts a fresh form; a no-match keeps every typed value', () => {
    expect(formAfterResult(typed, true)).toEqual(nextPackageForm('biz-1'));
    expect(formAfterResult(typed, false)).toEqual(typed);
  });

  it('a retry keeps the clientRequestId; reset (Send another) draws a new one', () => {
    const ids = createRequestIdHolder(() => 'biz-1');
    const first = ids.current();
    expect(ids.current()).toBe(first);
    ids.reset();
    expect(ids.current()).not.toBe(first);
  });
});

describe('send-a-package result flow: render with real responses', () => {
  let server: Server;
  let store: ReturnType<typeof createStore>;
  const realFetch = globalThis.fetch;
  beforeEach(async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sendflow-')), 'state.json');
    store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
    server = createApp(store).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(typeof input === 'string' && input.startsWith('/') ? base + input : input, init)) as typeof fetch;
  });
  afterEach(async () => {
    globalThis.fetch = realFetch;
    await new Promise((r) => server.close(r));
  });

  const sc = () => store.get().scenario;
  const post = (id: string, readyOff: number, dueOff: number) => createShipment({
    clientRequestId: id, originBusinessId: sc().businesses[0]!.id, destinationBusinessId: sc().businesses[1]!.id,
    label: 'Contracts', category: 'envelope', description: 'Signed', weightKg: 0.5,
    readyMin: sc().settings.simStartMin + readyOff, deadlineMin: sc().settings.simStartMin + dueOff,
    pickupInstructions: '', dropoffInstructions: '',
  });
  const card = (response: Awaited<ReturnType<typeof post>>) => renderToStaticMarkup(
    <MemoryRouter><MatchResultCard response={response} businesses={sc().businesses} hubs={sc().hubs} employees={sc().employees}
      onViewTracking={() => {}} onEdit={() => {}} onRetry={() => {}} /></MemoryRouter>,
  );

  it('matched card: focusable heading inside a polite live region, clean text', async () => {
    const res = await post('sf-1', 30, 1000);
    expect(res.matched).toBe(true);
    const html = card(res);
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/<span[^>]*tabindex="-1"[^>]*>Delivery arranged<\/span>/);
    expect(html).not.toMatch(/NaN|undefined|No matching commute/);
    expect(html).not.toMatch(/node-\w+/i);
  });

  it('no-match card: focusable heading, live region and the API reason', async () => {
    const res = await post('sf-2', 60, 61);
    expect(res.matched).toBe(false);
    const html = card(res);
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/<span[^>]*tabindex="-1"[^>]*>No matching commute yet<\/span>/);
    expect(html).toContain(res.unmatchedReason!.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'));
    expect(html).not.toMatch(/NaN|undefined|Delivery arranged/);
  });

  it('submit button is disabled with a busy label while submitting', () => {
    const o = sc().businesses[0]!;
    const html = renderToStaticMarkup(
      <MemoryRouter><ShipmentForm origin={o} businesses={sc().businesses} locked={false} submitting onSubmit={() => {}} /></MemoryRouter>,
    );
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled[^>]*>/);
    expect(html).toContain('Matching your package…');
  });
});
