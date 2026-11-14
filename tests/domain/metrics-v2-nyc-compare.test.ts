// #531: both halves of the direct-only comparison (POST /api/v2/matches/compare, computed by compareRun) on
// the REAL default NYC run and on three Random city seeds: each half adds up, equals its own plans, and
// relay never matches fewer packages than direct only. The rules live in metrics-v2-nyc-helper.ts.
import { NYC_RUNS, describeCompareRules } from './metrics-v2-nyc-helper';

for (const { title, request } of NYC_RUNS) describeCompareRules(title, request);
