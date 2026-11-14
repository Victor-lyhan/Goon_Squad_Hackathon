# STATUS (maintained by the planner)

_Last update: 2026-11-14 09:14 (Sat), planner pass 34_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). All six CI timing sweeps are merged (#309–#313, #316). There are no open issues or PRs, and nothing has changed since pass 23 (07:13); passes 24–34 found the same state, and no human has edited QUESTIONS.md, DECISIONS.md, SPEC.md, AGENTS.md or `shared/` since then. I queued nothing this pass: every area already has spec, real-data, 390 px, reduced-motion and poll-abort tests, so new issues would be filler (DECISIONS pass 13).

## Main health: GREEN
- The last three main runs passed: the 08:42, 08:53 and 09:04 planner commits. The last code change, the #316 (#303) merge, also passed.
- Every test area now has explicit CI timeouts and builds its data once per file.

## Stuck
- None.

## In review
- None.

## Queued (label `ready`)
- None. All six workers are idle by design until the humans send the M6 bug list.

## Next up
- From the humans: the M6 bug list, a two-tab browser walkthrough (spec §10), a fresh-clone `npm install && npm run dev` check, and answers on a global `testTimeout`, the Codex sandbox's EPERM on listen, and `scripts/worker.sh` hiding `gh pr create` errors (QUESTIONS passes 18–23). Then M6 (11 p.m. Sat): bug fixes only.

## Done (newest first)
- PR #316 (#303) p1-a: matcher/routing CI timing sweep. 346 tests measured; generated-city tests get explicit 10 s timeouts. Matcher perf is 218 ms (default) and 554 ms (maximum), against limits of 2,000 and 5,000 ms. The pass 22 rerun opened its PR normally.
- PR #315 (#314) victor-1: `notifications-cycles` cut from 8.4 s to about 1.0 s (all assertions kept). New `commute-latency` test: the demo commute PUT median is about 26 ms, against a 150 ms budget. The PUT cost is the matcher retrying unmatched packages (25–40 ms per PUT).
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
- A commute PUT that rescues unmatched packages takes about 77 ms on the `notifications-cycles` test city (matcher retry). The demo city is about 26 ms. Not being optimized before the freeze (DECISIONS pass 21).
- The `GET /api/simulator` payload is about 103 KB on the largest random city, against a 150 KB budget (#312). It passes, but there's limited headroom.
- The p1-b Codex sandbox can't run the API tests (EPERM on `listen(0)`), so its PRs rely on CI.
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- Setup drawer CRUD (nice-to-have 16) is blocked on `shared/` contracts.
