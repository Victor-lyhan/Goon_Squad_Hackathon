import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShipmentList } from '../../client/src/components/business/ShipmentList';
import { TrackingDetail } from '../../client/src/components/business/TrackingDetail';
import { directPlan, mk, relayPlan } from './business-tracking.test';

const businesses = [
  { id: 'biz-a', name: 'Business A', nodeId: 'n-0-0', district: 'D' },
  { id: 'biz-b', name: 'Business B', nodeId: 'n-5-5', district: 'N' },
];
const hubs = [{ id: 'hub-h', name: 'Hub H', nodeId: 'n-3-3' }];
const employees = [
  { id: 'emp-1', name: 'Ann' }, { id: 'emp-2', name: 'Ben' },
] as never;

describe('ShipmentList', () => {
  it('renders rows with counterpart, pill and ETA / delivered time', () => {
    const html = renderToStaticMarkup(
      <ShipmentList views={[mk(relayPlan, 'at_hub'), mk(directPlan, 'delivered'), mk(null, 'unmatched')]}
        direction="outgoing" businesses={businesses} selectedId="shp-1" onSelect={() => {}} />,
    );
    expect(html).toContain('Contracts');
    expect(html).toContain('To Business B');
    expect(html).toContain('At hub');
    expect(html).toContain('ETA Day 1, 6:20 PM');
    expect(html).toContain('Delivered Day 1, 6:17 PM');
    expect(html).toContain('No match yet');
  });
  it('shows the origin for incoming', () => {
    const html = renderToStaticMarkup(
      <ShipmentList views={[mk(relayPlan, 'scheduled')]} direction="incoming" businesses={businesses} onSelect={() => {}} />,
    );
    expect(html).toContain('From Business A');
  });
  it('renders empty states', () => {
    const out = renderToStaticMarkup(<ShipmentList views={[]} direction="outgoing" businesses={businesses} onSelect={() => {}} />);
    const inc = renderToStaticMarkup(<ShipmentList views={[]} direction="incoming" businesses={businesses} onSelect={() => {}} />);
    expect(out).toContain('No outgoing packages yet');
    expect(inc).toContain('No incoming packages yet');
  });
});

describe('TrackingDetail', () => {
  it('shows facts, hub, legs and stepper for a relay', () => {
    const html = renderToStaticMarkup(
      <TrackingDetail view={mk(relayPlan, 'at_hub')} businesses={businesses} hubs={hubs} employees={employees} />,
    );
    for (const t of ['Signed contracts', 'Deadline', 'Calculated arrival', 'Relay hub', 'Hub H', 'Ann', 'Ben', 'Out for delivery', 'trk-step--current'])
      expect(html).toContain(t);
  });
  it('omits hub and hub steps for a direct plan', () => {
    const html = renderToStaticMarkup(
      <TrackingDetail view={mk(directPlan, 'picked_up')} businesses={businesses} hubs={hubs} employees={employees} />,
    );
    expect(html).not.toContain('Relay hub');
    expect(html).not.toContain('Out for delivery');
  });
});
