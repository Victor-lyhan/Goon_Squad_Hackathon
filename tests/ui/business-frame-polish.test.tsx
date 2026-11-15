// @vitest-environment jsdom
// The Business page frame after its design audit (#892): the header's one hierarchy, the notifications
// panel's plain words (empty state, the relay-point row, the row's action), the polite announcement of a
// notification that arrives, and the Tab order of the one-column page, where the open delivery is shown
// above the table and so comes before it in the document. The sentences of the server are listed in the
// PR and not changed here; a row shows them character for character.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BusinessDashboard, ShipmentResponse } from '../../shared/v2/api';
import type { Notification } from '../../shared/v2/types';
import { BusinessHeader } from '../../client/src/components/business/v2/activity/BusinessHeader';
import { NotificationsPanel } from '../../client/src/components/business/v2/activity/NotificationsPanel';
import {
  EMPTY_TEXT, RELAY_TAG, ROLE_LINE, arrivalText, hasTime, headerModel, notificationRows, rowName,
} from '../../client/src/components/business/v2/activity/activityModel';
import { BusinessPageView, type BusinessPageViewProps } from '../../client/src/components/business/v2/page/BusinessPageView';
import {
  ERROR_FALLBACK_TEXT, STACKED_MAX_WIDTH_PX, STACKED_QUERY, heldHereText, pageScreen,
} from '../../client/src/components/business/v2/page/businessPageModel';
import {
  initialBusinessWorkspaceState, type BusinessWorkspaceState,
} from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { RECIPIENT, RELAY, SENDER, note, withNotes } from './business-v2-activity-sample';
import { ATLAS, ready } from './business-v2-page-sample';
import { BUSINESSES, DASHBOARD } from './business-v2-table-sample';
import { button, click, mount, tabOrder, textOf } from './kitDom';

const ACTIVITY = 'client/src/components/business/v2/activity';
const PAGE = 'client/src/components/business/v2/page';
const css = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const noop = () => {};
const never = async (): Promise<ShipmentResponse> => { throw new Error('not called'); };

/** The words the backlog names as jargon (QUESTIONS 23:01, item 6), and raw units a reader should not meet. */
const JARGON = /\bhubs?\b|\btrip ?ids?\b|\bread-only\b|\bpayload\b|\bendpoint\b|undefined|NaN/i;

/** The server's sentence for the business that holds a package overnight (server/api/v2/pipeline.ts). */
const SERVER_RELAY = note('ntf-plan-shp-9-biz-acme', 5, {
  shipmentId: 'shp-9', planId: 'plan-shp-9',
  message: 'Relay point: "Prints" from Print Shop to Bakery Row is dropped here in the evening and collected the next morning.',
});

function panel(notifications: Notification[], over: Partial<BusinessDashboard> = {}) {
  const opened: string[] = [];
  const el = (list: Notification[], o: Partial<BusinessDashboard> = over) => (
    <NotificationsPanel dashboard={withNotes(list, o)} businesses={BUSINESSES} onOpenShipment={(id) => opened.push(id)} />
  );
  const m = mount(el(notifications));
  const c = m.container;
  return {
    ...m, opened,
    poll: (list: Notification[], o?: Partial<BusinessDashboard>) => m.rerender(el(list, o)),
    live: () => c.querySelector('.ba-notes__live')!,
    notes: () => [...c.querySelectorAll('li.ba-note')],
    marks: () => [...c.querySelectorAll('.ba-note__new')],
  };
}

