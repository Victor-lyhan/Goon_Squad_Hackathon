import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComparePanel } from '../../client/src/components/sim/ComparePanel';
import { NO_HUBS_MESSAGE, toCompareView } from '../../client/src/components/sim/compareModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { postCompare } from '../../server/api/planning';
import { generateScenario } from '../../server/domain/generator';
import type { CompareResponse } from '../../shared/api';
import type { Run } from '../../shared/types';

/** Runs the real compare handler against a run, no HTTP needed. */
function compareFor(run: Run): CompareResponse {
  let body: unknown;
  const res = { json: (b: unknown) => { body = b; }, status: () => res };
  postCompare({ get: () => run } as never)({} as never, res as never);
  return body as CompareResponse;
}

const demo = createInitialRun(loadDefaultScenario());
const random = createInitialRun(generateScenario({ preset: 'random', seed: 7, employees: 40, packages: 20, hubs: 4, maxExtraMin: 10 }));
const zeroHub = createInitialRun(generateScenario({ preset: 'random', seed: 3, employees: 30, packages: 12, hubs: 0, maxExtraMin: 10 }));

const LABELS = ['Projected matched / requested', 'Projected relay plans', 'Projected average added minutes',
  'Projected max added minutes', 'Projected customer savings', 'Projected platform contribution'];

function expectClean(html: string) {
  expect(html).not.toMatch(/NaN|undefined|null|Infinity/);
  for (const l of LABELS) expect(html).toContain(l);
  expect(html).toContain('Direct only');
  expect(html).toContain('With relay');
}

describe('ComparePanel with real compare output', () => {
  it('demo city: delta line equals the API difference', () => {
    const c = compareFor(demo);
    const delta = c.withRelay.metrics.matched - c.directOnly.metrics.matched;
    const html = renderToStaticMarkup(<ComparePanel compare={c} />);
    expectClean(html);
    expect(c.withRelay.metrics.relay).toBeGreaterThan(0);
    expect(delta).toBeGreaterThan(0);
    expect(html).toContain(`Relay adds +${delta} ${delta === 1 ? 'match' : 'matches'}`);
    expect(html).not.toContain('No hubs');
    expect(html).toContain(`${c.withRelay.metrics.matched} / ${c.withRelay.metrics.requested}`);
  });

  it('random seed renders cleanly', () => {
    const c = compareFor(random);
    const html = renderToStaticMarkup(<ComparePanel compare={c} />);
    expectClean(html);
    expect(html).toMatch(/Relay adds (\+\d+ match(es)?|no extra matches)|No hubs/);
  });

  it('zero-hub city explains why relay adds nothing', () => {
    const c = compareFor(zeroHub);
    expect(c.withRelay.metrics.relay).toBe(0);
    const html = renderToStaticMarkup(<ComparePanel compare={c} />);
    expectClean(html);
    expect(html).toContain(NO_HUBS_MESSAGE.replace("'", '&#x27;')); // HTML-escaped apostrophe
    expect(toCompareView(c).deltaLine).toBe(NO_HUBS_MESSAGE);
    expect(html).not.toMatch(/Relay adds \+/);
  });

  it('zero requests shows em dashes, never NaN', () => {
    const empty = createInitialRun({ ...loadDefaultScenario(), shipments: [] });
    const c = compareFor(empty);
    const html = renderToStaticMarkup(<ComparePanel compare={c} />);
    expectClean(html);
    expect(html).toContain('—');
    expect(toCompareView(c).deltaLine).toBe('Relay adds — matches');
  });
});
