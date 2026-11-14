// The read route files only put merged pieces in order. They must not reach for test-only travel data,
// the file system, MVP 1 handlers, or v2 modules that belong to other open issues.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['server/api/v2/readRoutes.ts', 'server/api/v2/compareOps.ts', 'server/api/v2/mapLines.ts'];

// `from '…'`, `import '…'`, `import('…')`, `require('…')`.
const SPECIFIER = /(?:from|import|require)\s*\(?\s*['"`]([^'"`\n]+)['"`]/g;
const specifiersIn = (source: string) => [...source.matchAll(SPECIFIER)].map((m) => m[1]);

const isFs = (spec: string) => /^(node:)?fs(\/.*)?$/.test(spec);
const isFakeProvider = (spec: string) => /fakeProvider/i.test(spec);
/** A relative import that lands directly in server/api/ (the MVP 1 handlers), not in server/api/v2/. */
function isMvp1Handler(file: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false;
  const target = path.resolve(repoRoot, path.dirname(file), spec);
  return path.dirname(target) === path.join(repoRoot, 'server', 'api');
}
// Modules of other open issues, or not on main: this group must work without them.
const OTHER_ISSUES = [
  'shipmentOps', 'planningOps', 'commutePlan', 'pipeline', 'initialRun', 'controlOps', 'controlRoutes', 'ticker',
  'simulation', 'movement',
];
const isOtherIssue = (spec: string) => OTHER_ISSUES.includes(path.basename(spec).replace(/\.[cm]?[jt]sx?$/, ''));

const forbidden = (file: string, spec: string) =>
  isFs(spec) || isFakeProvider(spec) || isMvp1Handler(file, spec) || isOtherIssue(spec);

describe('imports of the v2 read routes', () => {
  it('the check itself catches each forbidden kind and lets the allowed imports through', () => {
    const file = FILES[0];
    for (const line of [
      "import fs from 'node:fs';",
      "import { readFileSync } from 'fs';",
      "import { readFile } from 'node:fs/promises';",
      "const fs = require('fs');",
      "import { createFakeProvider } from '../../geo/fakeProvider';",
      "const fake = await import('../../geo/fakeProvider.ts');",
      "import { getMap } from '../map';",
      "import { postCompare } from '../planning.ts';",
      "import { snapshotAt } from '../../domain/v2/simulation';",
      "import { createInitialRun } from './initialRun';",
    ]) {
      expect(specifiersIn(line).some((spec) => forbidden(file, spec)), line).toBe(true);
    }
    for (const line of [
      "import type { Router } from 'express';",
      "import type { Store } from '../../store';",
      "import { mapResponse } from './views';",
      "import { compareAssignments } from '../../domain/v2/matching';",
      "import { CompareRequest } from '../../../shared/v2/schemas';",
      '// the fake provider and fs are never imported here',
    ]) {
      expect(specifiersIn(line).some((spec) => forbidden(file, spec)), line).toBe(false);
    }
  });

  it.each(FILES)('%s imports no fake provider, no fs, no MVP 1 handler and no module of another open issue', (file) => {
    const specs = specifiersIn(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.filter((spec) => forbidden(file, spec))).toEqual([]);
  });

  it('the only runtime imports are the views, the compare step, the map-line step, the request schema, the matcher and the metrics', () => {
    // Whole `import … from '…'` statements (they may span lines) that are not `import type`.
    const RUNTIME_IMPORT = /^import\s+(?!type\b)[^;]*?from\s+['"]([^'"\n]+)['"]/gm;
    const runtime = (file: string) =>
      [...fs.readFileSync(path.join(repoRoot, file), 'utf8').matchAll(RUNTIME_IMPORT)].map((m) => m[1]).sort();
    expect(runtime('server/api/v2/readRoutes.ts')).toEqual(['./compareOps', './mapLines', './views']);
    // The map's route-line step (issue #536) gets the travel service's function as an argument; it imports no server/geo.
    expect(runtime('server/api/v2/mapLines.ts')).toEqual(['../../../shared/v2/types']);
    expect(runtime('server/api/v2/compareOps.ts')).toEqual([
      '../../../shared/v2/schemas', '../../domain/v2/matching', '../../domain/v2/metrics',
    ]);
  });
});
