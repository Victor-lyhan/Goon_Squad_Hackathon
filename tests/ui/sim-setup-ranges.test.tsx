import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SetupDrawer } from '../../client/src/components/sim/SetupDrawer';
import {
  DEMO_IGNORES_TEXT, PRESET_LABELS, defaultForm, generatedText, validateSetup, type SetupForm,
} from '../../client/src/components/sim/setupModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { GenerateScenarioRequest } from '../../shared/schemas';

const demo = createInitialRun(loadDefaultScenario());
const random = (patch: Partial<SetupForm>): SetupForm => ({ ...defaultForm(), preset: 'random', ...patch });

describe('setup ranges (spec §5)', () => {
  it('defaults are the schema defaults', () => {
    const d = GenerateScenarioRequest.parse({ preset: 'random' });
    expect(d).toMatchObject({ seed: 42, employees: 60, packages: 24, hubs: 6, maxExtraMin: 8 });
    const f = defaultForm();
    expect([f.seed, f.employees, f.packages, f.hubs, f.maxExtraMin]).toEqual(['42', '60', '24', '6', '8']);
  });

  it('the Demo city own counts are valid sizes', () => {
    const s = demo.scenario;
    const v = validateSetup(random({ employees: String(s.employees.length), hubs: String(s.hubs.length), packages: String(s.shipments.length) }));
    expect(v.ok).toBe(true);
  });

  it('hubs 0 and employees 200 are valid; employees 9 and 201 invalid', () => {
    expect(validateSetup(random({ hubs: '0' })).ok).toBe(true);
    expect(validateSetup(random({ employees: '200' })).ok).toBe(true);
    expect(validateSetup(random({ employees: '9' })).errors.employees).toMatch(/10 to 200/);
    expect(validateSetup(random({ employees: '201' })).errors.employees).toMatch(/10 to 200/);
    expect(validateSetup(random({ hubs: '11' })).errors.hubs).toMatch(/0 to 10/);
    expect(validateSetup(random({ hubs: '10' })).ok).toBe(true);
  });

  it('other ranges: packages 5-60, detour limit 0-30', () => {
    expect(validateSetup(random({ packages: '4' })).errors.packages).toMatch(/5 to 60/);
    expect(validateSetup(random({ packages: '61' })).errors.packages).toMatch(/5 to 60/);
    expect(validateSetup(random({ maxExtraMin: '31' })).errors.maxExtraMin).toMatch(/0 to 30/);
    expect(validateSetup(random({ maxExtraMin: '-1' })).ok).toBe(false);
  });

  it('empty, decimal and text values are errors', () => {
    for (const bad of ['', ' ', '1.5', 'abc', '1e1']) {
      expect(validateSetup(random({ employees: bad })).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(validateSetup(random({ seed: '2.5' })).errors.seed).toMatch(/whole number/);
    expect(validateSetup(random({ seed: '-7' })).ok).toBe(true);
  });

  it('Demo ignores the numeric fields and sends only the preset', () => {
    const v = validateSetup({ ...defaultForm(), preset: 'demo', employees: '5', hubs: 'x' });
    expect(v.ok).toBe(true);
  });

  it('labels the presets and disables fields for Demo', () => {
    const html = renderToStaticMarkup(<SetupDrawer open onClose={() => {}} onChanged={() => {}} />);
    expect(html).toContain(PRESET_LABELS.demo);
    expect(html).toContain(PRESET_LABELS.random);
    expect(PRESET_LABELS).toEqual({ demo: 'Demo city (designed)', random: 'Random city (seeded)' });
    expect(html).toContain(DEMO_IGNORES_TEXT.replace(/’/g, '&#x27;'));
    expect((html.match(/<input type="text"[^>]*disabled/g) ?? []).length).toBe(5);
  });

  it('shows runId and seed from the response', () => {
    expect(generatedText(demo, demo.scenario.seed)).toBe(`Generated ${demo.runId} (seed ${demo.scenario.seed})`);
    expect(generatedText({ runId: 'run-2' }, undefined)).toBe('Generated run-2');
  });
});
