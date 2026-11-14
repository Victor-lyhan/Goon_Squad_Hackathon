import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { GenerateScenarioRequest } from '../../shared/schemas';
import { generateScenario } from '../../server/domain/generator';
import { assignShipments } from '../../server/domain/matching';
import { buildTrips, createRouter } from '../../server/domain/routing';

describe('matching performance (spec 6 and determinism spec 7)', () => {
  it.each([
    { name: 'default', employees: 60, packages: 24, hubs: 6, budgetMs: 2000 },
    { name: 'maximum', employees: 200, packages: 60, hubs: 10, budgetMs: 5000 },
  ])('$name random scenario stays within $budgetMs ms', ({ name, employees, packages, hubs, budgetMs }) => {
    const options = GenerateScenarioRequest.parse(name === 'default'
      ? { preset: 'random' } : { preset: 'random', employees, packages, hubs });
    const run = () => {
      const scenario = generateScenario(options);
      expect(scenario.employees).toHaveLength(employees);
      expect(scenario.shipments).toHaveLength(packages);
      expect(scenario.hubs).toHaveLength(hubs);
      const router = createRouter(scenario.graph);
      const trips = scenario.employees.flatMap(employee => buildTrips(employee, scenario.businesses, router));
      // Each run gets a fresh router; only baseline construction warms its cache.
      const start = performance.now();
      const result = assignShipments(scenario.shipments, { ...scenario, router, trips });
      const elapsed = performance.now() - start;
      expect(elapsed, `${name} matching took ${elapsed.toFixed(1)} ms`).toBeLessThan(budgetMs);
      expect(result.computeMs).toBe(0);
      expect(result.plans.length).toBeGreaterThan(0);
      expect(result.plans.length + result.unmatched.length).toBe(packages);
      return { scenario, result };
    };
    expect(run()).toEqual(run());
  }, 20_000);
});
