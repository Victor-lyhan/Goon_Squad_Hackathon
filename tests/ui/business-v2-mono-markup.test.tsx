// @vitest-environment jsdom
// #742 (docs/mvp3.md P4, the two markup faults of PR #722): the price inside a notification sentence and the
// data of the New delivery hints are their own elements with the Business mono class, and the text of each
// sentence is what it was before (no extra space or punctuation). Read from the rendered DOM.
// That .ba-mono and .nd-mono are IBM Plex Mono is pinned by business-v2-mvp3-css.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NewDeliveryFormView } from '../../client/src/components/business/v2/NewDeliveryForm';
import { emptyDraft } from '../../client/src/components/business/v2/newDeliveryModel';
import { NotificationsList } from '../../client/src/components/business/v2/activity/NotificationsPanel';
import { messageParts, notificationRows } from '../../client/src/components/business/v2/activity/activityModel';
import { note, RECIPIENT, RELAY, SENDER, withNotes } from './business-v2-activity-sample';
import { BUSINESSES, ME } from './business-v2-table-sample';
import { byLabel, mount } from './kitDom';

const noop = () => {};
/** The text of each mono element inside `el`, in document order. */
const mono = (el: Element, cls: string) => [...el.querySelectorAll(`.${cls}`)].map((m) => m.textContent);

describe('messageParts', () => {
  const join = (message: string) => messageParts(message).map((p) => p.text).join('');

  it('cuts the server sentence at its price and leaves the full stop outside', () => {
    expect(messageParts('Delivery arranged: "Burrs" to Levain Bakery, $10.00.')).toEqual([
      { text: 'Delivery arranged: "Burrs" to Levain Bakery, ', mono: false },
      { text: '$10.00', mono: true },
      { text: '.', mono: false },
    ]);
  });

  it('gives the message back character for character', () => {
    for (const message of [
      SENDER.message, RECIPIENT.message, RELAY.message, '', '$10.00', '  $0.50  ', 'Was $1,234.50, now $999.00.',
      'New delivery job: "Keys". Collect from A and deliver to B. Reward $3.25.', 'No price here.',
    ]) expect(join(message)).toBe(message);
  });

  it('marks every price, with or without thousands separators', () => {
    const prices = (message: string) => messageParts(message).filter((p) => p.mono).map((p) => p.text);
    expect(prices('Was $1,234.50, now $999.00.')).toEqual(['$1,234.50', '$999.00']);
    expect(prices('$10.00')).toEqual(['$10.00']);
    expect(prices('To Levain Bakery, $1234.50.')).toEqual(['$1234.50']);
  });

  it('marks nothing that is not a price in dollars and cents', () => {
    for (const message of ['No price here.', 'Costs $5 today.', 'Room 10.00 on floor 2.', '$10.005', '$.50', '']) {
      expect(messageParts(message).filter((p) => p.mono), message).toEqual([]);
    }
    expect(messageParts('')).toEqual([]);
  });
});

describe('a notification sentence (span.ba-note__msg)', () => {
  const LEVAIN = note('ntf-plan-shp-1-biz-acme', 4, {
    message: 'Delivery arranged: "Navy Yard grinder burrs" to Levain Bakery via Strand Book Store (relay point), $10.00.',
  });
  const list = (notes: Parameters<typeof withNotes>[0]) => {
    const rows = notificationRows(withNotes(notes), BUSINESSES, new Set(notes.map((n) => n.id)));
    const { container } = mount(<NotificationsList rows={rows} showAll={false} onShowAll={noop} onOpen={noop} />);
    return [...container.querySelectorAll('.ba-note')];
  };

  it('holds the price in its own .ba-mono element, and reads as the server sent it', () => {
    const [item] = list([LEVAIN]);
    const msg = item.querySelector('span.ba-note__msg')!;
    expect(msg.textContent).toBe(LEVAIN.message);
    expect(mono(msg, 'ba-mono')).toEqual(['$10.00']);
    const price = msg.querySelector('.ba-mono')!;
    expect(price.tagName).toBe('SPAN');
    expect(price.parentElement).toBe(msg);
    // The words around the price are plain text of the sentence, not elements.
    expect(msg.children).toHaveLength(1);
    expect(price.previousSibling?.textContent).toMatch(/\(relay point\), $/);
    expect(price.nextSibling?.textContent).toBe('.');
  });

  it('keeps the row button\'s accessible name: the whole sentence, the ready time, then the delivery to open', () => {
    const [item] = list([SENDER]);
    expect(item.querySelector('button')!.getAttribute('aria-label')).toBe(`${SENDER.message} Ready 5:00 PM. Open delivery shp-1`);
    expect(item.querySelector('.ba-note__msg')!.textContent).toBe(SENDER.message);
    expect(mono(item, 'ba-mono')).toEqual(['$12.50']);
  });

  it('a sentence without a price has no mono element', () => {
    for (const item of list([RECIPIENT, RELAY])) {
      const msg = item.querySelector('.ba-note__msg')!;
      expect(msg.children).toHaveLength(0);
      expect([RECIPIENT.message, RELAY.message]).toContain(msg.textContent);
    }
  });
});

describe('the New delivery hints (p.nd-hint)', () => {
  const form = (window?: { startMin: number; endMin: number }) => mount(
    <NewDeliveryFormView origin={ME} businesses={BUSINESSES} phase="planning" window={window}
      draft={emptyDraft()} errors={{}} status={{ kind: 'idle' }}
      onChange={noop} onSubmit={noop} onOpenDelivery={noop} onCancel={noop} />,
  ).container;
  const hint = (c: Element, start: string) => {
    const found = [...c.querySelectorAll('p.nd-hint')].filter((p) => p.textContent!.startsWith(start));
    expect(found, start).toHaveLength(1);
    return found[0];
  };

  it('"Simulation window" puts its two times in .nd-mono spans, with the sentence unchanged', () => {
    const p = hint(form(), 'Simulation window');
    expect(p.textContent).toBe('Simulation window: Day 1, 3:30 PM to Day 2, 12:00 PM.');
    expect(mono(p, 'nd-mono')).toEqual(['Day 1, 3:30 PM', 'Day 2, 12:00 PM']);
    expect([...p.children].map((e) => e.tagName)).toEqual(['SPAN', 'SPAN']);
  });

  it('shows the window the page was given', () => {
    const p = hint(form({ startMin: 1000, endMin: 2000 }), 'Simulation window');
    expect(p.textContent).toBe('Simulation window: Day 1, 4:40 PM to Day 2, 9:20 AM.');
    expect(mono(p, 'nd-mono')).toEqual(['Day 1, 4:40 PM', 'Day 2, 9:20 AM']);
  });

  it('"Up to 2 kg" puts the weight in a .nd-mono span and still describes the weight input', () => {
    const c = form();
    const p = hint(c, 'Up to');
    expect(p.textContent).toBe('Up to 2 kg');
    expect(mono(p, 'nd-mono')).toEqual(['2 kg']);
    expect(byLabel(c, 'Weight (kg)').getAttribute('aria-describedby')).toBe(p.id);
  });

  it('a time or weight in a hint never breaks in the middle (390 px: "Day 2," / "12:00 PM")', () => {
    const css = readFileSync('client/src/components/business/v2/newDelivery.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.nd-hint \.nd-mono\s*\{\s*white-space:\s*nowrap;\s*\}/);
  });

  it('a hint with no data has no mono span', () => {
    const p = hint(form(), 'Any business');
    expect(p.textContent).toBe('Any business in the network');
    expect(p.children).toHaveLength(0);
  });
});
