# STATUS (maintained by the planner)

_Last update: 2026-11-14 03:58 (Sat), planner pass 8_

## Current milestone: M5 wrap-up → verification + demo polish (ahead of schedule)
Must-haves 1–10 and nearly all of M5 are merged. The last pass's whole queue (#101–#110) merged as PRs #111–#120. The one M5 gap left is registering the `/api/scenario/*` routes (#121, PR #129 already open). This pass queues demo-path verification over playback, random/zero-hub city hardening, cross-portal deep links, keyboard playback and the README.

## Main health
- CI on main: green through #119 (PR for #104). The run for PR #120 (#105) was still in progress at 03:53. No `stuck` items.

## In review
- PR #129 (#121) victor-1: register scenario routes

## Queued (label `ready`), 16 issues
- victor-1: #121 scenario routes + app tests · #122 README.md + sync test · #123 planning-cycle flow test (demo step 7, 409s, restart)
- p2-a: #124 landing "Run the demo" strip with live facts · #125 carrier + simulator links on Delivery arranged / tracking · #126 business playback test (sender = recipient delivered time)
- victor-2: #127 `/simulator?package=` deep link + runId refetch · #128 playback keyboard shortcuts · #130 random/zero-hub map render
- p2-b: #131 employee playback test (spec 12, history, earnings) · #132 job detail links + live progress · #133 commute editor edge states
- p1-a: #134 matcher edge cases · #136 spec test 10 (waypoints/availability/detour, test-only)
- p1-b: #137 sim/metrics edge runs · #138 random-city generator quality

## Next up
- victor-2: add a "Recompute matches" button to the Setup drawer (`recomputeMatches` exists in `client/src/api/` but nothing calls it). Needed for demo step 7. Queue after #127 merges (same file).
- Fix whatever the new tests mark `it.fails` (#126, #131, #136) once their owners' files are free.
- Setup drawer CRUD for businesses/employees (16) is still blocked on a `shared/` contract (QUESTIONS.md); treated as cut.
- M6 (11 p.m. Sat): bug fixes only, from the humans' list. A human two-tab browser walkthrough is still needed.

## Done (newest first)
- PR #120 (#105) p1-b: timeline/snapshotAt random invariants · PR #119 (#104) p1-a: matcher random determinism
- PR #118 (#108), #117 (#107), #113 (#106) p2-a: connection banner; business real-data audit; send-form + tracking maps
- PR #116 (#110), #112 (#109) p2-b: commute layout + locked state; employee real-data audit
- PR #115 (#102), #111 (#101) victor-1: demo steps 1–6 API test + field errors; compare/recompute/reset routes
- PR #114 (#103) victor-2: simulator real-data audit
- PR #100 (#88) p1-b: generator/metrics bounds · PR #98 (#87) p1-a: matching perf + reasons
- PR #99 (#82) victor-2: Setup drawer + ComparePanel · PR #97 (#79) victor-1: scenario handlers
- PR #96 (#86), #93 (#85) p2-b: waypoints; EmployeePortal · PR #95 (#84), #92 (#83) p2-a: a11y/390 px; BusinessPortal
- PR #94 (#78), #90 (#77) victor-1: planning handlers; shipment write path · PR #91, #89 victor-2: scrubber; leg highlight
- PR #76, #73 p2-a · #75 p1-a · #74, #71 victor-2 · #72 victor-1: Demo city · earlier: see git log (M0–M3)

## Known bugs / gaps
- Generate/Export/Import in the Setup drawer 404 until #121 merges.
- No README yet (#122).
- Nobody has done a real two-tab browser walkthrough; all verification so far is server-side render tests.
