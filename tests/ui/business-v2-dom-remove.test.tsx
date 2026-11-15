// @vitest-environment jsdom
// #949: a Remove button on every row of the Business page's deliveries list. It only hides the row in this
// browser: no request is sent, nothing is cancelled or matched again. The hidden IDs are kept per business in
// localStorage, and "N removed · Show all" under the list brings the rows back.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessDashboard } from '../../shared/v2/api';
import {
  HIDDEN_KEY_PREFIX, MAX_HIDDEN_IDS, NO_HIDDEN, hiddenForRun, hiddenKey, readHidden, withHidden, writeHidden,
} from '../../client/src/components/business/v2/hiddenDeliveries';
import type { BusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import { INITIAL_TABLE, tableModel } from '../../client/src/components/business/v2/page/businessPageModel';
import { LIST_ALL_REMOVED_TITLE, NO_FILTERS } from '../../client/src/components/business/v2/shipmentsTableModel';
import { ACME, BAKERY, BUSINESSES, DASHBOARD, ready } from './business-v2-page-sample';
import { click, mount, press, textOf } from './kitDom';

const T = 10_000;
const ROW_COUNT = DASHBOARD.outgoing.length + DASHBOARD.incoming.length;
/** Bakery Row's own dashboard, with the same four deliveries: one browser, two businesses. */
const BAKERY_DASHBOARD: BusinessDashboard = { ...DASHBOARD, business: BAKERY };

function setup(state: BusinessWorkspaceState = ready(), shipmentId: string | null = null) {
  const calls = {
    createShipment: vi.fn(async () => { throw new Error('not called'); }),
    matchShipment: vi.fn(async () => { throw new Error('not called'); }),
    refetchNow: vi.fn(async () => {}),
    onOpenShipment: vi.fn(),
    onCloseShipment: vi.fn(),
  };
  const el = (s: BusinessWorkspaceState) => (
    <BusinessPageView
      state={s} shipmentId={shipmentId} {...calls}
      dismissRunChanged={() => {}} businessHref={(id) => `/nyc/business/${id}`}
    />
  );
  const m = mount(el(state));
  const c = m.container;
  const rows = () => [...c.querySelectorAll<HTMLTableRowElement>('tr.bw-row')];
  return {
    ...m, calls,
    poll: (s: BusinessWorkspaceState) => m.rerender(el(s)),
    rows,
    /** Package names of the rows on screen, in order. */
    names: () => rows().map((r) => textOf(r.querySelector('td[data-label="Package"]')!)),
    removeButton: (name: string) => {
      const found = [...c.querySelectorAll<HTMLButtonElement>('button.bw-remove')]
        .filter((b) => b.getAttribute('aria-label') === `Remove ${name} from the list`);
      if (found.length !== 1) throw new Error(`removeButton(): ${found.length} buttons for "${name}"`);
      return found[0];
    },
    removedLine: () => c.querySelector<HTMLElement>('.bw-removed'),
    showAll: () => c.querySelector<HTMLButtonElement>('.bw-removed__show'),
    count: () => textOf(c.querySelector('.bw-table__count')!),
  };
}

const stored = (businessId: string) => JSON.parse(localStorage.getItem(hiddenKey(businessId)) ?? 'null') as unknown;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('Remove on a delivery row (#949)', () => {
  it('every row ends in a Remove button named after its package', () => {
    const p = setup();
    expect(p.rows()).toHaveLength(ROW_COUNT);
    for (const row of p.rows()) {
      const name = textOf(row.querySelector('td[data-label="Package"]')!);
      const buttons = row.querySelectorAll('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].getAttribute('aria-label')).toBe(`Remove ${name} from the list`);
      expect(buttons[0].getAttribute('type')).toBe('button');
      // The cross is decoration: the name comes from the label.
      expect(buttons[0].querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
      expect(row.lastElementChild).toBe(buttons[0].parentElement);
    }
    expect(p.removedLine()).toBeNull();
  }, T);

  it('Remove hides that row at once and asks nothing of the server', () => {
    const p = setup();
    expect(p.names()).toContain('Sample boxes');
    click(p.removeButton('Sample boxes'));
    expect(p.names()).not.toContain('Sample boxes');
    expect(p.rows()).toHaveLength(ROW_COUNT - 1);
    // The list's own count follows; the other rows are untouched.
    expect(p.count()).toBe(`${ROW_COUNT - 1} deliveries`);
    expect(p.names().sort()).toEqual(['Fabric rolls', 'Invoices', 'Spare keys']);
    expect(textOf(p.removedLine()!)).toBe('1 removed · Show all');
    expect(p.removedLine()!.getAttribute('role')).toBe('status');
    // Nothing is cancelled, matched again or opened: no call left the page.
    for (const call of Object.values(p.calls)) expect(call).not.toHaveBeenCalled();
  }, T);

  it('the click does not open the delivery, and neither does Enter or Space on the button', () => {
    const p = setup();
    const btn = p.removeButton('Fabric rolls');
    btn.focus();
    press('Enter', btn);
    press(' ', btn);
    expect(p.calls.onOpenShipment).not.toHaveBeenCalled();
    click(btn);
    expect(p.calls.onOpenShipment).not.toHaveBeenCalled();
    // The row itself still opens its delivery.
    const row = p.rows()[0];
    press('Enter', row);
    expect(p.calls.onOpenShipment).toHaveBeenCalledTimes(1);
  }, T);

  it('a double press removes one row, not the row that moved up under the pointer as well', () => {
    const p = setup();
    const [first, second, third] = p.names();
    const pressAt = (el: Element, detail: number, x = 900, y = 420) => act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail, clientX: x, clientY: y }));
    });
    pressAt(p.removeButton(first), 1);
    // The second press of the double press lands on the next row's button, at the same place.
    pressAt(p.removeButton(second), 2);
    expect(p.names()).toEqual([second, third, ...p.names().slice(2)]);
    expect(textOf(p.removedLine()!)).toBe('1 removed · Show all');
    // It did not open that delivery either.
    expect(p.calls.onOpenShipment).not.toHaveBeenCalled();
    // A press somewhere else is the user's own, however soon it comes.
    pressAt(p.removeButton(third), 1, 900, 520);
    expect(p.names()).not.toContain(third);
    expect(textOf(p.removedLine()!)).toBe('2 removed · Show all');
  }, T);

  it('Show all brings every removed row back and the line goes away', () => {
    const p = setup();
    const before = p.names();
    click(p.removeButton('Sample boxes'));
    click(p.removeButton('Invoices'));
    expect(p.rows()).toHaveLength(ROW_COUNT - 2);
    expect(textOf(p.removedLine()!)).toBe('2 removed · Show all');
    // Its full name tells it from the notifications' own "Show all".
    expect(p.showAll()!.getAttribute('aria-label')).toBe('Show all removed deliveries');
    click(p.showAll()!);
    expect(p.names()).toEqual(before);
    expect(p.removedLine()).toBeNull();
    expect(p.count()).toBe(`${ROW_COUNT} deliveries`);
    expect(localStorage.getItem(hiddenKey(ACME.id))).toBeNull();
  }, T);

  it('a removed row stays removed after a reload', () => {
    const first = setup();
    click(first.removeButton('Sample boxes'));
    expect(stored(ACME.id)).toEqual({ runId: 'run-1', ids: ['shp-7'] });
    first.unmount();

    const again = setup();
    expect(again.names()).not.toContain('Sample boxes');
    expect(again.rows()).toHaveLength(ROW_COUNT - 1);
    expect(textOf(again.removedLine()!)).toBe('1 removed · Show all');
    click(again.showAll()!);
    expect(again.names()).toContain('Sample boxes');
    again.unmount();

    // And Show all survives one too.
    expect(setup().rows()).toHaveLength(ROW_COUNT);
  }, T);

  it('a poll with a newer dashboard keeps the row removed', () => {
    const p = setup();
    click(p.removeButton('Spare keys'));
    p.poll(ready({ ...DASHBOARD, version: DASHBOARD.version + 1 }));
    expect(p.names()).not.toContain('Spare keys');
    expect(textOf(p.removedLine()!)).toBe('1 removed · Show all');
  }, T);

  it('the hidden IDs are kept per business', () => {
    const acme = setup();
    click(acme.removeButton('Sample boxes'));
    acme.unmount();
    // Another business that lists the same delivery still sees it, and removes one of its own.
    const bakery = setup(ready(BAKERY_DASHBOARD));
    expect(bakery.rows()).toHaveLength(ROW_COUNT);
    click(bakery.removeButton('Invoices'));
    bakery.unmount();
    expect(stored(ACME.id)).toEqual({ runId: 'run-1', ids: ['shp-7'] });
    expect(stored(BAKERY.id)).toEqual({ runId: 'run-1', ids: ['shp-10'] });
    // Only the IDs of hidden rows are stored, under one key per business: no delivery data.
    expect(Object.keys(localStorage).sort()).toEqual([hiddenKey(ACME.id), hiddenKey(BAKERY.id)].sort());
    expect(setup().names().sort()).toEqual(['Fabric rolls', 'Invoices', 'Spare keys']);
  }, T);

  it('the delivery that is open stays open when its row is removed', () => {
    const p = setup(ready(), 'shp-7');
    expect(p.container.querySelector('.bd-panel')).not.toBeNull();
    click(p.removeButton('Sample boxes'));
    expect(p.names()).not.toContain('Sample boxes');
    expect(p.container.querySelector('.bd-panel')).not.toBeNull();
    expect(p.calls.onCloseShipment).not.toHaveBeenCalled();
  }, T);

  it('with every row removed the list says so and still offers Show all', () => {
    const p = setup();
    for (const name of p.names()) click(p.removeButton(name));
    expect(p.rows()).toHaveLength(0);
    expect(textOf(p.container.querySelector('.bw-empty__title')!)).toBe(LIST_ALL_REMOVED_TITLE);
    expect(textOf(p.container)).not.toContain('No deliveries yet');
    expect(textOf(p.removedLine()!)).toBe(`${ROW_COUNT} removed · Show all`);
    click(p.showAll()!);
    expect(p.rows()).toHaveLength(ROW_COUNT);
  }, T);

  it('the line also shows under "No deliveries match the filters"', () => {
    const p = setup();
    click(p.removeButton('Sample boxes'));
    p.unmount();
    const m = mount(
      <BusinessPageView
        state={ready()} shipmentId={null}
        createShipment={async () => { throw new Error('not called'); }}
        matchShipment={async () => { throw new Error('not called'); }}
        refetchNow={async () => {}} dismissRunChanged={() => {}} onOpenShipment={() => {}} onCloseShipment={() => {}}
        businessHref={(id) => `/nyc/business/${id}`}
        initialTable={{ ...INITIAL_TABLE, filters: { ...NO_FILTERS, query: 'zzz' } }}
      />,
    );
    expect(textOf(m.container.querySelector('.bw-empty__text')!)).toBe(`${ROW_COUNT - 1} deliveries in total.`);
    expect(textOf(m.container.querySelector('.bw-removed')!)).toBe('1 removed · Show all');
  }, T);
});

