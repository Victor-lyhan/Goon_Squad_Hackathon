// runFetchScript (server/geo/fetchScript.ts): the explanation of a story row that is not as written and of a package
// without a plan (issue #538). The lines are the story explainer's (server/domain/v2/storyExplain.ts); every test
// compares them with what the explainer says on the same files, computed in fetch-script-helpers.ts.
// Temp folders with copies of the three real fixtures/nyc files and a fake Google client. No network, no real key,
// no .env. The story rows are edited in the temp copy only.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHECK_LINE, DRY_RUN_STORY_LINE, EXPLAIN_EXPECTED_KIND_OPTIONS, EXPLAIN_OPTIONS } from '../../server/geo/fetchScript';
import { HOMES, storyFile, totalCalls } from './fetch-routes-helpers';
import {
  editStory,
  explainerOn,
  explanationOf,
  leakedLines,
  printedLineCount,
  removeTempDirs,
  script,
  snapshot,
  tempDirWithCacheOf,
  tempFixturesDir,
  withoutOutcome,
} from './fetch-script-helpers';
import type { ExplainedPackage } from './fetch-script-helpers';

// The seed run (the whole fetch with the fake client) takes about 0.2 s locally; a run on its cache less.
const TEST_TIMEOUT_MS = 30_000;
vi.setConfig({ testTimeout: TEST_TIMEOUT_MS, hookTimeout: TEST_TIMEOUT_MS });

type Run = Awaited<ReturnType<typeof script>>;

// In the city of fetch-script-helpers.ts the story is as written: row 1 is a direct plan, row 4 a relay.
const DIRECT_ROW = 0;
const RELAY_ROW = 3;
// A row outside the opening eight. Whatever the story expects of it (read from the story file), it fails when
// nobody can carry it in time.
const ANY_ROW = 8;
const expectedOfAnyRow = storyFile.shipments[ANY_ROW].expect;
const idOfRow = (row: number) => `shp-${row + 1}`;
const titleStart = (row: number) => `${idOfRow(row)} ${storyFile.shipments[row].label}: `;

const isRelay = (option: string) => /^(feasible|ruled out): relay via /.test(option);
const isDirect = (option: string) => /^(feasible|ruled out): (evening|morning) direct: /.test(option);
const isFeasible = (option: string) => option.startsWith('feasible: ');

/** A home's coordinates as they are written in the fixtures and the cache, and any place ID of a home. */
const HOME_TEXT = [...new Set(HOMES.flatMap((home) => [String(home.lat), String(home.lng), home.id]))];
const noHome = (lines: readonly string[]) => {
  for (const line of lines) {
    expect(line).not.toMatch(/home-/);
    for (const text of HOME_TEXT) expect(line.includes(text)).toBe(false);
  }
};

/** The printed options are the explainer's own lines for that package, and the "more" line counts the rest. */
function expectExplainerLines(dir: string, shipmentId: string, printed: ExplainedPackage) {
  const { rows, lines } = explainerOn(dir).options(shipmentId);
  const all = lines.filter((line) => line !== 'no feasible option');
  expect(all).toHaveLength(rows.length);
  expect(printed.options.length).toBeGreaterThan(0);

  const options = printed.options.filter((line) => line !== 'no feasible option');
  expect(options.length).toBeLessThanOrEqual(EXPLAIN_OPTIONS);
  expect(options.length).toBe(Math.min(EXPLAIN_OPTIONS, rows.length));
  for (const option of options) expect(all).toContain(withoutOutcome(option));
  // The explainer's order: the ones that work first, each group in the order the explainer prints it.
  const positions = options.map((option) => all.indexOf(withoutOutcome(option)));
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(new Set(positions).size).toBe(positions.length);

  const left = rows.length - options.length;
  if (left === 0) {
    expect(printed.more).toBeNull();
  } else {
    const feasibleLeft = rows.filter((row) => row.feasible).length - options.filter(isFeasible).length;
    expect(printed.more).toBe(`… ${left} more ${left === 1 ? 'option' : 'options'} (${feasibleLeft} feasible, ${left - feasibleLeft} ruled out)`);
  }
  return { rows, all, options };
}

