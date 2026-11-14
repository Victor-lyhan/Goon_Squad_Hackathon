# STATUS (maintained by the planner)

_Last update: 2026-11-14 03:23 (Sat), planner pass 6_

## Current milestone: M2–M4 finishing; M5 started in parallel
Everything queued last pass is merged (PRs #59, #60, #69–#76). M1 is complete. The remaining must-have work is the shipment write path (#77) and the two portal pages (#83, #85). The roster had spare capacity and no file conflicts, so the first M5 items are queued too: compare, recompute/reset, generate/import/export, scrubber and waypoints.

## Main health
- CI on main: green (898c368, PR #76). No `stuck` items. No open PRs.

## Queued (label `ready`), 12 issues
- #77 victor-1: POST/PATCH `/api/shipments`, `/:id/match`, unmatched retry on PUT `/commute` (spec test 9)
- #78 victor-1: `server/api/planning.ts` compare / recompute / planning reset handlers (not yet registered)
- #79 victor-1: `server/api/scenario.ts` generate / export / import handlers (not yet registered)
- #80 victor-2: selected-package leg highlight (`CityMap highlightRoutes`)
- #81 victor-2: PlaybackBar scrubber + reduced-motion markers
- #82 victor-2: Setup drawer: ComparePanel, generate, export/import, new planning cycle
- #83 p2-a: full BusinessPortal page (send flow, lists, drawer, notifications, polling)
- #84 p2-a: focus-visible, reduced motion, 390 px shell + UI kit
- #85 p2-b: full EmployeePortal page (commute save, jobs, history, detail, earnings, polling)
- #86 p2-b: Adjust my route waypoints in CommuteEditor
- #87 p1-a: matching perf (< 2 s default) + specific unmatched reasons
- #88 p1-b: generator/metrics bounds hardening (no NaN)

## Next up (queue once dependencies merge)
- victor-1: register #78 and #79 routes in `server/index.ts` (+ `express.json` 5 MB limit) once #77 merges, plus an end-to-end API test of demo steps 2–5.
- Each worker got only 1–3 issues: more would have meant two issues editing the same file (`server/index.ts`, the page files).
- After #77, #83 and #85 merge: two-tab demo walkthrough (steps 1–6) → bug list → M6 polish. README demo steps.
- Setup drawer CRUD for businesses/employees (16) is not queued yet.

## Done
- PR #76 (#66) p2-a: ShipmentList + TrackingDetail · PR #73 (#65) p2-a: ShipmentForm + result cards
- PR #75 (#68) p1-a: `direct_only` + `compareAssignments`
- PR #74 (#64), #71 (#63) victor-2: shared formatters; Simulator page with 1 s polling
- PR #72 (#62) victor-1: Demo city loads fully matched via `materializeAssignment`
- PR #69 (#61) victor-1: GET dashboard / shipment / job routes
- PR #70 (#67), #60 (#20), #59 (#8) p2-b: JobDetail, CommuteEditor, JobCard
- PR #58 (#45), #57 (#44) p1-b: demo scenario options; markers in `snapshotAt`
- PR #56 (#43) p1-a: greedy allocation (spec 4, 7, 10) · PR #38 (#27) candidates (spec 1, 2, 3, 5)
- PR #55, #52, #36, #34, #23, #21 victor-2: PackageDetail, markers, MetricsCards, Timeline, PackageQueue, PlaybackBar
- PR #54, #42, #41 p2-a: Demo account selector; UI kit + format.ts; shell, router, landing
- PR #53, #51, #37, #35, #24, #22, #11, #10 victor-1: views, simulator API, ticker, commute, clock, read routes, client API, store
- PR #40, #39, #26, #25, #13 p1-b: generator, `snapshotAt`, PRNG/grid, timeline, pricing + metrics · PR #12 p1-a: routing · PR #9 CityMap · M0 by humans

## Known bugs / gaps
- `POST /api/shipments` does not exist yet, so demo steps 2–4 can't run end to end (#77).
- BusinessPortal and EmployeePortal pages are placeholders (#83, #85).
- `PUT /commute` returns `rematchedShipmentIds: []` (TODO; fixed by #77).
- No way to unlock after pressing Play until `/api/planning/reset` is registered (#78 + follow-up).