describe('focus after Remove and Show all (#949)', () => {
  it('goes to the Remove button of the row that took the removed row\'s place', () => {
    const p = setup();
    const [first, second] = p.names();
    click(p.removeButton(first));
    expect(document.activeElement).toBe(p.removeButton(second));
  }, T);

  it('goes to the row above after the last row, then to Show all, then to the list\'s heading', () => {
    const p = setup();
    const names = p.names();
    click(p.removeButton(names[names.length - 1]));
    expect(document.activeElement).toBe(p.removeButton(names[names.length - 2]));
    for (const name of names.slice(0, -1)) click(p.removeButton(name));
    expect(document.activeElement).toBe(p.showAll());
    click(p.showAll()!);
    expect(document.activeElement).toBe(p.container.querySelector('caption.bw-table__caption'));
  }, T);
});

describe('where the browser refuses storage (#949)', () => {
  it('Remove and Show all still work on the open page when writing throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const p = setup();
    click(p.removeButton('Sample boxes'));
    expect(p.names()).not.toContain('Sample boxes');
    expect(textOf(p.removedLine()!)).toBe('1 removed · Show all');
    click(p.showAll()!);
    expect(p.rows()).toHaveLength(ROW_COUNT);
  }, T);

  it('the page renders with every row when reading throws or the stored value is not ours', () => {
    for (const junk of ['{', 'null', '"shp-7"', '{"ids":"shp-7"}', '{"ids":[7,null,""]}', '[]']) {
      localStorage.setItem(hiddenKey(ACME.id), junk);
      expect(readHidden(ACME.id), junk).toBe(NO_HIDDEN);
    }
    const p = setup();
    expect(p.rows()).toHaveLength(ROW_COUNT);
    p.unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    expect(readHidden(ACME.id)).toBe(NO_HIDDEN);
    expect(setup().rows()).toHaveLength(ROW_COUNT);
  }, T);

  it('writeHidden never throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('no'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('no'); });
    expect(() => writeHidden(ACME.id, { runId: 'run-1', ids: ['shp-7'] })).not.toThrow();
    expect(() => writeHidden(ACME.id, NO_HIDDEN)).not.toThrow();
  });
});