/** A folder a complete run was made on, with the story as written. Never changed; every test works on a copy. */
let seed: string;
let clean: Run;

beforeAll(async () => {
  seed = tempFixturesDir();
  clean = await script({ dir: seed });
});

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(100);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

describe('runFetchScript: a story that is as written', () => {
  it('prints no explanation in a run and exits 0', () => {
    expect(clean.code).toBe(0);
    expect(clean.lines.at(-1)).toMatch(/^Done: /);
    expect(explanationOf(clean.lines)).toEqual({ header: null, packages: [] });
    expect(clean.lines.some((line) => /^\s*(Why|feasible:|ruled out:|no feasible option|… )/.test(line))).toBe(false);
    expect(clean.lines).not.toContain(DRY_RUN_STORY_LINE);
  });

  it('prints no explanation in a dry run either', async () => {
    const dry = await script({ dir: tempDirWithCacheOf(seed), argv: ['--dry-run'], env: {} });

    expect(dry.code).toBe(0);
    expect(explanationOf(dry.lines).header).toBeNull();
    expect(dry.lines).not.toContain(DRY_RUN_STORY_LINE);
    expect(dry.lines.some((line) => /^\s*(Why|feasible:|ruled out:)/.test(line))).toBe(false);
    expect(dry.lines).toContain('  Nothing to fetch: the cache has everything the default scenario needs.');
  });

  it('a dry run on an empty cache explains nothing: the matcher cannot run yet', async () => {
    const dir = tempFixturesDir();
    editStory(dir, (story) => (story.shipments[DIRECT_ROW].expect = 'relay'));
    const dry = await script({ dir, argv: ['--dry-run'], env: {} });

    expect(dry.code).toBe(0);
    expect(dry.lines).not.toContain(DRY_RUN_STORY_LINE);
    expect(explanationOf(dry.lines).header).toBeNull();
  });
});

