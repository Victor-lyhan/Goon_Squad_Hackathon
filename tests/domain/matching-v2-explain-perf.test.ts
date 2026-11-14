import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { explainShipment, formatExplain } from '../../server/domain/v2/storyExplain';
import { nycShapedWorkload } from './matching-v2-workload';

// Local measurement: 17 to 20 ms for all 24 requests of the default workload (1,282 rows),
// formatting included. The budget is the 2 s the issue sets for the default workload, which is
// about 100x that, so it also meets "at least 10x the local measurement" (DECISIONS pass 52).
// The city is built once, outside the timing.
const city = nycShapedWorkload({ employees: 60, packages: 24 });

it('explains the whole default workload (60 employees, 24 packages, 18 businesses) in under 2 s', () => {
  expect(city.ctx.employees).toHaveLength(60);
  expect(city.ctx.businesses).toHaveLength(18);
  expect(city.shipments).toHaveLength(24);
  const start = performance.now();
  const explained = city.shipments.map(request => explainShipment(request, city.ctx));
  const lines = explained.map(rows => formatExplain(rows, {}));
  const elapsed = performance.now() - start;
  const rows = explained.reduce((sum, r) => sum + r.length, 0);
  process.stdout.write(`explain default 60/24: ${elapsed.toFixed(1)} ms; ${rows} rows\n`);
  expect(elapsed).toBeLessThan(2000);
  // In full: every request has its direct rows and a row for each of its 16 possible relay businesses.
  for (const [i, request] of city.shipments.entries()) {
    const relays = new Set(explained[i].filter(r => r.kind === 'relay').map(r => r.relayBusinessId));
    expect(relays.size).toBe(16);
    expect(relays.has(request.originBusinessId) || relays.has(request.destinationBusinessId)).toBe(false);
    expect(explained[i].some(r => r.kind !== 'relay')).toBe(true);
    expect(lines[i].length).toBeGreaterThan(0);
  }
}, 20_000);