describe('hidden IDs belong to one run (#949)', () => {
  it('a new run starts with nothing hidden: its shp-7 is another package', () => {
    const first = setup();
    click(first.removeButton('Sample boxes'));
    first.unmount();
    // "Start new planning cycle": run-2 numbers its deliveries from the start again.
    const next = setup(ready(DASHBOARD, 'run-2'));
    expect(next.rows()).toHaveLength(ROW_COUNT);
    expect(next.removedLine()).toBeNull();
    expect(localStorage.getItem(hiddenKey(ACME.id))).toBeNull();
  }, T);

  it('the run changing under the open page shows the rows again', () => {
    const p = setup();
    click(p.removeButton('Sample boxes'));
    p.poll(ready(DASHBOARD, 'run-2'));
    expect(p.rows()).toHaveLength(ROW_COUNT);
    expect(p.removedLine()).toBeNull();
  }, T);

  it('hiddenForRun keeps the same object when nothing changes', () => {
    const h = { runId: 'run-1', ids: ['shp-7'] };
    expect(hiddenForRun(h, 'run-1')).toBe(h);
    expect(hiddenForRun(h, null)).toBe(h); // the run is not known yet: nothing is thrown away
    expect(hiddenForRun(NO_HIDDEN, 'run-3')).toBe(NO_HIDDEN);
    expect(hiddenForRun(h, 'run-2')).toBe(NO_HIDDEN);
    // Hidden before the run was known: they count for the run that then arrives.
    expect(hiddenForRun({ runId: null, ids: ['shp-7'] }, 'run-2')).toEqual({ runId: 'run-2', ids: ['shp-7'] });
  });

  it('withHidden adds an ID once and keeps at most MAX_HIDDEN_IDS, the newest', () => {
    const one = withHidden(NO_HIDDEN, 'shp-1', 'run-1');
    expect(one).toEqual({ runId: 'run-1', ids: ['shp-1'] });
    expect(withHidden(one, 'shp-1', 'run-1')).toBe(one);
    let h = NO_HIDDEN;
    for (let i = 1; i <= MAX_HIDDEN_IDS + 5; i += 1) h = withHidden(h, `shp-${i}`, 'run-1');
    expect(h.ids).toHaveLength(MAX_HIDDEN_IDS);
    expect(h.ids[h.ids.length - 1]).toBe(`shp-${MAX_HIDDEN_IDS + 5}`);
    expect(h.ids).not.toContain('shp-1');
  });

  it('the key names the business', () => {
    expect(hiddenKey('biz-acme')).toBe(`${HIDDEN_KEY_PREFIX}biz-acme`);
  });
});