describe('header: one hierarchy, plain words', () => {
  const header = () => mount(<BusinessHeader dashboard={DASHBOARD} />).container.querySelector('header.ba-header')!;

  it('the name is the one heading; the lines under it come in reading order', () => {
    const h = header();
    expect([...h.querySelectorAll('h1, h2, h3')].map(textOf)).toEqual(['Acme Studio']);
    const main = h.querySelector('.ba-header__main')!;
    expect([...main.children].map((el) => el.className)).toEqual([
      'ba-header__who', 'ba-header__place', 'ba-header__phase', 'ba-header__role',
    ]);
    expect(textOf(main.querySelector('.ba-header__phase')!)).toBe('PlanningDeliveries can be added until the simulation starts.');
    // The totals are the block beside (or under) it, not a line inside it.
    expect(h.lastElementChild!.className).toBe('ba-totals');
    expect(h.querySelector('.ba-totals')!.getAttribute('aria-label')).toBe('Totals: 3 sent · 2 matched · 1 delivered · $30.50 spend');
  });

  it('says what "relay point" means here as a sentence, not as a label', () => {
    expect(ROLE_LINE).toBe('This business is also a relay point: packages can be held here overnight.');
    expect(textOf(header().querySelector('p.ba-header__role')!)).toBe(ROLE_LINE);
    expect(ROLE_LINE).not.toContain('·');
  });

  it('repeats nothing for a pointer or a screen reader: no tooltip, no name on the plain <header>', () => {
    const h = header();
    expect(h.querySelectorAll('[title]')).toHaveLength(0);
    expect(h.hasAttribute('aria-label')).toBe(false);
  });

  it('the locked line says what cannot be done, in plain words', () => {
    const locked = headerModel({ ...DASHBOARD, phase: 'locked' });
    expect(locked.phaseLabel).toBe('Locked');
    expect(locked.phaseText).toBe('The simulation is running, so deliveries cannot be added or changed.');
    for (const phase of ['planning', 'locked'] as const) {
      const m = headerModel({ ...DASHBOARD, phase });
      expect(`${m.role} ${m.phaseLabel} ${m.phaseText}`).not.toMatch(JARGON);
    }
  });

  it('only the name is strong; the role line is quiet and the phase sentence is ink', () => {
    const sheet = css(`${ACTIVITY}/activity.css`);
    // Since #956 the name is the page's largest text, in the heading face.
    expect(sheet).toMatch(/\.ba-header__name \{[^}]*font-family: var\(--ns-display, [^}]*font-size: var\(--ns-size-name, 40px\);[^}]*font-weight: 600;/);
    const quiet = sheet.match(/\.ba-header__place,\s*\.ba-header__phase,\s*\.ba-header__role \{([^}]*)\}/)![1];
    expect(quiet).toMatch(/color: var\(--ns-muted, #5A5F6B\);/);
    expect(quiet).not.toMatch(/font-weight/);
    expect(sheet).toMatch(/\.ba-header__phase-text \{ color: var\(--ns-text, #14171F\); \}/);
    // The totals wrap under the block by themselves when the row is too narrow: no breakpoint, no fixed width.
    expect(sheet).toMatch(/\.ba-header \{[^}]*flex-wrap: wrap;[^}]*justify-content: space-between;/);
    expect(sheet).toMatch(/\.ba-header__main \{[^}]*flex: 1 1 320px;[^}]*min-width: 0;/);
  });
});

describe('notifications: empty state', () => {
  it('says what will show up here, in a sentence that is true while planning and while locked', () => {
    expect(EMPTY_TEXT).toBe('No notifications yet. Deliveries you send, receive or hold overnight show up here.');
    for (const phase of ['planning', 'locked'] as const) {
      const p = panel([], { phase });
      expect(textOf(p.container.querySelector('p.ba-notes__empty')!)).toBe(EMPTY_TEXT);
      expect(p.notes()).toHaveLength(0);
      expect(textOf(p.container.querySelector('h2')!)).toBe('Notifications 0');
      p.unmount();
    }
    expect(EMPTY_TEXT).not.toMatch(JARGON);
  });
});

describe('notifications: a row in plain words', () => {
  it('the relay-point row: "Held here overnight", then the server\'s sentence once, no dash for an unknown time', () => {
    const p = panel([SERVER_RELAY]);
    const [row] = p.notes();
    expect(RELAY_TAG).toBe('Held here overnight');
    expect(textOf(row.querySelector('.ba-note__tag')!)).toBe(RELAY_TAG);
    // The same words open the line above the delivery's details, so the click lands where the tag said.
    expect(heldHereText(ATLAS.name).startsWith(`${RELAY_TAG}: `)).toBe(true);
    expect(row.querySelector('.ba-note__msg')!.textContent).toBe(SERVER_RELAY.message);
    // "Relay point" is the server's word, said once: the tag no longer repeats it in front.
    expect(textOf(row).match(/Relay point/g)).toHaveLength(1);
    expect(row.querySelector('.ba-note__time')).toBeNull();
    expect(row.querySelector('.ba-note__ready')).toBeNull();
    expect(textOf(row)).not.toContain('—');
    expect(textOf(row)).not.toMatch(JARGON);
    expect(row.querySelector('button')!.getAttribute('aria-label')).toBe(
      `Held here overnight. ${SERVER_RELAY.message} Open delivery shp-9`,
    );
  });

  it('a known time is named: it is the package\'s ready time, not when the notification came', () => {
    const p = panel([SENDER]);
    const [row] = p.notes();
    expect(textOf(row.querySelector('.ba-note__ready')!)).toBe('Ready 5:00 PM');
    expect(textOf(row.querySelector('.ba-note__time')!)).toBe('5:00 PM');
    const [model] = notificationRows(withNotes([SENDER]), BUSINESSES);
    expect(hasTime(model)).toBe(true);
    expect(hasTime({ time: '—' })).toBe(false);
  });

  it('the action is words, then the delivery\'s ID; the button\'s name holds every word the row shows', () => {
    const p = panel([SENDER, RECIPIENT, RELAY]);
    for (const row of p.notes()) {
      const btn = row.querySelector('button')!;
      const id = textOf(row.querySelector('.ba-note__open')!);
      expect(id).toMatch(/^shp-\d+$/);
      expect(textOf(row.querySelector('.ba-note__action')!)).toBe(`Open delivery ${id}`);
      const name = btn.getAttribute('aria-label')!;
      expect(name.endsWith(`Open delivery ${id}`)).toBe(true);
      // Every text the row shows is in the name, in the same order.
      let at = -1;
      for (const part of [...row.querySelectorAll('.ba-note__new, .ba-note__tag, .ba-note__msg, .ba-note__ready, .ba-note__action')].map(textOf)) {
        const found = name.indexOf(part, at + 1);
        expect(found, `"${part}" in "${name}"`).toBeGreaterThan(at);
        at = found;
      }
    }
    const rows = notificationRows(withNotes([SENDER]), BUSINESSES, new Set([SENDER.id]));
    expect(rowName(rows[0])).toBe(`${SENDER.message} Ready 5:00 PM. Open delivery shp-1`);
    expect(rowName({ ...rows[0], isNew: true, tag: RELAY_TAG, time: '—' })).toBe(
      `New. Held here overnight. ${SENDER.message} Open delivery shp-1`,
    );
  });

  it('a click opens the delivery; the rows and "Show all" are the panel\'s tab stops, in the order shown', () => {
    const many = Array.from({ length: 22 }, (_, i) => note(`ntf-${String(i + 1).padStart(3, '0')}`, i + 1));
    const p = panel(many);
    const stops = tabOrder(p.container);
    expect(stops).toHaveLength(21);
    expect(stops.slice(0, 20)).toEqual(p.notes().map((row) => row.querySelector('button')));
    expect(textOf(stops[20])).toBe('Show all (22)');
    click(stops[0]);
    expect(p.opened).toEqual(['shp-1']);
    click(button(p.container, 'Show all (22)'));
    expect(p.notes()).toHaveLength(22);
  });
});

describe('notifications: a new one is announced politely, once', () => {
  it('the live region is in the page from the first render, and empty: the first load announces nothing', () => {
    for (const list of [[], [SENDER, RECIPIENT]]) {
      const p = panel(list);
      const live = p.live();
      expect(live.getAttribute('aria-live')).toBe('polite');
      expect(live.getAttribute('role')).toBe('status');
      expect(live.textContent).toBe('');
      expect(p.marks()).toHaveLength(0);
      // The only live region of the panel: a row is not one, so a poll does not read the whole list again.
      expect(p.container.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(1);
      p.unmount();
    }
  });

  it('one arrival is read in full; the same element gets the text', () => {
    const p = panel([SENDER]);
    const live = p.live();
    p.poll([SENDER, RECIPIENT]);
    expect(p.live()).toBe(live);
    expect(live.textContent).toBe(`New notification: ${RECIPIENT.message}`);
    expect(p.marks()).toHaveLength(1);
    expect(textOf(p.notes()[0])).toContain(RECIPIENT.message);
  });

  it('a poll with nothing new, and opening the new row, do not announce again', () => {
    const p = panel([SENDER]);
    p.poll([SENDER, RECIPIENT]);
    const said = p.live().textContent;
    const changes: string[] = [];
    const seen = new MutationObserver((records) => { for (const r of records) changes.push(r.type); });
    seen.observe(p.live(), { childList: true, characterData: true, subtree: true });
    p.poll([SENDER, RECIPIENT]);
    p.poll([{ ...SENDER }, { ...RECIPIENT }]);
    click(p.notes()[0].querySelector('button')!);
    expect(p.opened).toEqual(['shp-4']);
    expect(p.marks()).toHaveLength(0);
    expect(seen.takeRecords()).toHaveLength(0);
    seen.disconnect();
    expect(changes).toEqual([]);
    expect(p.live().textContent).toBe(said);
  });

  it('several at once are counted and the newest is read; a held package is named as one', () => {
    const p = panel([SENDER]);
    p.poll([SENDER, RECIPIENT, SERVER_RELAY]);
    expect(p.live().textContent).toBe(`2 new notifications. Newest: Held here overnight. ${SERVER_RELAY.message}`);
    expect(p.marks()).toHaveLength(2);
    // The next arrival replaces the sentence.
    const later = note('ntf-later', 9, { message: 'Delivery arranged: "Keys" to Bakery Row, $9.50.' });
    p.poll([SENDER, RECIPIENT, SERVER_RELAY, later]);
    expect(p.live().textContent).toBe(`New notification: ${later.message}`);
  });

  it('the first notification of an empty panel is announced too', () => {
    const p = panel([]);
    p.poll([SENDER]);
    expect(p.live().textContent).toBe(`New notification: ${SENDER.message}`);
    expect(p.container.querySelector('.ba-notes__empty')).toBeNull();
  });

  it('another business starts clean: nothing is "New" and nothing is read', () => {
    const p = panel([SENDER]);
    p.poll([SENDER, RECIPIENT]);
    expect(p.live().textContent).not.toBe('');
    const other = { ...DASHBOARD.business, id: 'biz-bakery', name: 'Bakery Row' };
    const theirs = [RECIPIENT, RELAY].map((n) => ({ ...n, audienceId: other.id }));
    p.poll(theirs, { business: other });
    expect(p.notes()).toHaveLength(2);
    expect(p.live().textContent).toBe('');
    expect(p.marks()).toHaveLength(0);
  });

  it('the sentence itself', () => {
    const rows = notificationRows(withNotes([SENDER, RECIPIENT, SERVER_RELAY]), BUSINESSES);
    expect(arrivalText([])).toBe('');
    expect(arrivalText(rows.slice(2))).toBe(`New notification: ${SENDER.message}`);
    expect(arrivalText(rows)).toBe(`3 new notifications. Newest: Held here overnight. ${SERVER_RELAY.message}`);
    expect(arrivalText(rows)).not.toMatch(JARGON);
  });

  it('the live region is read, not shown, and takes no room', () => {
    const sheet = css(`${ACTIVITY}/activity.css`);
    const rule = sheet.match(/\.ba-notes__live \{([^}]*)\}/)![1];
    for (const decl of ['position: absolute;', 'width: 1px;', 'height: 1px;', 'overflow: hidden;', 'clip: rect(0 0 0 0);', 'white-space: nowrap;']) {
      expect(rule).toContain(decl);
    }
    // Hidden by clipping: display:none or visibility:hidden would take it away from a screen reader.
    expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    expect(sheet).toMatch(/\.ba-notes \{[^}]*position: relative;/);
  });
});

describe('notifications: layout and focus', () => {
  const sheet = css(`${ACTIVITY}/activity.css`);

  it('a row is one column that starts at the heading\'s left edge: no time column, no side padding', () => {
    const row = sheet.match(/\.ba-note__btn,\s*\.ba-note__static \{([^}]*)\}/)![1];
    expect(row).toMatch(/display: flex;\s*flex-direction: column;/);
    expect(row).toMatch(/padding: var\(--space-2, 8px\) 0;/);
    expect(sheet).not.toMatch(/grid-template-columns/);
    expect(sheet).toMatch(/\.ba-note__foot \{[^}]*flex-wrap: wrap;/);
    expect(sheet).toMatch(/\.ba-note__text \{[^}]*overflow-wrap: anywhere;/);
  });

  it('every control has a visible focus ring, and "Show all" is a finger-sized button at 390 px', () => {
    for (const sel of ['.ba-note__btn:focus-visible', '.ba-notes__more:focus-visible']) {
      const rule = sheet.match(new RegExp(`${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))![1];
      expect(rule, sel).toMatch(/outline: 2px solid var\(--ns-ink, #0B0F17\);/); // an ink ring on paper (#956)
      expect(rule, sel).toMatch(/outline-offset: 2px;/);
    }
    expect(sheet).not.toMatch(/outline:\s*(none|0)\b/);
    expect(sheet).toMatch(/\.ba-notes__more \{[^}]*min-height: 36px;/);
    const phone = sheet.match(/@media \(max-width: 390px\) \{([\s\S]*?)\n\}/)![1];
    expect(phone).toMatch(/\.ba-notes__more \{ width: 100%; min-height: 44px; \}/);
  });
});

// ---------- The page around them ----------

type Media = { matches: boolean; listeners: Set<() => void> };

/** A `window.matchMedia` the test can flip, for the page's one-column query only. */
function stubMedia(matches: boolean): { set: (next: boolean) => void; queries: string[] } {
  const media: Media = { matches, listeners: new Set() };
  const queries: string[] = [];
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => {
    queries.push(query);
    return {
      get matches() { return media.matches; },
      media: query,
      addEventListener: (_: string, fn: () => void) => { media.listeners.add(fn); },
      removeEventListener: (_: string, fn: () => void) => { media.listeners.delete(fn); },
    };
  };
  return {
    queries,
    set: (next) => { act(() => { media.matches = next; for (const fn of [...media.listeners]) fn(); }); },
  };
}

afterEach(() => { delete (window as unknown as { matchMedia?: unknown }).matchMedia; });

function page(state: BusinessWorkspaceState, p: Partial<BusinessPageViewProps> = {}) {
  const m = mount(
    <BusinessPageView
      state={state} shipmentId={null} createShipment={never} matchShipment={never} refetchNow={async () => {}}
      dismissRunChanged={noop} onOpenShipment={noop} onCloseShipment={noop}
      businessHref={(id) => `/business/${id}`} {...p}
    />,
  );
  const c = m.container;
  /** Which part of the page a tab stop is in. */
  const partOf = (el: Element) => (el.closest('.bp-details') ? 'details' : el.closest('.ba-notes') ? 'notifications' : el.closest('.bp-main') ? 'deliveries' : 'other');
  return {
    ...m,
    /** The parts in the order Tab meets them, each once. */
    tabParts: () => tabOrder(c).map(partOf).filter((part, i, all) => part !== all[i - 1]),
    /** The parts in document order, which is the order the one-column layout shows them in. */
    parts: () => [...c.querySelectorAll('.bp-details, .bp-main, .ba-notes')].map((el) => el.className.split(' ')[0]),
    aside: () => c.querySelector('aside.bp-side')!,
  };
}

describe('page layout: Tab follows what the eye sees', () => {
  it('two columns (and wherever the width cannot be asked): deliveries, then the open delivery, then notifications', () => {
    for (const media of [null, false]) {
      if (media !== null) stubMedia(media);
      const p = page(ready(), { shipmentId: 'shp-7' });
      expect(p.parts()).toEqual(['bp-main', 'bp-details', 'ba-notes']);
      expect(p.tabParts()).toEqual(['deliveries', 'details', 'notifications']);
      expect(p.aside().getAttribute('aria-label')).toBe('Delivery details and notifications');
      expect(p.aside().querySelector('.bp-details')).not.toBeNull();
      p.unmount();
    }
  });

  it('one column: the open delivery is shown first, so it is first in the document and first for Tab', () => {
    const media = stubMedia(true);
    const p = page(ready(), { shipmentId: 'shp-7' });
    expect(media.queries.every((q) => q === STACKED_QUERY)).toBe(true);
    expect(p.parts()).toEqual(['bp-details', 'bp-main', 'ba-notes']);
    expect(p.tabParts()).toEqual(['details', 'deliveries', 'notifications']);
    // One copy of the details, outside the aside, which now holds the notifications only.
    expect(p.container.querySelectorAll('.bp-details')).toHaveLength(1);
    expect(p.aside().querySelector('.bp-details')).toBeNull();
    expect(p.aside().hasAttribute('aria-label')).toBe(false);
    expect(p.aside().querySelector('section.ba-notes')).not.toBeNull();
    expect(p.container.querySelector('.bp-details')!.parentElement!.className).toBe('bp-layout bp-layout--open');
  });

  it('one column with no delivery open: deliveries, then notifications; nothing empty in front', () => {
    stubMedia(true);
    const p = page(ready());
    expect(p.parts()).toEqual(['bp-main', 'ba-notes']);
    expect(p.tabParts()).toEqual(['deliveries', 'notifications']);
  });

  it('follows the window when it is resized across the width', () => {
    const media = stubMedia(false);
    const p = page(ready(), { shipmentId: 'shp-8' });
    expect(p.parts()).toEqual(['bp-main', 'bp-details', 'ba-notes']);
    media.set(true);
    expect(p.parts()).toEqual(['bp-details', 'bp-main', 'ba-notes']);
    media.set(false);
    expect(p.parts()).toEqual(['bp-main', 'bp-details', 'ba-notes']);
  });

  it('the page asks about the same width the stylesheet stacks at', () => {
    expect(STACKED_QUERY).toBe(`(max-width: ${STACKED_MAX_WIDTH_PX}px)`);
    const sheet = css(`${PAGE}/businessPage.css`);
    const stacked = [...sheet.matchAll(/@media \(max-width: (\d+)px\) \{\s*\.bp-layout, \.bp-layout--open \{ display: flex; flex-direction: column; \}/g)];
    expect(stacked.map((m) => Number(m[1]))).toEqual([STACKED_MAX_WIDTH_PX]);
  });
});

describe('page states in plain words', () => {
  it('loading is one polite line', () => {
    const p = page(initialBusinessWorkspaceState);
    const line = p.container.querySelector('.bp-state')!;
    expect(line.getAttribute('role')).toBe('status');
    expect(textOf(line)).toBe('Loading your workspace…');
    expect(tabOrder(p.container)).toHaveLength(0);
  });

  it('a failure with no sentence of its own says what happened and what to do, never "Request failed"', () => {
    expect(pageScreen({ ...initialBusinessWorkspaceState, view: 'error', error: null }, null)).toEqual({ kind: 'error', text: ERROR_FALLBACK_TEXT });
    expect(ERROR_FALLBACK_TEXT).toBe('The Relay server did not answer. Check that it is running, then try again.');
    let asked = 0;
    const p = page({ ...initialBusinessWorkspaceState, view: 'error', error: null }, { refetchNow: async () => { asked += 1; } });
    const box = p.container.querySelector('.bp-state')!;
    expect(box.getAttribute('role')).toBe('alert');
    expect(textOf(box.querySelector('h1')!)).toBe('The workspace could not be loaded');
    expect(textOf(box)).toContain(ERROR_FALLBACK_TEXT);
    expect(textOf(box)).not.toMatch(/request failed/i);
    expect(textOf(box)).not.toMatch(JARGON);
    // The one tab stop is the way out.
    expect(tabOrder(p.container).map(textOf)).toEqual(['Retry']);
    click(button(p.container, 'Retry'));
    expect(asked).toBe(1);
    // The server's own sentence wins when there is one.
    expect(pageScreen({ ...initialBusinessWorkspaceState, view: 'error', error: 'The city is being rebuilt.' }, null))
      .toEqual({ kind: 'error', text: 'The city is being rebuilt.' });
  });

  it('the whole ready page, with a delivery open, has none of the backlog\'s jargon in text or in a control\'s name', () => {
    for (const shipmentId of [null, 'shp-7', 'shp-8']) {
      const p = page(ready(), { shipmentId });
      const frame = [p.container.querySelector('header.ba-header')!, p.container.querySelector('section.ba-notes')!];
      for (const el of frame) {
        expect(textOf(el)).not.toMatch(JARGON);
        for (const named of el.querySelectorAll('[aria-label]')) expect(named.getAttribute('aria-label')).not.toMatch(JARGON);
      }
      p.unmount();
    }
  });

  it('at 390 px the buttons of the page states are finger-sized', () => {
    const sheet = css(`${PAGE}/businessPage.css`);
    const phone = sheet.match(/@media \(max-width: 390px\) \{([\s\S]*?)\n\}/)![1];
    expect(phone).toMatch(/\.bp-links \.bp-btn, \.bp-state > \.bp-btn \{ width: 100%; min-height: 44px; \}/);
  });
});
