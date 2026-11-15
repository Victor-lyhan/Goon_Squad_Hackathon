// "No hidden constants": every number the study's math uses is in the `assumptions` list of the results.
// Three checks together give that:
// 1. the math files (baseline.ts, runner.ts) hold no number literal except 0 and 1, so a constant can only
//    come from the assumptions or from units.ts;
// 2. units.ts holds only unit definitions and output rounding, pinned here;
// 3. changing any one assumption changes the results, so every listed value really is used.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { ASSUMPTIONS, ASSUMPTION_KEYS, assumptionValues } from '../../scripts/study/assumptions';
import { DEFAULT_GRID } from '../../scripts/study/grid';
import { runStudy } from '../../scripts/study/runner';
import * as summary from '../../scripts/study/summary';
import * as units from '../../scripts/study/units';
import { STUDY_TIMEOUT_MS, TWO_RUN_GRID, studyInput } from './study-helper';

const studyDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/study');

/** Files where the comparison is computed. A new math file belongs in this list. */
const MATH_FILES = ['baseline.ts', 'runner.ts'];
/** Files that may hold numbers, and why. */
const NUMBER_FILES: Record<string, string> = {
  'assumptions.ts': 'the assumption values themselves',
  'grid.ts': 'the grid, repeated in the results under `grid`',
  'units.ts': 'unit definitions and output rounding',
  'cli.ts': 'exit codes, text formatting and how often progress is printed',
  'csv.ts': 'none: the column names of runs.csv; it copies run totals',
  'fonts.ts': 'the weights of the fonts the study page embeds (#887); it reads font files, no result',
  'page.ts': 'chart geometry, CSS sizes and number formatting of the study page; it reads totals, it computes no comparison',
  'parallel.ts': 'the number of worker threads (CPU cores less one)',
  'summary.ts': 'which percentiles of the runs are reported (pinned below); it reads run totals and converts them with baseline.ts and units.ts',
  'types.ts': 'documentation only',
  'worker.ts': 'none: one run per message, simulated by runner.ts',
};

/** Source without comments, strings and template text, so only code is scanned. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    // A template keeps the code inside its ${...} parts, and loses its text.
    .replace(/`(?:[^`\\]|\\.)*`/g, template => [...template.matchAll(/\$\{([^}]*)\}/g)].map(part => ` ${part[1]} `).join(''))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/** Number literals in code: digits that do not belong to an identifier such as `co2Kg`. */
function numberLiterals(source: string): string[] {
  return [...codeOnly(source).matchAll(/(?<![A-Za-z0-9_$.])\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?/gi)].map(match => match[0]);
}

describe('the scanner itself', () => {
  it('finds literals in code and ignores comments, strings and identifiers', () => {
    expect(numberLiterals("const x = 1609.344; // 42\nconst co2Kg = y * 7 + 1_000; const s = 'v2 99'; /* 5 */ `a 8 ${z / 3} 9`")).toEqual(['1609.344', '7', '1_000', '3']);
  });
});

describe('no hidden constants in the study math', () => {
  it('every file of scripts/study is either a math file or a listed number file', () => {
    const files = fs.readdirSync(studyDir).filter(name => name.endsWith('.ts')).sort();
    expect(files).toEqual([...MATH_FILES, ...Object.keys(NUMBER_FILES)].sort());
  });

  it.each(MATH_FILES)('%s has no number literal other than 0 and 1', (file) => {
    const found = numberLiterals(fs.readFileSync(path.join(studyDir, file), 'utf8'));
    expect(found.filter(literal => literal !== '0' && literal !== '1')).toEqual([]);
  });

  it('units.ts holds only definitions: the mile, the day and the output decimals', () => {
    const numbers: Record<string, unknown> = Object.fromEntries(Object.entries(units).filter(([, value]) => typeof value === 'number'));
    expect(numbers).toEqual({
      METERS_PER_MILE: 1609.344, MINUTES_PER_DAY: 1440,
      MILES_DECIMALS: 3, KG_DECIMALS: 3, RATE_DECIMALS: 4, MINUTES_DECIMALS: 1,
    });
    // Besides those, the file has 10 (the base of the rounding) and 100 (cents per dollar, percent).
    const others = numberLiterals(fs.readFileSync(path.join(studyDir, 'units.ts'), 'utf8'))
      .filter(literal => !Object.values(numbers).includes(Number(literal)) && literal !== '0' && literal !== '1');
    expect([...new Set(others)].sort()).toEqual(['10', '100', '2']);
  });

  it('summary.ts holds only the percentiles it reports: the 10th, the median and the 90th', () => {
    expect([summary.LOW_PERCENTILE, summary.HIGH_PERCENTILE]).toEqual([10, 90]);
    const literals = numberLiterals(fs.readFileSync(path.join(studyDir, 'summary.ts'), 'utf8'));
    // 100 turns a percentile into a share; 0 and 1 index and count.
    expect([...new Set(literals)].sort((a, b) => Number(a) - Number(b))).toEqual(['0', '1', '10', '50', '90', '100']);
    for (const file of ['csv.ts', 'worker.ts']) {
      expect(numberLiterals(fs.readFileSync(path.join(studyDir, file), 'utf8')), file).toEqual([]);
    }
    expect(numberLiterals(fs.readFileSync(path.join(studyDir, 'parallel.ts'), 'utf8')).filter(literal => literal !== '0' && literal !== '1')).toEqual([]);
  });

  it('changing any one assumption changes the results', () => {
    const outcome = (assumptions = ASSUMPTIONS) => {
      const { runs, totals, headline } = runStudy(studyInput({ grid: TWO_RUN_GRID, assumptions }));
      return JSON.stringify({ runs, totals, headline });
    };
    const base = outcome();
    const unused: string[] = [];
    for (const { key } of ASSUMPTIONS) {
      const changed = ASSUMPTIONS.map(assumption => (assumption.key === key ? { ...assumption, value: assumption.value + 1 } : assumption));
      if (outcome(changed) === base) unused.push(key);
    }
    expect(unused).toEqual([]);
  }, STUDY_TIMEOUT_MS);
});