describe('tableModel with hidden IDs (#949)', () => {
  it('leaves the hidden rows out of the list and its counts, and says how many', () => {
    const all = tableModel(DASHBOARD, BUSINESSES, INITIAL_TABLE);
    expect(all.removed).toBe(0);
    expect(all.all).toHaveLength(ROW_COUNT);
    // An ID that is not in the dashboard hides nothing and is not counted.
    const m = tableModel(DASHBOARD, BUSINESSES, INITIAL_TABLE, new Set(['shp-7', 'shp-999']));
    expect(m.removed).toBe(1);
    expect(m.all.map((r) => r.id)).not.toContain('shp-7');
    expect(m.rows).toHaveLength(ROW_COUNT - 1);
    expect(m.counts.reduce((n, c) => n + c.count, 0)).toBe(ROW_COUNT - 1);
    expect(m.counts.find((c) => c.status === 'scheduled')!.count)
      .toBe(all.counts.find((c) => c.status === 'scheduled')!.count - 1);
  });
});

describe('Remove styles (#949)', () => {
  const css = readFileSync('client/src/components/business/v2/businessWorkspace.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  it('the target is 44 px square', () => {
    expect(rule('.bw-remove')).toMatch(/width: 44px;\s*height: 44px;/);
  });

  it('it is quiet until the pointer is on its row or the keyboard is in it', () => {
    expect(rule('.bw-remove')).toMatch(/opacity: 0\.45;/);
    expect(css).toContain('.bw-row:hover .bw-remove, .bw-row:focus-within .bw-remove { opacity: 1; }');
    expect(css).toMatch(/\.bw-remove:focus-visible \{[^}]*outline: 2px solid var\(--ns-ink, #0B0F17\);[^}]*opacity: 1;/);
    // No hover on a touch screen, and no room for one in the stacked cards: full strength there.
    expect(css).toMatch(/@media \(hover: none\) \{\s*\.bw-remove \{ opacity: 1; \}\s*\}/);
    const stacked = css.match(/@media \(max-width: 640px\) \{([\s\S]*)\}\s*$/)![1];
    expect(stacked).toMatch(/\.bw-remove \{[^}]*opacity: 1; \}/);
  });

  it('in the stacked cards it sits in the top right corner and prints no column label', () => {
    const stacked = css.match(/@media \(max-width: 640px\) \{([\s\S]*)\}\s*$/)![1];
    expect(stacked).toMatch(/\.bw-table td\.bw-cell--remove \{ position: absolute; top: 0; right: 0;/);
    expect(stacked).toContain('.bw-table td.bw-cell--remove::before { content: none; }');
    expect(stacked).toMatch(/\.bw-removed__show \{ min-height: 44px; \}/);
  });

  it('Show all has a focus style and nothing here moves', () => {
    expect(css).toMatch(/\.bw-removed__show:focus-visible \{ outline: 2px solid var\(--ns-ink, #0B0F17\);/);
    const mine = css.slice(css.indexOf('.bw-table th.bw-col--remove'), css.indexOf('.bw-visually-hidden'));
    expect(mine).not.toMatch(/transition|animation/);
  });
});
