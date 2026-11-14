# STATUS (maintained by the planner)

_Last update: 2026-11-14 03:15 (Sat), planner pass 5_

## Current milestone: M2/M3 (M1 done except p2-b components #8, #20)
All M1 engine work is merged: greedy allocation (PR #56), markers (PR #57) and the demo scenario options (PR #58). The UI kit (PR #42) and the simulator API + ticker (PR #51) are also in. This pass queues the portal read routes, the Demo city loaded fully matched, the Simulator page, and business/employee building blocks.

## Main health
- CI on main: green (381eee1, PR #58). No `stuck` items. Open PR: #59 (#8 JobCard), needs review.

## Queued (label `ready`)
- #61 victor-1: GET dashboard/shipment/job routes (`server/api/portals.ts`)
- #62 victor-1: demo fixture + `materializeAssignment` pipeline, demo loads pre-matched
- #63 victor-2: Simulator page assembly, 1 s polling
- #64 victor-2: swap sim formatters for `client/src/ui/format.ts`
- #65 p2-a: ShipmentForm + Delivery arranged / no-match cards
- #66 p2-a: business ShipmentList + TrackingDetail
- #67 p2-b: employee JobDetail
- #68 p1-a: `direct_only` mode + `compareAssignments`

## In progress
- #20 p2-b: CommuteEditor + commuteModel
- #8 p2-b: JobCard (PR #59 in review)

## Next up (queue once dependencies merge)
- victor-1: `POST /api/shipments` (idempotent, reuses `pipeline.ts`; spec test 9; after #62, #61), `PATCH /api/shipments/:id` + `POST /:id/match`, retry unmatched in `PUT /commute` (after #62), `POST /api/matches/compare` (after #68).
- p2-a: BusinessPortal page (nav, summary cards, lists, drawer, form wiring, 1 s polling; after #61, #65, #66 + POST route).
- p2-b: EmployeePortal page (commute editor wired to PUT, job feed, earnings, job detail deep link; after #8, #20, #61, #67).
- victor-2: selected-package route highlight on the map; Simulator polish after #63.
- p1-b: no M2–M4 domain work left; idle this pass (8-issue cap). Candidates: matching performance check on the default scenario (spec §6 target < 2 s), M5 generator controls support.

## Done
- PR #58 (#45) p1-b: `DEMO_SCENARIO_OPTIONS` (2 direct / 2 relay demo matches)
- PR #57 (#44) p1-b: markers + package positions in `snapshotAt`
- PR #56 (#43) p1-a: `assignShipments` greedy allocation (spec tests 4, 7, 10)
- PR #55 (#49) victor-2: sim/PackageDetail · PR #52 (#48) victor-2: marker tween + MapMarkers
- PR #54 (#50) p2-a: Demo account selector + real default IDs
- PR #53 (#47) victor-1: pure portal view builders `server/api/views.ts`
- PR #51 (#46) victor-1: `GET /api/simulator`, `POST /api/simulator/control`, ticker started
- PR #42 (#6) p2-a: UI kit + `client/src/ui/format.ts` · PR #41 (#5) p2-a: app shell, router, landing
- PR #40 (#29) p1-b: `generateScenario` · PR #39 (#28) p1-b: `snapshotAt` (spec 6, 12)
- PR #38 (#27) p1-a: candidates (spec 1, 2, 3, 5) · PR #37 (#31) victor-1: clock ticker
- PR #36 (#33), #34 (#32), #23 (#19), #21 (#18) victor-2: MetricsCards, Timeline, PackageQueue, PlaybackBar
- PR #35 (#30) victor-1: trips on load + `PUT /commute` · PR #24 (#17) clock · PR #22 (#16) read routes
- PR #26, #25, #13 p1-b: PRNG/grid, `buildTimeline`, pricing + metrics · PR #12 p1-a: routing
- PR #11, #10, #9: client API helpers, store, CityMap · M0 scaffold by humans

## Known bugs
- `fixtures/demoScenario.json` is still `{}`, so the server falls back to the relay fixture with no shipments (fix: #62).
- No end-to-end matching through the API yet: `POST /api/shipments` is not built (next after #62).
- BusinessPortal, EmployeePortal and Simulator pages are still placeholders.
