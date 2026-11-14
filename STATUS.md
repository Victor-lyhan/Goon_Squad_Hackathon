# STATUS (maintained by the planner)

_Last update: 2026-11-14 11:07 (Sat), planner pass 43_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). GitHub was unchanged again (no open issues or PRs since pass 23), so this pass I read the interactive UI code (pages, hooks, effects) for bugs that static-render tests can't see. I found three and queued four issues (#317–#320). No test has failed; these come from reading the code, not from running the app in a browser.

## Main health: GREEN
- The three latest main runs in the state handed to the planner passed (10:08, 10:30, 10:32 planner commits). The last code merge is #316.
- `gh run list` and `gh pr list` still need approval in this run, so I couldn't recheck them. `gh issue list` ran and showed no open issues before I queued.

## Stuck
- None.

## In review
- None.

## Queued (label `ready`)
- #317 p2-b **[P0 demo]**: unsaved commute edits are wiped by the 1 s poll (`CommuteEditor.tsx:33`). Affects demo steps 1 and 7 and waypoints.
- #318 victor-2: map markers are drawn at the new position for one frame on each poll, then jump back and tween (`MapMarkers.tsx:45-64`).
- #319 p2-a: business mini-maps never get `runId`, so they keep the old city after Generate/Import (`ShipmentForm.tsx:126`, `TrackingDetail.tsx:34`).
- #320 p2-a: real-DOM test harness (`jsdom` devDependency, per-file) with UI-kit interaction tests.
- p1-a, p1-b and victor-1 have nothing queued: their code is fully exercised by domain and API tests (no filler, DECISIONS pass 13).

## Next up
- After #320 merges: one DOM interaction test issue per UI worker (edit a commute while polling, send flow, playback bar and Setup drawer clicks).
- From the humans: the M6 bug list, a two-tab browser walkthrough (spec §10), a fresh-clone `npm install && npm run dev` check, and answers on a global `testTimeout`, the Codex sandbox's EPERM on listen, and `scripts/worker.sh` hiding `gh pr create` errors (QUESTIONS passes 18–23). Then M6 (11 p.m. Sat): bug fixes only.

## Done (newest first)
- PR #316 (#303) p1-a: matcher/routing CI timing sweep. Matcher perf is 218 ms (default) and 554 ms (maximum), against limits of 2,000 and 5,000 ms.
- PR #315 (#314) victor-1: `notifications-cycles` cut from 8.4 s to about 1.0 s. New `commute-latency` test: demo commute PUT median about 26 ms, against a 150 ms budget.
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
- **Commute editor resets every second in a browser (#317).** Until it merges, an edit only sticks if Save is pressed within about a second.
- Simulator markers flicker once per poll while moving (#318). Cosmetic.
- Business mini-maps show the old city after Generate/Import until a page reload (#319).
- No test runs effects, clicks or timers; all UI tests are static renders (#320 starts fixing this). Nobody has done a real two-tab browser walkthrough.
- A commute PUT that rescues unmatched packages takes about 77 ms on the test city; the demo city is about 26 ms. Not being optimized before the freeze (DECISIONS pass 21).
- The `GET /api/simulator` payload is about 103 KB on the largest random city, against a 150 KB budget (#312).
- The p1-b Codex sandbox can't run the API tests (EPERM on `listen(0)`), so its PRs rely on CI.
- Setup drawer CRUD (nice-to-have 16) is blocked on `shared/` contracts.
