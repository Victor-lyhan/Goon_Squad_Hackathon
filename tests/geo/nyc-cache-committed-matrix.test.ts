// Guard on the committed Google cache, part 1: fixtures/nyc/matrix.json (issue #498).
// The demo reads this file, the story is retuned on top of it and single homes are refetched with `--refetch`,
// so a partial refetch, a hand edit or a home that moved after the fetch must turn CI red, with the place ID and
// the command for the human in the message. tests/geo/nyc-cache.test.ts already checks the 18 geocoded
// businesses and the business pairs through the cache report; this file adds the homes (120 pool + story), their
// coordinates, every home ↔ business pair and the report's error rows with all homes in it.
// Part 2 (the route lines) is nyc-cache-committed-lines.test.ts. No network, no key, nothing written.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import businessesFixture from '../../fixtures/nyc/businesses.json';
import { pairKey } from '../../shared/v2/types';
import type { TravelFiles } from '../../server/geo/cache';
import { dropPlaces } from '../../server/geo/cacheEdit';
import { coverage, formatCacheReport, sanity } from '../../server/geo/cacheReport';
import {
  COMMITTED_CACHE_TEST_TIMEOUT_MS,
  cacheCounts,
  failureMessage,
  formatCounts,
  loadCommittedCache,
  loadExpected,
  neededPairs,
  ofCheck,
  pairProblems,
  placeProblems,
} from './nyc-cache-committed-helper';
import type { Expected } from './nyc-cache-committed-helper';

vi.setConfig({ testTimeout: COMMITTED_CACHE_TEST_TIMEOUT_MS, hookTimeout: COMMITTED_CACHE_TEST_TIMEOUT_MS });

let files: TravelFiles;
let expected: Expected;

beforeAll(() => {
  expected = loadExpected();
  files = loadCommittedCache();
});

describe('committed NYC travel cache: what the fixtures ask for', () => {
  it('is 18 businesses, the 120 pool homes and every home-story-* of demoStory.json, each ID once', () => {
    expect(expected.businessIds).toHaveLength(18);
    expect(expected.poolHomes.map((home) => home.id)).toEqual(Array.from({ length: 120 }, (_, i) => `home-${String(i + 1).padStart(3, '0')}`));
    expect(expected.storyHomes.length).toBeGreaterThan(0);
    // Every `home-story-*` written anywhere in demoStory.json is a featured employee's home, so a story home
    // that a later format puts somewhere else cannot slip past the checks below.
    expect(expected.storyHomes.map((home) => home.id).sort()).toEqual(expected.storyHomeIdsInText);
    const ids = [...expected.businessIds, ...expected.homes.map((home) => home.id)];
    expect(new Set(ids).size).toBe(18 + 120 + expected.storyHomes.length);
  });
});

describe('committed NYC travel cache: places (fixtures/nyc/matrix.json)', () => {
  it('holds every business, pool home and story home', () => {
    const problems = ofCheck(placeProblems(files, expected), 'place-missing');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });

  it('has every one of them inside the NYC box', () => {
    const problems = ofCheck(placeProblems(files, expected), 'outside-box');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });

  it('has every home exactly where the fixtures put it (a moved home keeps the old travel times until it is refetched)', () => {
    const problems = ofCheck(placeProblems(files, expected), 'home-moved');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });
});

describe('committed NYC travel cache: pairs (fixtures/nyc/matrix.json)', () => {
  it('holds home → business and business → home for every home, and all 18 x 17 business pairs', () => {
    expect(neededPairs(expected)).toHaveLength(expected.homes.length * 18 * 2 + 18 * 17);
    const problems = ofCheck(pairProblems(files, expected), 'pair-missing');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });

  it('has durationS > 0 and distanceM > 0 for every one of them', () => {
    const problems = ofCheck(pairProblems(files, expected), 'pair-value');
    expect(problems.map((problem) => problem.subject), failureMessage(problems)).toEqual([]);
  });

  it('gives a cache report (server/geo/cacheReport.ts) with no error row, and prints the place and pair counts', () => {
    const businesses = businessesFixture.businesses;
    const cov = coverage({ matrix: files.matrix, polylines: files.polylines, businessIds: expected.businessIds, homes: expected.homes, polylinePairs: [] });
    const findings = sanity({ matrix: files.matrix, businesses, homes: expected.homes });
    const text = formatCacheReport({ coverage: cov, sanity: findings, businesses, homes: expected.homes }).join('\n');

    const counts = cacheCounts(files, expected);
    console.log(formatCounts(counts));

    expect(cov.homes).toBe(120 + expected.storyHomes.length);
    // The report's own line for "no missing place, no missing pair, no sanity error"; the report is the message.
    expect(text.split('\n'), text).toContain('Errors: none');
    expect(findings.filter((finding) => finding.level === 'error').map((finding) => finding.message), text).toEqual([]);

    expect(counts.businesses).toBe(18);
    expect(counts.poolHomes).toBe(120);
    expect(counts.storyHomes).toBe(expected.storyHomes.length);
    expect(counts.homePairs).toBe(expected.homes.length * 18 * 2);
    expect(counts.businessPairs).toBe(18 * 17);
    expect(formatCounts(counts)).not.toMatch(/undefined|NaN|-\d/);
  });
});

