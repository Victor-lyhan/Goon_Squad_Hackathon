# STATUS (maintained by the planner)

_Last update: 2026-11-14 06:38 (Sat), planner pass 20_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Since pass 19, five of the six CI timing sweeps are merged (#309–#313). This pass queued one follow-up from them (#314).

## Main health: GREEN
- The latest finished main runs (#305, #307 merges) passed. The run for #313 (#304) was still in progress at 06:38.
- Every test area except `tests/domain/matching*|routing*` (#303) now has explicit CI timeouts and builds its data once per file.

## Stuck
- None.

## In review
- **#303** p1-a, matcher/routing timing sweep. It's labeled `in-review`, but there was no open PR at 06:38. Check next pass.

## Queued (label `ready`)
- victor-1 **#314** `tests/api/notifications-cycles*` plus a new `commute-latency` test: find out why the test takes 10–15 s, get it under 3 s, and add a commute PUT budget (demo step 7).
- Every other worker has no issue by design (no filler, DECISIONS pass 13).

## Next up
- Merge #303 and #314. If #314 finds that the cost is in `matching.ts`, queue the fix for p1-a. Then M6 (11 p.m. Sat): bug fixes only, from the humans' list. Still needed from humans: a two-tab browser walkthrough (spec §10), a fresh-clone `npm install && npm run dev` check, and answers on a global `testTimeout` and on the Codex sandbox's EPERM on listen.

## Done (newest first)
- PR #313 (#304) p1-b, #312 (#305) victor-1, #311 (#307) p2-a, #310 (#308) p2-b, #309 (#306) victor-2: CI timing sweeps (explicit 3x timeouts, data built once per file, perf limits unchanged)
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
- `notifications-cycles` takes 9.5–14.8 s locally. The commute PUT latency in demo step 7 isn't measured yet (#314).
- The `GET /api/simulator` payload is about 103 KB on the largest random city, against a 150 KB budget (#312). It passes, but there's limited headroom.
- The p1-b Codex sandbox can't run the API tests (EPERM on `listen(0)`), so its PRs rely on CI.
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- Setup drawer CRUD (nice-to-have 16) is blocked on `shared/` contracts.
