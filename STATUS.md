# STATUS (maintained by the planner)

_Last update: 2026-11-14 06:14 (Sat), planner pass 18_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Since pass 17: no merges. #300 went `stuck` because the CI log showed the failure is in another worker's file. This pass re-routed it to #301 (p1-b) and closed #300.

## Main health: RED
- The last 3 main runs failed (since PR #297 merged). The p1-a worker read the CI log (run 43587593187). The only failure is `tests/domain/metrics-timeline.test.ts` (p1-b, from PR #285): one test loops over 22 generated cities under a 4.5 s timeout and took 5.7 s on CI. That's 1 failed out of 1,490 tests. `matching-properties.test.ts` passed (13 s for 50 tests, slowest 760 ms).
- Fix queued: **#301** (p1-b, P0). It splits the test into one test per city, gives each a CI-sized timeout and walks the events once.
- Every other explicit timeout in `tests/` is ≥ 10 s, so no other test is this close to its limit.

## Stuck
- #300 (p1-a) closed: the cause was outside p1-a's files. Replaced by #301.

## In review
- None.

## Queued (label `ready`)
- p1-b: **#301** [P0] metrics-timeline test per city, CI-sized timeouts.
- p1-a, victor-1, victor-2, p2-a, p2-b: nothing. Their areas are covered by spec tests and audits (DECISIONS pass 13: no filler). Waiting on the humans' M6 bug list.

## Next up
- Get main green (#301). Then M6 (11 p.m. Sat): bug fixes only, from the humans' list. Still needed from humans: a two-tab browser walkthrough (spec §10) and a fresh-clone `npm install && npm run dev` check.

## Done (newest first)
- PR #299 (#298) p2-a: connection banner uses the `client/src/api` health probe, no overlapping probes (no raw `fetch` left in UI code)
- PR #297 (#259), #294 (#257), #293 (#136), #292 (#134) p1-a: matcher property tests on 20 seeds; routing insertion §6; spec test 10; matcher edge cases
- PR #285 (#271), #283 (#256), #270 (#255), #267 (#254) p1-b: metrics at every event minute; spec test 7; simulation §7 audit; generator §5 audit
- PR #296 (#295), #284 (#277), #282 (#276), #280 (#275) p2-a: business poll cancellation; accessible toasts; tracking drawer §3A; reconnect/runId
- PR #290 (#287), #281 (#274), #278 (#273), #268 (#250) victor-2: simulator poll cancellation; map on the largest city; package queue §3C; compare honesty
- PR #289 (#286), #279 (#272), #269 (#247), #266 (#245) victor-1: health probe in client/src/api; clean shutdown + busy port; notifications across cycles; abortable GETs
- PR #291 (#288), #261 (#253), #246 (#227) p2-b: employee poll abort on identity switch; job feed; reconnect/runId
- PR #240 and earlier: see git log

## Known bugs / gaps
- Main CI red since PR #297's merge, caused by the timeout in `metrics-timeline.test.ts` (#301).
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- Setup drawer CRUD (nice-to-have 16) is blocked on `shared/` contracts.
