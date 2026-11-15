// @vitest-environment jsdom
// A double press on "Find a delivery match" on the REAL server (#719): the Business page in a real DOM
// (tests/ui/kitDom.ts), createV2Runtime on a copy of fixtures/nyc, requests through client/src/api/v2.ts.
// One press pair = one request, one stored delivery and one new row in the list, whatever the server
// answers (a no-match is a 201 too, DECISIONS pass 50). No story ID, name or count is pinned (pass 54).
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { NetworkBusiness } from '../../shared/v2/types';
import { getBusinessDashboard, getBusinesses, getSimulator } from '../../client/src/api/v2';
import BusinessV2 from '../../client/src/pages/v2/BusinessV2';
import { RESULT_COPY } from '../../client/src/components/business/v2/newDeliveryModel';
import { T, startRealApi, type RealApi } from './business-v2-real-helper';
import { buttons, byLabel, flush, mount, select, textOf, typeInto } from './kitDom';

vi.setConfig({ testTimeout: T, hookTimeout: T });

let api: RealApi;
let businesses: NetworkBusiness[];

beforeAll(async () => {
  api = await startRealApi();
  businesses = (await getBusinesses()).businesses;
});
afterAll(async () => {
  await api?.close();
});

const optionLabel = (b: NetworkBusiness) => (b.neighborhood ? `${b.name} · ${b.neighborhood}` : b.name);

/** A sender and a recipient that already have a delivery in the real run (read, not pinned). */
async function storyPair() {
  const s = (await getSimulator()).shipments[0];
  return {
    origin: businesses.find((b) => b.id === s.originBusinessId)!,
    recipient: businesses.find((b) => b.id === s.destinationBusinessId)!,
  };
}

/** A click as the browser reports a pointer press (`detail` 1: first click or a tap; 2: second click of a double click). */
function pointerPress(el: Element, detail: number, timeStamp: number): MouseEvent {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail, clientX: 700, clientY: 850 });
  Object.defineProperty(e, 'timeStamp', { value: timeStamp });
  act(() => { el.dispatchEvent(e); });
  return e;
}

describe('a double press on "Find a delivery match" on the real server (#719)', () => {
  for (const second of [
    { name: 'mouse double click', detail: 2, after: 120 },
    { name: 'touch double tap', detail: 1, after: 150 },
  ]) {
    it(`${second.name}: one request, one stored delivery, one new row in the list`, async () => {
      const { origin, recipient } = await storyPair();
      const label = `Double press 719 ${second.name}`;
      const m = mount(
        <MemoryRouter initialEntries={[`/business/${origin.id}`]}>
          <Routes><Route path="/business/:id" element={<BusinessV2 />} /></Routes>
        </MemoryRouter>,
      );
      const c = m.container;
      for (let i = 0; i < 200 && buttons(c, 'New delivery').length === 0; i++) await flush();
      const rows = () => [...c.querySelectorAll('tr.bw-row')];
      const mine = () => rows().filter((r) => textOf(r.querySelector('td[data-label="Package"]')!) === label);
      const outgoing = async () => (await getBusinessDashboard(origin.id)).outgoing;
      const rowsBefore = rows().length;
      const storedBefore = (await outgoing()).length;
      expect(rowsBefore).toBeGreaterThan(0); // the list is drawn before the press, so the count below means something

      act(() => { buttons(c, 'New delivery')[0].click(); });
      const form = () => c.querySelector('form.nd')!;
      const send = () => form().querySelector<HTMLButtonElement>('.nd-actions button[type="submit"]')!;
      const listed = () => [...(byLabel(form(), 'Recipient') as HTMLSelectElement).options].some((o) => o.text.trim() === optionLabel(recipient));
      for (let i = 0; i < 200 && !listed(); i++) await flush();
      select(byLabel(form(), 'Recipient'), optionLabel(recipient));
      typeInto(byLabel(form(), 'Package name'), label);
      typeInto(byLabel(form(), 'Contents'), 'One folder');

      const start = api.requests.length;
      const posts = () => api.requests.slice(start).filter((r) => r.startsWith('POST '));
      const result = () => textOf(form().querySelector('.nd-result')!);
      const answered = () => result().includes(RESULT_COPY.matched) || result().includes(RESULT_COPY.unmatched);

      // First press; the answer arrives and redraws the form; then the second press of the pair lands on the
      // submit button again (the answer brings it back under the pointer).
      pointerPress(send(), 1, 1000);
      for (let i = 0; i < 400 && !answered(); i++) await flush();
      expect(answered(), `no answer in the form: ${textOf(form())}`).toBe(true);
      expect(send().disabled).toBe(false);
      const dropped = pointerPress(send(), second.detail, 1000 + second.after);
      for (let i = 0; i < 400 && mine().length === 0; i++) await flush();
      for (let i = 0; i < 20; i++) await flush();

      expect(dropped.defaultPrevented).toBe(true);
      // One request: no second POST /shipments and no POST /shipments/:id/match from the second press.
      expect(posts()).toEqual(['POST /api/v2/shipments']);
      // One delivery stored, and it is the one the form names.
      const stored = await outgoing();
      expect(stored).toHaveLength(storedBefore + 1);
      const delivery = stored.filter((v) => v.shipment.label === label);
      expect(delivery).toHaveLength(1);
      expect(result()).toContain(delivery[0].shipment.id);
      // The list shows it once, without a reload.
      expect(mine()).toHaveLength(1);
      expect(rows()).toHaveLength(rowsBefore + 1);
      expect(textOf(mine()[0].querySelector('td[data-label="Shipment ID"]')!)).toBe(delivery[0].shipment.id);
      // The second press did not send the emptied draft through validation either.
      expect([...form().querySelectorAll('.nd-error')].map(textOf)).toEqual([]);
      expect(api.googleCalls).toEqual([]);
      m.unmount();
    });
  }
});