describe('runFetchScript: one story row expects a relay and gets a direct plan', () => {
  let dir: string;
  let run: Run;

  beforeAll(async () => {
    dir = tempDirWithCacheOf(seed);
    editStory(dir, (story) => (story.shipments[DIRECT_ROW].expect = 'relay'));
    run = await script({ dir });
  });

  it('exits 1 with the check line, as before', () => {
    expect(run.code).toBe(1);
    expect(run.lines.at(-1)).toBe(CHECK_LINE);
    expect(run.lines).toContain('  - 1 story package did not match as written in demoStory.json');
    expect(totalCalls(run.calls)).toBe(0); // the cache was complete: the explanation asks Google nothing
  });

  it('explains that row and no other, after the story rows and inside the plan check', () => {
    const { lines } = run;
    const { header, packages } = explanationOf(lines);

    expect(header).toBe(
      `Why (1 story package not as written): the options of each package taken alone, on the cached times. ` +
        `At most ${EXPLAIN_OPTIONS} each: those that work first, in the matcher's order, then the nearest misses.`,
    );
    expect(packages.map((entry) => entry.title)).toEqual([`${titleStart(DIRECT_ROW)}expected relay, got direct`]);

    const fail = lines.indexOf(`  FAIL ${titleStart(DIRECT_ROW)}expected relay, got direct`);
    const why = lines.indexOf(`  ${header}`);
    const lastRow = lines.map((line) => /^ {2}(OK|FAIL) shp-/.test(line)).lastIndexOf(true);
    expect(fail).toBeGreaterThan(lines.indexOf('Plan check'));
    expect(why).toBe(lastRow + 1);
    expect(why).toBeLessThan(lines.indexOf('Travel cache report'));
  });

  it("prints the explainer's lines: at most 8 options, then how many more there are", () => {
    const [printed] = explanationOf(run.lines).packages;
    const { rows, options } = expectExplainerLines(dir, idOfRow(DIRECT_ROW), printed);

    // This package has more options than fit, so the line that counts the rest is there.
    expect(rows.length).toBeGreaterThan(EXPLAIN_OPTIONS);
    expect(options).toHaveLength(EXPLAIN_OPTIONS);
    expect(printed.more).toMatch(/^… \d+ more options? \(\d+ feasible, \d+ ruled out\)$/);
    // Each option names its carrier with the added minutes and the limit.
    for (const option of options) expect(option).toMatch(/carrier .+ [+-]\d+ min, limit \d+/);
  });

  it('marks the plan the package got, and it is a direct one', () => {
    const [printed] = explanationOf(run.lines).packages;
    const got = printed.options.filter((option) => option.endsWith(' — the plan it got'));

    expect(got).toHaveLength(1);
    expect(isDirect(got[0])).toBe(true);
    expect(isFeasible(got[0])).toBe(true);

    const { assignments, names } = explainerOn(dir);
    const plan = assignments.plans.find((candidate) => candidate.shipmentId === idOfRow(DIRECT_ROW))!;
    expect(plan.kind).toBe('direct');
    expect(got[0]).toContain(`carrier ${names[plan.legs[0].employeeId]} `);
  });

  it('keeps places for the kind the story expects: the relay options are shown although direct ones rank first', () => {
    const [printed] = explanationOf(run.lines).packages;
    const { all } = expectExplainerLines(dir, idOfRow(DIRECT_ROW), printed);

    const relays = printed.options.filter(isRelay);
    expect(relays.length).toBeGreaterThanOrEqual(Math.min(EXPLAIN_EXPECTED_KIND_OPTIONS, all.filter(isRelay).length));
    expect(relays.length).toBeGreaterThan(0);
    // They are the explainer's first relay options, not any three.
    expect(relays.slice(0, EXPLAIN_EXPECTED_KIND_OPTIONS).map(withoutOutcome)).toEqual(all.filter(isRelay).slice(0, EXPLAIN_EXPECTED_KIND_OPTIONS));
  });

  it('holds no home: no place ID of one and no coordinates', () => {
    const start = run.lines.findIndex((line) => line.startsWith('  Why ('));
    const block = run.lines.slice(start, run.lines.indexOf('Travel cache report'));
    expect(block.length).toBeGreaterThan(3);
    noHome(block);
  });

  it('--dry-run prints the same explanation: no key, no Google call, nothing written, exit 0', async () => {
    const before = snapshot(dir);
    const dry = await script({ dir, argv: ['--dry-run'], env: {} });

    expect(dry.code).toBe(0);
    expect(dry.keys).toEqual([]);
    expect(totalCalls(dry.calls)).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(dry.lines.at(-1)).toMatch(/^Nothing was written\./);

    expect(explanationOf(dry.lines)).toEqual(explanationOf(run.lines));
    const why = dry.lines.findIndex((line) => line.startsWith('  Why ('));
    expect(dry.lines[why - 1]).toBe(DRY_RUN_STORY_LINE);
    // After the estimate, before the moved homes and the key line.
    expect(why).toBeGreaterThan(dry.lines.indexOf('  Google requests: 0'));
    expect(why).toBeLessThan(dry.lines.findIndex((line) => line.startsWith('Moved homes: ')));
    noHome(dry.lines.slice(why, dry.lines.findIndex((line) => line.startsWith('Moved homes: '))));
  });
});

