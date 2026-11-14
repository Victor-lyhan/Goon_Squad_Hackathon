# STATUS (maintained by the planner)

_Last update: 2026-11-14 06:26 (Sat), planner pass 19_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Since pass 18: #302 (#301) merged and main is green again. This pass queued one CI timing sweep per worker (#303–#308).

## Main health: GREEN
- The latest main run (#302 merge) passed. #301 split `metrics-timeline.test.ts` into one test per city with CI-sized timeouts.
- Remaining risk: `vitest.config.ts` still uses the 5 s default timeout, and about 25 test files build generated cities, start real servers or check wall-clock budgets. Most of them set no explicit timeout. #303–#308 sweep them, one worker per test area.

## Stuck
- None.

## In review
- None.

## Queued (label `ready`), all test-only, disjoint test paths
- p1-a **#303** `tests/domain/matching*|routing*` · p1-b **#304** `tests/domain/sim*|metrics*|generator*`
- victor-1 **#305** `tests/api/` · victor-2 **#306** `tests/ui/sim*|map*`
- p2-a **#307** `tests/ui/business*|landing*|kit*` · p2-b **#308** `tests/ui/employee*|commute*`
- One issue per worker, not 4. No filler (DECISIONS pass 13).

## Next up
- Merge #303–#308, so CI stays green until the freeze. Then M6 (11 p.m. Sat): bug fixes only, from the humans' list. Still needed from humans: a two-tab browser walkthrough (spec §10), a fresh-clone `npm install && npm run dev` check, and an answer on a global `testTimeout`.

## Done (newest first)
- PR #302 (#301) p1-b: metrics-timeline test per city, CI-sized timeouts (main green again)
- PR #299 (#298) p2-a: connection banner uses the `client/src/api` health probe, no overlapping probes
- PR #297 (#259), #294 (#257), #293 (#136), #292 (#134) p1-a: matcher property tests on 20 seeds; routing insertion §6; spec test 10; matcher edge cases
- PR #285 (#271), #283 (#256), #270 (#255), #267 (#254) p1-b: metrics at every event minute; spec test 7; simulation §7 audit; generator §5 audit
- PR #296 (#295), #284 (#277), #282 (#276), #280 (#275) p2-a: business poll cancellation; accessible toasts; tracking drawer §3A; reconnect/runId
- PR #290 (#287), #281 (#274), #278 (#273), #268 (#250) victor-2: simulator poll cancellation; map on the largest city; package queue §3C; compare honesty
- PR #289 (#286), #279 (#272), #269 (#247), #266 (#245) victor-1: health probe in client/src/api; clean shutdown + busy port; notifications across cycles; abortable GETs
- PR #291 (#288), #261 (#253), #246 (#227) p2-b: employee poll abort on identity switch; job feed; reconnect/runId
- PR #240 and earlier: see git log

## Known bugs / gaps
- CI timing flakes are possible in any test that sets no explicit timeout (#303–#308).
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- Setup drawer CRUD (nice-to-have 16) is blocked on `shared/` contracts.
