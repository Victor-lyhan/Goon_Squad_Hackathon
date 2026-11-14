// "The story works" on the real cache (DECISIONS pass 54, issue #492): the default NYC scenario, matched on the
// committed Google matrix, with a clean plan check, at least 20 of 24 packages matched, every `expect` row as
// written, the relay business each relay note names, and free trips left for the live demo request.
// If this fails after a story or matrix change, retune fixtures/nyc/demoStory.json; do not lower the numbers.
import { describe, expect, it } from 'vitest';
import { generateHomePool } from '../../server/domain/v2/generator';
import { TravelDataMissingError } from '../../shared/v2/types';
import {
  LIVE_DEMO_PAIRS, STORY_TEST_TIMEOUT_MS, checkWithLiveShipment, loadNycFixtures, planOfRow, relayBusinessNamedIn,
  requestLiveDelivery, runDefaultStory, type StoryRun,
} from './generator-v2-nyc-story-helper';

const fixtures = loadNycFixtures();
const story = fixtures.storyFile;

// Built once per file. A missing pair is kept, not thrown here, so it fails one named test instead of the file.
let run: StoryRun | undefined;
let runError: unknown;
try {
  run = runDefaultStory(fixtures);
} catch (error) {
  runError = error;
}
const theRun = (): StoryRun => {
  if (!run) throw runError;
  return run;
};

describe('NYC demo story on the committed Google matrix', () => {
  it('uses the schema default detour limit of 12 minutes', () => {
    expect(theRun().scenario.settings.defaultMaxExtraMin).toBe(12);
    expect(theRun().scenario.employees).toHaveLength(60);
    expect(theRun().scenario.shipments).toHaveLength(24);
  }, STORY_TEST_TIMEOUT_MS);

  it('finds every travel pair in the cache', () => {
    expect(runError instanceof TravelDataMissingError ? runError.message : undefined).toBeUndefined();
    expect(runError).toBeUndefined();
  }, STORY_TEST_TIMEOUT_MS);

  it('passes the independent plan check', () => {
    expect(theRun().issues).toEqual([]);
  }, STORY_TEST_TIMEOUT_MS);

  it('matches at least 20 of the 24 packages', () => {
    const { result } = theRun();
    expect(result.plans.length + result.unmatched.length).toBe(24);
    expect(result.plans.length).toBeGreaterThanOrEqual(20);
  }, STORY_TEST_TIMEOUT_MS);

  it('gives every direct row a direct plan and every relay row a relay plan', () => {
    const { storyRows } = theRun();
    const wrong = storyRows
      .filter(row => row.expect !== 'any' && row.actual !== row.expect)
      .map(row => `${row.shipmentId} ${row.label}: expected ${row.expect}, got ${row.actual}${row.reason ? ` (${row.reason})` : ''}`);
    expect(wrong).toEqual([]);
  }, STORY_TEST_TIMEOUT_MS);

  it('opens with at least 3 direct and 3 relay rows in the first 8', () => {
    const first = story.shipments.slice(0, 8);
    expect(first.filter(row => row.expect === 'direct').length).toBeGreaterThanOrEqual(3);
    expect(first.filter(row => row.expect === 'relay').length).toBeGreaterThanOrEqual(3);
  }, STORY_TEST_TIMEOUT_MS);

  it('relays through the business each relay note names', () => {
    const relayRows = story.shipments.map((row, index) => ({ row, index })).filter(({ row }) => row.expect === 'relay');
    expect(relayRows.length).toBeGreaterThanOrEqual(3);
    for (const { row, index } of relayRows) {
      const named = relayBusinessNamedIn(row.note, fixtures.businessesFile.businesses);
      // Every relay row in the story names its relay business; a note that names none or two is a story bug.
      expect(named, `${row.label}: note "${row.note ?? ''}" must name exactly one network business`).toBeDefined();
      expect(planOfRow(theRun(), index)?.relayBusinessId, row.label).toBe(named);
    }
  }, STORY_TEST_TIMEOUT_MS);

  it('gives the identical result on a second run', () => {
    const again = runDefaultStory(loadNycFixtures());
    const comparable = (r: StoryRun) => JSON.stringify({
      scenario: r.scenario, trips: r.trips, plans: r.result.plans, unmatched: r.result.unmatched,
      issues: r.issues, storyRows: r.storyRows,
    });
    expect(comparable(again)).toBe(comparable(theRun()));
  }, STORY_TEST_TIMEOUT_MS);
});

describe('NYC demo story homes', () => {
  it('keeps every featured home at the point the cache was fetched for', () => {
    // The cache is keyed by place ID: a moved home keeps the old point's travel times until a human refetches it
    // with `npm run fetch:routes -- --refetch <placeId>` (DECISIONS pass 46 and 50).
    const moved = story.featuredEmployees
      .filter(({ home }) => {
        const place = fixtures.matrix.places[home.id];
        return !place || place.lat !== home.lat || place.lng !== home.lng;
      })
      .map(({ id, home }) => `${id} ${home.id}: npm run fetch:routes -- --refetch ${home.id}`);
    expect(moved).toEqual([]);
  }, STORY_TEST_TIMEOUT_MS);

  it('has at most 20 featured employees, each on a story home or an exact home of the 120-home pool', () => {
    expect(story.featuredEmployees.length).toBeGreaterThanOrEqual(8);
    expect(story.featuredEmployees.length).toBeLessThanOrEqual(20);
    const pool = new Map(generateHomePool(fixtures.neighborhoodsFile.neighborhoods).map(home => [home.id, home]));
    const homeIds = story.featuredEmployees.map(employee => employee.home.id);
    expect(new Set(homeIds).size).toBe(homeIds.length);
    for (const { home } of story.featuredEmployees) {
      if (home.id.startsWith('home-story-')) continue;
      expect(pool.get(home.id), home.id).toEqual(home);
    }
  }, STORY_TEST_TIMEOUT_MS);
});

describe('NYC live demo request after the 24 story packages', () => {
  it('names at least 3 different sender and recipient pairs', () => {
    expect(new Set(LIVE_DEMO_PAIRS.map(pair => `${pair.originBusinessId}|${pair.destinationBusinessId}`)).size)
      .toBe(LIVE_DEMO_PAIRS.length);
    expect(LIVE_DEMO_PAIRS.length).toBeGreaterThanOrEqual(3);
  }, STORY_TEST_TIMEOUT_MS);

  it.each(LIVE_DEMO_PAIRS)('matches $originBusinessId to $destinationBusinessId as $kind on free trips', pair => {
    const base = theRun();
    const { shipment, plan, result } = requestLiveDelivery(base, pair.originBusinessId, pair.destinationBusinessId);
    expect(plan, result.unmatched.find(u => u.shipmentId === shipment.id)?.reason).toBeDefined();
    expect(plan!.kind).toBe(pair.kind);
    expect(plan!.relayBusinessId).toBe(pair.relayBusinessId);

    // The 24 story plans are untouched and the new plan uses only trips they left free.
    expect(result.plans.filter(p => p.shipmentId !== shipment.id)).toEqual(base.result.plans);
    const reserved = new Set(base.result.plans.flatMap(p => p.legs.map(leg => leg.tripId)));
    expect(plan!.legs.filter(leg => reserved.has(leg.tripId))).toEqual([]);
    expect(checkWithLiveShipment(base, shipment, result.plans)).toEqual([]);
  }, STORY_TEST_TIMEOUT_MS);
});
