// Helper for the /advise price tests (#867): tests/api/v2-advise.test.ts and v2-advise-readme-demo.test.ts.
// It checks an /advise answer against the engine's per-plan pricing (#861, server/domain/pricing.ts).
import { expect } from 'vitest';
import { advisorEngine } from '../../server/api/v2/adviseRoutes';
import { customerPriceCents } from '../../server/domain/pricing';
import type { AdviseOption, AdviseResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Run as RunV2, TravelProvider } from '../../shared/v2/types';

/** The four fields of a draft the engine reads. */
export type DraftTimes = { originBusinessId: string; destinationBusinessId: string; readyMin: number; deadlineMin: number };

export type PricedOption = {
  option: AdviseOption;
  /** The plan the matcher picks for the option's two times, on `run`. */
  plan: DeliveryPlan;
  readyMin: number;
  deadlineMin: number;
  /** The option's window is at least `settings.flexWindowMin`. */
  flexible: boolean;
};

/**
 * Every option's price is `customerPriceCents()` of the plan the matcher picks for the option's two times,
 * under the run's own settings, and the flexibility discount is in it exactly when the option's window
 * (ready to deliver-by, after its changes) is at least `settings.flexWindowMin`.
 * The price is also worked out here from the settings, without pricing.ts: legs x carrier pay + the relay fee
 * for a relay + the platform fee - the discount. `run` must be the run the answer was computed on.
 */
export function expectEnginePrices(run: RunV2, travel: TravelProvider, draft: DraftTimes, body: AdviseResponse): PricedOption[] {
  const { settings } = run.scenario;
  const engine = advisorEngine(run, travel, draft);
  expect(engine.flexWindowMin).toBe(settings.flexWindowMin);
  return body.options.map((option) => {
    const what = `${option.label} ${JSON.stringify(option.changes)}`;
    const readyMin = option.changes.readyMin ?? draft.readyMin;
    const deadlineMin = option.changes.deadlineMin ?? draft.deadlineMin;
    const answer = engine.match(readyMin, deadlineMin);
    if (!('plan' in answer)) throw new Error(`the engine has no plan for ${what}: ${answer.reason}`);
    const { plan } = answer;

    expect(option.customerPriceCents, what).toBe(plan.customerPriceCents);
    expect(option.customerPriceCents, what).toBe(customerPriceCents(plan, { readyMin, deadlineMin }, settings));

    // The same price from what the option itself shows: its kind and its number of carriers.
    expect(option.kind, what).toBe(plan.kind);
    expect(option.carrierNames, what).toHaveLength(plan.legs.length);
    const flexible = deadlineMin - readyMin >= settings.flexWindowMin;
    const undiscounted = option.carrierNames.length * settings.legRewardCents
      + (option.kind === 'relay' ? settings.hubCostCents : 0)
      + settings.platformFeeCents;
    expect(option.customerPriceCents, what).toBe(undiscounted - (flexible ? settings.flexDiscountCents : 0));
    return { option, plan, readyMin, deadlineMin, flexible };
  });
}

/** A copy of the run with another flexibility window in its settings, for `store.mutate`. */
export function withFlexWindow(run: RunV2, flexWindowMin: number): RunV2 {
  return { ...run, scenario: { ...run.scenario, settings: { ...run.scenario.settings, flexWindowMin } } };
}
