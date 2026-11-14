import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import { SimulatorView } from '../../client/src/components/sim/SimulatorView';
import { needsMapFetch, resolveSelection } from '../../client/src/components/sim/simPageModel';
import type { Employee, Metrics, Shipment } from '../../shared/types';
import type { MapResponse, SimulatorResponse } from '../../shared/api';

const map = { runId: 'run-1', graph: fixture.graph, businesses: fixture.businesses, hubs: fixture.hubs, homes: [] } as unknown as MapResponse;
const employees = [] as Employee[];
const metrics: Metrics = {
  requested: 1, matched: 1, delivered: 0, direct: 0, relay: 1, unmatched: 0,
  avgExtraMinPerTrip: 4, maxExtraMin: 6, earnedRewardsCents: 0,
  projectedCustomerSavingsCents: 400, projectedCustomerSpendCents: 1000,
  projectedPlatformContributionCents: 100, earnedPlatformContributionCents: 0, extraDistanceM: 1000,
};
const shipment = {
  id: 'shp-1', clientRequestId: 'c1', label: 'Package 1', originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: 1000, deadlineMin: 2000, category: 'documents', description: '', weightGrams: 500,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
} as unknown as Shipment;

const sim = (shipments: Shipment[]) => ({
  runId: 'run-1', version: 1,
  clock: { phase: 'locked', playing: false, timeMin: 1000, speed: 30 },
  snapshot: {
    runId: 'run-1', version: 1, timeMin: 1000, shipmentStatus: { 'shp-1': 'scheduled' }, deliveredAtMin: {},
    jobStatus: {}, earningsCents: {}, markers: [], packagePositions: {}, occurredEvents: [], metrics,
  },
  plans: [], jobs: [], shipments, unmatched: [], computeMs: 0, nextEventMin: null,
}) as unknown as SimulatorResponse;

const noop = () => {};

describe('SimulatorView', () => {
  it('renders playback, queue and metrics', () => {
    const html = renderToStaticMarkup(
      <SimulatorView sim={sim([shipment])} map={map} employees={employees} onSelect={noop} onControl={noop} />,
    );
    expect(html).toContain('Simulation playback');
    expect(html).toContain('Play simulation');
    expect(html).toContain('Package queue');
    expect(html).toContain('Projected');
    expect(html).toContain('So far');
  });
  it('shows empty state with no shipments', () => {
    const html = renderToStaticMarkup(
      <SimulatorView sim={sim([])} map={map} employees={employees} onSelect={noop} onControl={noop} />,
    );
    expect(html).toContain('No packages in this run yet');
  });
  it('shows a spinner while loading and a banner on error', () => {
    expect(renderToStaticMarkup(<SimulatorView sim={null} map={null} employees={[]} onSelect={noop} onControl={noop} />))
      .toContain('Loading simulator');
    const html = renderToStaticMarkup(
      <SimulatorView sim={sim([shipment])} map={map} employees={employees} error="boom" onSelect={noop} onControl={noop} />,
    );
    expect(html).toContain('boom');
    expect(html).toContain('Package queue');
  });
});

describe('simPageModel', () => {
  it('needsMapFetch only when runId changes', () => {
    expect(needsMapFetch(null, 'a')).toBe(true);
    expect(needsMapFetch('a', 'a')).toBe(false);
    expect(needsMapFetch('a', 'b')).toBe(true);
  });
  it('resolveSelection drops missing ids', () => {
    expect(resolveSelection('shp-1', [shipment])).toBe('shp-1');
    expect(resolveSelection('gone', [shipment])).toBeUndefined();
    expect(resolveSelection(undefined, [shipment])).toBeUndefined();
  });
});
