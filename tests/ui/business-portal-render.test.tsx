import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import BusinessPortal from '../../client/src/pages/BusinessPortal';
import { SummaryCards } from '../../client/src/components/business/SummaryCards';
import { NotificationList } from '../../client/src/components/business/NotificationList';

describe('business portal rendering', () => {
  it('shows a loading state before data arrives', () => {
    const html = renderToStaticMarkup(<MemoryRouter><BusinessPortal /></MemoryRouter>);
    expect(html).toContain('Loading your dashboard');
  });
  it('renders totals with formatted spend', () => {
    const html = renderToStaticMarkup(<SummaryCards totals={{ sent: 5, matched: 4, delivered: 2, spendCents: 4000 }} />);
    expect(html).toContain('$40');
    expect(html).toContain('Delivered');
  });
  it('lists notifications newest first', () => {
    const mk = (id: string, seq: number) => ({ id, audience: 'business' as const, audienceId: 'b', kind: 'delivery_matched' as const, shipmentId: 's', planId: 'p', message: `msg-${id}`, createdSeq: seq });
    const html = renderToStaticMarkup(<NotificationList notifications={[mk('a', 1), mk('b', 2)]} />);
    expect(html.indexOf('msg-b')).toBeLessThan(html.indexOf('msg-a'));
  });
});
