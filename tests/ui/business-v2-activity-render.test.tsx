import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BusinessHeader } from '../../client/src/components/business/v2/activity/BusinessHeader';
import {
  NotificationItem, NotificationsList, NotificationsPanel,
} from '../../client/src/components/business/v2/activity/NotificationsPanel';
import { notificationRows, type NotificationRow } from '../../client/src/components/business/v2/activity/activityModel';
import { BUSINESSES, DASHBOARD } from './business-v2-table-sample';
import { many, RECIPIENT, RELAY, SENDER, withNotes } from './business-v2-activity-sample';

const DIR = 'client/src/components/business/v2/activity';
const noop = () => {};
const panel = (n: Parameters<typeof withNotes>[0], onOpen: (id: string) => void = noop) =>
  renderToStaticMarkup(<NotificationsPanel dashboard={withNotes(n)} businesses={BUSINESSES} onOpenShipment={onOpen} />);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('BusinessHeader', () => {
  it('renders the sample business, its role, phase and totals', () => {
    const html = renderToStaticMarkup(<BusinessHeader dashboard={DASHBOARD} />);
    expect(html).toMatch(/<h1[^>]*>Acme Studio<\/h1>/);
    expect(html).toContain('biz-acme');
    expect(html).toContain('1 Test St');
    expect(html).toContain('Midtown · Manhattan');
    expect(html).toContain('Network business · relay point');
    expect(html).toContain('Planning');
    expect(html).toContain('$30.50');
    expect(html).toContain('3 sent · 2 matched · 1 delivered · $30.50 spend');
    expect(html).not.toMatch(/NaN|undefined/);
  });
});

describe('NotificationsPanel', () => {
  it('shows the empty state with 0 notifications', () => {
    const html = panel([]);
    expect(html).toContain('No notifications yet.');
    expect(html).not.toContain('<li');
    expect(html).not.toContain('Show all');
  });

  it('shows 3 notifications newest first with the relay tag on one', () => {
    const html = panel([SENDER, RECIPIENT, RELAY]);
    expect(count(html, /<li /g)).toBe(3);
    expect(html.indexOf('Overnight drop')).toBeLessThan(html.indexOf('Incoming delivery'));
    expect(html.indexOf('Incoming delivery')).toBeLessThan(html.indexOf('Delivery arranged'));
    expect(count(html, /class="ba-note__tag">Relay point</g)).toBe(1);
    expect(count(html, /<button type="button" class="ba-note__btn"/g)).toBe(3);
    // First load flags nothing as New (DECISIONS pass 9).
    expect(html).not.toContain('class="ba-note__new"');
    expect(html).not.toContain('Show all');
  });

  it('shows 20 of 25 notifications with "Show all (25)", then all of them', () => {
    const html = panel(many(25));
    expect(count(html, /<li /g)).toBe(20);
    expect(html).toContain('Show all (25)');
    const rows = notificationRows(withNotes(many(25)), BUSINESSES, new Set());
    const all = renderToStaticMarkup(<NotificationsList rows={rows} showAll onShowAll={noop} onOpen={noop} />);
    expect(count(all, /<li /g)).toBe(25);
    expect(all).not.toContain('Show all');
  });

  it('"Show all" calls onShowAll', () => {
    let clicked = 0;
    const rows = notificationRows(withNotes(many(25)));
    type El = { type: unknown; props: Record<string, unknown> };
    const tree = NotificationsList({ rows, showAll: false, onShowAll: () => { clicked += 1; }, onOpen: noop }) as unknown as El;
    const more = (tree.props.children as El[])[2];
    (more.props.onClick as () => void)();
    expect(clicked).toBe(1);
  });

  it('clicking a row calls onOpenShipment with the shipment ID', () => {
    // Static render cannot click; call the element tree's handler directly.
    const opened: string[] = [];
    const rows = notificationRows(withNotes([RELAY]), BUSINESSES, new Set());
    type El = { type: unknown; props: Record<string, unknown> };
    const li = NotificationItem({ row: rows[0], onOpen: (r: NotificationRow) => opened.push(r.shipmentId!) }) as unknown as El;
    const btn = li.props.children as El;
    expect(btn.type).toBe('button');
    (btn.props.onClick as () => void)();
    expect(opened).toEqual(['shp-9']);
  });

  it('marks a new row and renders a row without a shipment as plain text', () => {
    const row: NotificationRow = {
      id: 'ntf-x', time: '—', message: 'No shipment here.', role: 'other', tag: null, shipmentId: null, isNew: true,
    };
    const html = renderToStaticMarkup(<NotificationsList rows={[row]} showAll={false} onShowAll={noop} onOpen={noop} />);
    expect(html).toContain('class="ba-note__new">New<');
    expect(html).not.toContain('<button');
  });
});

describe('activity folder', () => {
  const files = readdirSync(DIR);
  const css = readFileSync(`${DIR}/activity.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('has no user-facing "hub" anywhere', () => {
    for (const f of files) {
      const src = readFileSync(`${DIR}/${f}`, 'utf8');
      expect(src.toLowerCase(), f).not.toContain('hub');
    }
    const html = panel([SENDER, RECIPIENT, RELAY]) + renderToStaticMarkup(<BusinessHeader dashboard={DASHBOARD} />);
    expect(html.toLowerCase()).not.toContain('hub');
  });

  it('CSS has no fixed width above 390 px', () => {
    for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:min-|max-)?width|flex-basis|flex):\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px), `${prop}: ${value}`).toBeLessThanOrEqual(390);
    }
    for (const [, px] of css.matchAll(/grid-template-columns:[^;]*?(\d+)px/g)) expect(Number(px)).toBeLessThanOrEqual(390);
  });

  it('CSS uses only token colors (with fallbacks), no radius over 4 px, no shadows', () => {
    const noVars = css.replace(/var\(--[a-z0-9-]+,\s*[^()]*(?:\([^()]*\))?[^()]*\)/g, 'TOKEN');
    expect(noVars).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(noVars).not.toMatch(/rgba?\(|hsla?\(/i);
    expect(noVars).not.toMatch(/:\s*(white|black|red|blue|green|gray|grey)\b/i);
    expect(css).not.toMatch(/var\(--[a-z0-9-]+\)/); // every token has a fallback
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+)px/g)) expect(Number(px)).toBeLessThanOrEqual(4);
    }
    expect(css).not.toMatch(/box-shadow|gradient/);
  });

  it('uses IBM Plex Mono for the ID and numbers', () => {
    expect(css).toMatch(/\.ba-header__id,[\s\S]*?\.ba-totals__value,[\s\S]*?font-family: var\(--font-mono, 'IBM Plex Mono'/);
  });
});
