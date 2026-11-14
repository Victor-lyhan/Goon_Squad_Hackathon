import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComparePanel } from '../../client/src/components/sim/ComparePanel';
import { NO_HUBS_MESSAGE, PLAN_NOTE, toCompareView } from '../../client/src/components/sim/compareModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { postCompare } from '../../server/api/planning';
import { generateScenario } from '../../server/domain/generator';
import type { CompareResponse } from '../../shared/api';
import type { Run } from '../../shared/types';

function compareFor(run: Run): CompareResponse {
  let body: unknown;
  const res = { json: (b: unknown) => { body = b; }, status: () => res };
  postCompare({ get: () => run } as never)({} as never, res as never);
  return body as CompareResponse;
}

const cities: Record<string, Run> = {
  demo: createInitialRun(loadDefaultScenario()),
  'random seed 7': createInitialRun(generateScenario({ preset: 'random', seed: 7, employees: 40, packages: 20, hubs: 4, maxExtraMin: 10 })),
  'zero hubs': createInitialRun(generateScenario({ preset: 'random', seed: 7, employees: 30, packages: 12, hubs: 0, maxExtraMin: 10 })),
};

const esc = (s: string) => s.replace(/'/g, '&#x27;');

describe.each(Object.entries(cities))('compare spec, %s', (_name, run) => {
  const c = compareFor(run);
  const html = renderToStaticMarkup(<ComparePanel compare={c} />);

  it('shows matched/requested, added minutes, cost and spend with Projected labels, no NaN', () => {
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
    for (const l of ['Projected matched / requested', 'Projected average added minutes', 'Projected max added minutes',
      'Projected customer savings', 'Projected customer spend']) expect(html).toContain(l);
    for (const m of [c.directOnly.metrics, c.withRelay.metrics]) expect(html).toContain(`${m.matched} / ${m.requested}`);
  });

  it('states the comparison does not change the current plan', () => {
    expect(html).toContain(PLAN_NOTE);
  });
});

describe('zero hubs', () => {
  it('columns are equal and the note says there are no hubs', () => {
    const c = compareFor(cities['zero hubs']);
    expect(c.withRelay.metrics).toEqual(c.directOnly.metrics);
    const v = toCompareView(c);
    for (const r of v.rows) expect(r.relay).toBe(r.direct);
    expect(renderToStaticMarkup(<ComparePanel compare={c} />)).toContain(esc(NO_HUBS_MESSAGE));
  });
});

describe('relay worse than direct is shown as is', () => {
  const base = compareFor(cities.demo);
  const worse: CompareResponse = structuredClone(base);
  const d = worse.directOnly.metrics;
  Object.assign(worse.withRelay.metrics, {
    matched: d.matched - 2, relay: 1,
    avgExtraMinPerTrip: (d.avgExtraMinPerTrip ?? 0) + 5, maxExtraMin: (d.maxExtraMin ?? 0) + 9,
    projectedCustomerSpendCents: d.projectedCustomerSpendCents + 700,
    projectedCustomerSavingsCents: d.projectedCustomerSavingsCents - 700,
  });
  const html = renderToStaticMarkup(<ComparePanel compare={worse} />);
  const v = toCompareView(worse);

  it('no win tone, no better badge, no green, no clamping', () => {
    expect(v.tone).not.toBe('win');
    expect(html).not.toMatch(/cmp-delta win|better|green/i);
    expect(v.deltaLine).toBe('Relay matches 2 fewer packages than direct only');
    expect(v.rows.find((r) => r.key === 'matched')!.diff).toBe('−2 packages matched with relay');
    expect(v.rows.find((r) => r.key === 'spend')!.diff).toBe('+$7.00');
    expect(v.rows.find((r) => r.key === 'savings')!.diff).toBe('−$7.00');
    expect(v.rows.find((r) => r.key === 'avgExtra')!.diff).toMatch(/^\+/);
  });

  it('css has no green on table rows', () => {
    const css = readFileSync('client/src/components/sim/ComparePanel.css', 'utf8');
    expect(css.replace(/\.cmp-delta\.win[^}]*}/, '')).not.toMatch(/#(dcfce7|f0fdf4|166534)|green/i);
  });
});

describe('never recomputes', () => {
  it('ComparePanel and compareModel do not reference recompute or the api', () => {
    for (const f of ['ComparePanel.tsx', 'compareModel.ts']) {
      expect(readFileSync(`client/src/components/sim/${f}`, 'utf8')).not.toMatch(/recompute|from '\.\.\/\.\.\/api/i);
    }
  });
});
