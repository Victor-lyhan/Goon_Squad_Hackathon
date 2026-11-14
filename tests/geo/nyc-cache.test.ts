// The committed NYC travel cache (fixtures/nyc/matrix.json), checked with the cache report.
// The cache is written by a human running `npm run fetch:routes` with the real key. Until it is committed there is
// nothing to check, so the test is skipped under a name that says why. No network and no key either way.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import businessesFixture from '../../fixtures/nyc/businesses.json';
import demoStoryFixture from '../../fixtures/nyc/demoStory.json';
import type { Home, PolylinesFile, TravelMatrixFile } from '../../shared/v2/types';
import { coverage, formatCacheReport, sanity } from '../../server/geo/cacheReport';

const dir = path.resolve(__dirname, '../../fixtures/nyc');
const matrixPath = path.join(dir, 'matrix.json');
const polylinesPath = path.join(dir, 'polylines.json');
const cacheExists = fs.existsSync(matrixPath);

const businesses = businessesFixture.businesses;
const storyHomes: Home[] = demoStoryFixture.featuredEmployees.map((employee) => employee.home);

function readCache(): { matrix: TravelMatrixFile; polylines: PolylinesFile } {
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as TravelMatrixFile;
  const polylines: PolylinesFile = fs.existsSync(polylinesPath)
    ? (JSON.parse(fs.readFileSync(polylinesPath, 'utf8')) as PolylinesFile)
    : { schemaVersion: 1, polylines: {} };
  return { matrix, polylines };
}

describe('NYC travel cache (fixtures/nyc/matrix.json)', () => {
  it('has the 18 businesses to check the cache against', () => {
    expect(businesses).toHaveLength(18);
    expect(new Set(businesses.map((business) => business.id)).size).toBe(18);
  });

  const name = cacheExists
    ? 'geocodes all 18 businesses, holds every business ↔ business pair and has no sanity error'
    : 'SKIPPED: fixtures/nyc/matrix.json does not exist yet (a human runs `npm run fetch:routes` and commits it); nothing to check';

  it.skipIf(!cacheExists)(name, () => {
    const { matrix, polylines } = readCache();
    const cov = coverage({ matrix, polylines, businessIds: businesses.map((business) => business.id), homes: storyHomes, polylinePairs: [] });
    const findings = sanity({ matrix, businesses, homes: storyHomes });
    // The report text is the failure message, so a red test says which business or pair is wrong.
    const text = formatCacheReport({ coverage: cov, sanity: findings, businesses, homes: storyHomes }).join('\n');

    expect(cov.businesses.needed).toBe(18);
    expect(cov.businesses.missing, text).toEqual([]);
    expect(cov.businessPairs.needed).toBe(18 * 17);
    expect(cov.businessPairs.missing, text).toEqual([]);
    expect(findings.filter((finding) => finding.level === 'error'), text).toEqual([]);
    expect(text).not.toMatch(/undefined|NaN/);
  });
});