describe('runFetchScript: one story row expects a direct plan and gets a relay', () => {
  let dir: string;
  let run: Run;

  beforeAll(async () => {
    dir = tempDirWithCacheOf(seed);
    editStory(dir, (story) => (story.shipments[RELAY_ROW].expect = 'direct'));
    run = await script({ dir });
  });

  it('says for the direct options which rule ruled them out, with the minutes', () => {
    expect(run.code).toBe(1);
    const { packages } = explanationOf(run.lines);
    expect(packages.map((entry) => entry.title)).toEqual([`${titleStart(RELAY_ROW)}expected direct, got relay`]);
    const { all } = expectExplainerLines(dir, idOfRow(RELAY_ROW), packages[0]);

    const directs = packages[0].options.filter(isDirect);
    expect(directs).toEqual(all.filter(isDirect).slice(0, EXPLAIN_EXPECTED_KIND_OPTIONS));
    expect(directs.length).toBeGreaterThan(0);
    for (const direct of directs) {
      expect(direct).toMatch(/^ruled out: (evening|morning) direct: carrier .+ \+\d+ min, limit \d+.* — /);
    }
    expect(directs.some((direct) => direct.endsWith("would exceed the employee's added-time limit"))).toBe(true);
  });

  it('marks the relay the package got', () => {
    const [printed] = explanationOf(run.lines).packages;
    const got = printed.options.filter((option) => option.endsWith(' — the plan it got'));
    expect(got).toHaveLength(1);
    expect(isRelay(got[0])).toBe(true);

    const { assignments, names } = explainerOn(dir);
    const plan = assignments.plans.find((candidate) => candidate.shipmentId === idOfRow(RELAY_ROW))!;
    expect(got[0]).toContain(`relay via ${names[plan.relayBusinessId!]}: `);
  });
});

describe('runFetchScript: a package nobody can carry in time', () => {
  let dir: string;
  let run: Run;

  beforeAll(async () => {
    dir = tempDirWithCacheOf(seed);
    // Ready and due in the same minute: every commute that reaches it is late.
    editStory(dir, (story) => (story.shipments[ANY_ROW].deadlineMin = story.shipments[ANY_ROW].readyMin));
    run = await script({ dir });
  });

  it('is a failed story row, as before: exit 1 and the check line', () => {
    expect(run.code).toBe(1);
    expect(run.lines.at(-1)).toBe(CHECK_LINE);
    expect(run.lines.some((line) => line.startsWith(`  FAIL ${titleStart(ANY_ROW)}expected ${expectedOfAnyRow}, got unmatched — `))).toBe(true);
  });

  it('is explained once, with the reason of the matcher and no option that works', () => {
    const { header, packages } = explanationOf(run.lines);
    expect(header).toMatch(/^Why \(1 story package not as written\): /);
    expect(packages).toHaveLength(1);

    const { assignments } = explainerOn(dir);
    const reason = assignments.unmatched.find((entry) => entry.shipmentId === idOfRow(ANY_ROW))!.reason;
    expect(packages[0].title).toBe(`${titleStart(ANY_ROW)}expected ${expectedOfAnyRow}, got unmatched — ${reason}`);

    const { rows, options } = expectExplainerLines(dir, idOfRow(ANY_ROW), packages[0]);
    expect(rows.some((row) => row.feasible)).toBe(false);
    expect(packages[0].options[0]).toBe('no feasible option');
    expect(options.every((option) => option.startsWith('ruled out: '))).toBe(true);
    expect(options.some((option) => /\(\d+ min after the deadline\)/.test(option))).toBe(true);
    expect(packages[0].options.some((option) => option.includes('the plan it got'))).toBe(false);
  });

  it('--dry-run explains it the same way and exits 0', async () => {
    const dry = await script({ dir, argv: ['--dry-run'], env: {} });
    expect(dry.code).toBe(0);
    expect(totalCalls(dry.calls)).toBe(0);
    expect(explanationOf(dry.lines)).toEqual(explanationOf(run.lines));
  });
});

describe('runFetchScript: two story rows that are not as written', () => {
  it('explains both, in the order of the story file, and counts them', async () => {
    const dir = tempDirWithCacheOf(seed);
    editStory(dir, (story) => {
      story.shipments[RELAY_ROW].expect = 'direct';
      story.shipments[DIRECT_ROW].expect = 'relay';
    });
    const run = await script({ dir });

    expect(run.code).toBe(1);
    const { header, packages } = explanationOf(run.lines);
    expect(header).toMatch(/^Why \(2 story packages not as written\): /);
    expect(packages.map((entry) => entry.title)).toEqual([
      `${titleStart(DIRECT_ROW)}expected relay, got direct`,
      `${titleStart(RELAY_ROW)}expected direct, got relay`,
    ]);
    expectExplainerLines(dir, idOfRow(DIRECT_ROW), packages[0]);
    expectExplainerLines(dir, idOfRow(RELAY_ROW), packages[1]);
  });
});