// The guard has to bite. Each case breaks a copy of the committed cache in memory the way a partial refetch, a
// hand edit or a moved home would, and reads the message a red CI run would show. No file is written.
describe('committed NYC travel cache: the matrix checks catch a broken copy', () => {
  const copy = () => structuredClone(files);

  it('a home that moved after the fetch fails with its ID and the --refetch command', () => {
    const home = expected.poolHomes[40];
    // 0.00001 degrees of longitude is under a meter here: still not "the same coordinates".
    const moved = { ...expected, homes: expected.homes.map((other) => (other.id === home.id ? { ...other, lng: other.lng + 0.00001 } : other)) };

    const problems = placeProblems(files, moved);

    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([['home-moved', 'home-041']]);
    const message = failureMessage(problems);
    expect(message).toContain('home-041 is cached 0.8 m from where the fixtures put it');
    expect(message.split('\n')).toContain('  npm run fetch:routes -- --refetch home-041');
    // IDs and meters only: the message never prints a coordinate.
    expect(message).not.toMatch(/-?\d{1,3}\.\d{4,}/);
  });

  it('a story home moved in the cache file fails the same way, and two homes give one command', () => {
    const broken = copy();
    const story = expected.storyHomes[0];
    broken.matrix.places[story.id].lat += 0.002;
    broken.matrix.places['home-007'].lng -= 0.001;

    const problems = placeProblems(broken, expected);

    expect(problems.map((problem) => problem.subject).sort()).toEqual(['home-007', story.id].sort());
    expect(failureMessage(problems).split('\n')).toContain(`  npm run fetch:routes -- --refetch home-007 --refetch ${story.id}`);
  });

  it('a business outside the NYC box fails with its ID and the --refetch command', () => {
    const broken = copy();
    const id = expected.businessIds[0];
    broken.matrix.places[id].lat = 41.2;

    const problems = placeProblems(broken, expected);

    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([['outside-box', id]]);
    expect(failureMessage(problems).split('\n')).toContain(`  npm run fetch:routes -- --refetch ${id}`);
  });

  it('a home dropped by --refetch and not fetched again fails with its ID, its 36 pairs and the plain fetch command', () => {
    const { files: partial, dropped } = dropPlaces(files, ['home-099']);
    expect(dropped).toEqual(['home-099']);

    const places = placeProblems(partial, expected);
    const pairs = pairProblems(partial, expected);

    expect(places.map((problem) => [problem.check, problem.subject])).toEqual([['place-missing', 'home-099']]);
    expect(pairs).toHaveLength(36);
    expect(pairs.every((problem) => problem.check === 'pair-missing' && problem.subject.split('|').includes('home-099'))).toBe(true);
    // `--refetch` refuses an ID the cache holds nothing for, so the message must not send the human there.
    const message = failureMessage([...places, ...pairs]);
    expect(message).toContain('home-099 is not in matrix.json "places"');
    expect(message).toContain('... and 17 more');
    expect(message.split('\n')).toContain('  npm run fetch:routes');
    expect(message).not.toContain('--refetch');
  });

  it('a place deleted by hand while its pairs stay is sent to --refetch, which clears the leftovers', () => {
    const broken = copy();
    delete broken.matrix.places['home-050'];

    const problems = placeProblems(broken, expected);

    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([['place-missing', 'home-050']]);
    expect(failureMessage(problems).split('\n')).toContain('  npm run fetch:routes -- --refetch home-050');
  });

  it('one missing pair is named, in either direction and between two businesses', () => {
    const [a, b] = expected.businessIds;
    const broken = copy();
    delete broken.matrix.pairs[pairKey('home-001', a)];
    delete broken.matrix.pairs[pairKey(b, 'home-120')];
    delete broken.matrix.pairs[pairKey(b, a)];

    const problems = pairProblems(broken, expected);

    expect(problems.map((problem) => [problem.check, problem.subject])).toEqual([
      ['pair-missing', pairKey('home-001', a)],
      ['pair-missing', pairKey(b, 'home-120')],
      ['pair-missing', pairKey(b, a)],
    ]);
    expect(failureMessage(problems)).toContain(`home-001 → ${a} has no travel time`);
  });

  it('a zero, negative or missing number is named, and the home end of the pair is the one to refetch', () => {
    const [a, b] = expected.businessIds;
    const broken = copy();
    broken.matrix.pairs[pairKey('home-002', a)].durationS = 0;
    broken.matrix.pairs[pairKey(a, 'home-003')].distanceM = -5;
    (broken.matrix.pairs[pairKey(a, b)] as { durationS?: number }).durationS = undefined;

    const problems = pairProblems(broken, expected);

    expect(problems.map((problem) => [problem.check, problem.subject, problem.refetch])).toEqual([
      ['pair-value', pairKey('home-002', a), ['home-002']],
      ['pair-value', pairKey(a, 'home-003'), ['home-003']],
      ['pair-value', pairKey(a, b), [a]],
    ]);
    expect(failureMessage(problems).split('\n')).toContain(`  npm run fetch:routes -- --refetch ${a} --refetch home-002 --refetch home-003`);
  });

  it('no problem gives no message, and none of the cases above changed the committed cache in memory', () => {
    expect(failureMessage([])).toBe('');
    expect(placeProblems(files, expected)).toEqual([]);
    expect(pairProblems(files, expected)).toEqual([]);
  });
});
