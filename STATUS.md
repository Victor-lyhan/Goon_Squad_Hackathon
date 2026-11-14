# STATUS (maintained by the planner)

_Last update: 2026-11-14 03:45 (Sat), planner pass 7_

## Current milestone: M4 code complete → verification; M5 mostly in review
Must-haves 1–10 are all merged (PRs #90, #92, #93 this round). M5: recompute/reset/compare handlers (#94), scrubber (#91), waypoints (#96) merged; generate/import/export (#97) and the Setup drawer (#99) are in review. This pass queues real-data verification of the demo path (API + all three UIs) instead of new features.

## Main health
- CI on main: green (b827f01, PR #96). No `stuck` items.

## In review (PRs green, waiting for the reviewer)
- PR #97 (#79) victor-1: scenario generate/export/import handlers (unregistered)
- PR #99 (#82) victor-2: Setup drawer + ComparePanel
- PR #98 (#87) p1-a: matching perf (< 2 s) + specific unmatched reasons
- PR #100 (#88) p1-b: generator/metrics bounds tests

## Queued (label `ready`), 10 issues
- #101 victor-1: register compare/recompute/reset routes, 5 MB JSON limit
- #102 victor-1: end-to-end API test of demo steps 1–6 + field-error validation tests
- #103 victor-2: simulator real-data render audit (avoids #99's files)
- #104 p1-a: matcher random-city determinism + invariants (test-only; matching.ts in #98)
- #105 p1-b: timeline/snapshotAt random-city invariants + perf
- #106 p2-a: send-form mini-map + tracking route map
- #107 p2-a: business portal real-data render audit
- #108 p2-a: API connection banner in the shell
- #109 p2-b: employee jobs/earnings real-data render audit
- #110 p2-b: commute layout (map beside editor, sticky save, saved-route confirmation, locked)

## Next up (queue once dependencies merge)
- victor-1: register `/api/scenario/*` routes once #97 merges (then the Setup drawer is fully live).
- p1-a: fix any bug #104 marks `it.fails`, after #98 merges.
- README with setup + 2-minute demo steps (needs an owner, see QUESTIONS.md).
- Setup drawer CRUD for businesses/employees (16) needs a contract in `shared/`; not queued (QUESTIONS.md).
- M6 (11 p.m. Sat): bug fixes only, from the humans' list.

## Done (newest first)
- PR #96 (#86) p2-b: route waypoints · PR #93 (#85) p2-b: full EmployeePortal
- PR #95 (#84) p2-a: focus-visible, reduced motion, 390 px · PR #92 (#83) p2-a: full BusinessPortal
- PR #94 (#78) victor-1: planning handlers · PR #90 (#77) victor-1: shipment write path + unmatched retry (spec 9)
- PR #91 (#81), #89 (#80) victor-2: scrubber + reduced-motion markers; leg highlight
- PR #76 (#66), #73 (#65) p2-a: ShipmentList + TrackingDetail; ShipmentForm + result cards
- PR #75 (#68) p1-a: `direct_only` + `compareAssignments`
- PR #74 (#64), #71 (#63) victor-2: shared formatters; Simulator page with 1 s polling
- PR #72 (#62) victor-1: Demo city loads fully matched
- PR #69, #53, #51, #37, #35, #24, #22, #11, #10 victor-1: read routes, views, simulator API, ticker, commute, clock, client API, store
- PR #70, #60, #59 p2-b: JobDetail, CommuteEditor, JobCard
- PR #58, #57, #40, #39, #26, #25, #13 p1-b: demo options, markers, generator, snapshotAt, timeline, pricing + metrics
- PR #56, #38, #12 p1-a: allocation, candidates, routing
- PR #55, #52, #36, #34, #23, #21, #9 victor-2: sim components, CityMap · PR #54, #42, #41 p2-a: shell, UI kit, landing · M0 by humans

## Known bugs / gaps
- Demo steps 1–6 not yet verified end to end against real data (#102, #103, #107, #109). Nobody has run a two-tab browser walkthrough; humans should do one in the morning.
- Setup drawer's Generate/Export/Import/Compare/Reset buttons need #97 + #101 + the scenario-route follow-up before they work in the running app.
- No README demo steps yet.