describe('the assumptions list', () => {
  it('has every key once, in the listed order', () => {
    expect(ASSUMPTIONS.map(assumption => assumption.key)).toEqual([...ASSUMPTION_KEYS]);
  });

  it.each(ASSUMPTIONS.map(assumption => [assumption.key, assumption] as const))('%s has a label, a finite value, a unit and a one-sentence reason', (_key, assumption) => {
    expect(Object.keys(assumption).sort()).toEqual(['key', 'label', 'reason', 'unit', 'value']);
    expect(assumption.label.trim()).not.toBe('');
    expect(assumption.unit.trim()).not.toBe('');
    expect(Number.isFinite(assumption.value)).toBe(true);
    expect(assumption.value).toBeGreaterThanOrEqual(0);
    // One sentence: ends with a full stop and has no other sentence end inside. ("U.S." and "a.m." are allowed.)
    const reason = assumption.reason.replace(/U\.S\.|a\.m\.|p\.m\./g, '');
    expect(reason).toMatch(/^[A-Z].{20,}\.$/);
    expect(reason.slice(0, -1)).not.toMatch(/[.!?]\s/);
    // No invented sources: no link, no "according to", no year, no page or table reference.
    expect(assumption.reason).not.toMatch(/https?:|www\.|according to|\b(19|20)\d\d\b|\bet al\b/i);
  });

  it('money is whole cents and the promise is a whole minute of the morning', () => {
    const a = assumptionValues(ASSUMPTIONS);
    for (const cents of [a.legRewardCents, a.hubCostCents, a.platformFeeCents, a.flexDiscountCents, a.courierEnvelopeCents, a.courierSmallBoxCents]) {
      expect(Number.isInteger(cents)).toBe(true);
      expect(cents).toBeGreaterThan(0);
    }
    expect(Number.isInteger(a.courierPromisedByMin)).toBe(true);
    expect(a.courierPromisedByMin).toBeGreaterThan(0);
    expect(a.courierPromisedByMin).toBeLessThan(12 * 60);
  });

  it('agrees with the app: the same four Relay pricing values, the same flexible window and the same courier price for an envelope', () => {
    const a = assumptionValues(ASSUMPTIONS);
    // #861: carrier pay per commute, relay fee, platform fee and flexibility discount, as the app's settings hold them.
    expect([a.legRewardCents, a.hubCostCents, a.platformFeeCents, a.flexDiscountCents]).toEqual([300, 50, 400, 100]);
    for (const key of ['legRewardCents', 'hubCostCents', 'platformFeeCents', 'flexDiscountCents', 'flexWindowMin'] as const) {
      expect(a[key], key).toBe(DEFAULT_SETTINGS[key]);
    }
    expect(a.flexWindowMin).toBe(18 * 60);
    expect(a.courierEnvelopeCents).toBe(DEFAULT_SETTINGS.courierPriceCents);
    expect(a.courierSmallBoxCents).toBeGreaterThanOrEqual(a.courierEnvelopeCents);
  });

  it('is copied into the results unchanged', () => {
    const results = runStudy(studyInput({ grid: { ...DEFAULT_GRID, seeds: [1], employeeCounts: [30], packageCounts: [12], detourLimitsMin: [12] } }));
    expect(results.assumptions).toEqual(ASSUMPTIONS);
  });
});

describe('assumptionValues', () => {
  it('maps key to value', () => {
    const a = assumptionValues(ASSUMPTIONS);
    expect(Object.keys(a).sort()).toEqual([...ASSUMPTION_KEYS].sort());
    for (const { key, value } of ASSUMPTIONS) expect(a[key]).toBe(value);
  });

  it('refuses a missing, repeated, unknown or non-finite assumption', () => {
    expect(() => assumptionValues(ASSUMPTIONS.slice(1))).toThrow(/missing: legRewardCents/);
    expect(() => assumptionValues([...ASSUMPTIONS, ASSUMPTIONS[0]!])).toThrow(/listed twice/);
    expect(() => assumptionValues([...ASSUMPTIONS, { ...ASSUMPTIONS[0]!, key: 'tipCents' as never }])).toThrow(/Unknown study assumption "tipCents"/);
    expect(() => assumptionValues(ASSUMPTIONS.map((assumption, index) => (index === 0 ? { ...assumption, value: Number.NaN } : assumption)))).toThrow(/finite number/);
  });
});
