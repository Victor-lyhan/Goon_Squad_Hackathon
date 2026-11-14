# STATUS (maintained by the planner)

_Last update: 2026-11-14 02:58 (Sat), planner pass 4_

## Current milestone: M1 finishing, M2/M3 backend underway (M1 target 6:00 a.m. Sat)
M1 engine work is merged except greedy allocation (#43). The app shell is in (PR #41). Left in M1: UI kit (#6, PR #42 in review) and the p2-b components (#20, #8). M2/M3 pieces whose dependencies are merged are queued.

## Main health
- CI on main: green (14b69c0, PR #40). No stuck items. Open PR: #42 (#6 UI kit), in review.

## Queued (label `ready`)
- #43 p1-a: `assignShipments` greedy allocation (spec tests 4, 7, 10)
- #44 p1-b: markers + package positions in `snapshotAt`
- #45 p1-b: `DEMO_SCENARIO_OPTIONS` + test for 2 direct / 2 relay demo matches
- #46 victor-1: `GET /api/simulator`, `POST /api/simulator/control`, start ticker
- #47 victor-1: pure portal view builders `server/api/views.ts`
- #48 victor-2: marker tween model, MapMarkers layer, CityMap overlay slot
- #49 victor-2: sim/PackageDetail panel + model
- #50 p2-a: header Demo account selector + real default IDs
- #20 p2-b: CommuteEditor + commuteModel
- #8 p2-b: JobCard + jobCardModel
- #6 p2-a: UI kit + `client/src/ui/format.ts` (in review, PR #42)

## Next up (queue once dependencies merge)
- p1-a: direct-only vs relay compare helper (after #43). Only one p1-a issue at a time because all p1-a work edits matching.ts.
- victor-1: register dashboard/shipment/job GET routes (after #47, #46); `POST /api/shipments` with jobs, notifications, timeline, idempotency (spec test 9; after #43); retry unmatched in `PUT /commute` (after #43); `fixtures/demoScenario.json` + matched demo run on load (after #45, #43).
- victor-2: Simulator.tsx page assembly with 1 s polling (after #46, #48); CityMap render test.
- p2-a: ShipmentForm + Delivery arranged / no-match cards (after #6); BusinessPortal lists + tracking drawer (after #47 routes).
- p2-b: EmployeePortal page wiring (after #8, #20, dashboard route).
- Swap local format helpers (employee/, sim/simFormat.ts) for `client/src/ui/format.ts` once #6 merges.

## Done
- PR #41 (#5) p2-a: app shell, router, landing page, `.tsx` tests enabled
- PR #40 (#29) p1-b: `generateScenario(opts)` on the 12x12 grid
- PR #39 (#28) p1-b: pure `snapshotAt` (statuses, job status, earnings, metrics; spec tests 6, 12)
- PR #38 (#27) p1-a: candidate plans: direct + relay (spec tests 1, 2, 3, 5)
- PR #37 (#31) victor-1: clock ticker `server/api/ticker.ts`
- PR #36 (#33) victor-2: sim/MetricsCards + model
- PR #35 (#30) victor-1: trips on load + `PUT /api/employees/:id/commute`
- PR #34 (#32) victor-2: Timeline.tsx + model
- PR #26 (#15) p1-b: seeded PRNG + 12x12 grid
- PR #25 (#14) p1-b: `buildTimeline` (stable tie order)
- PR #24 (#17) victor-1: pure `advanceClock` / `applyControl`
- PR #23 (#19) victor-2: sim/PackageQueue · PR #21 (#18) victor-2: sim/PlaybackBar
- PR #22 (#16) victor-1: `createApp(store)` + GET businesses/employees/map
- PR #13 (#2) p1-b: pricing + metrics · PR #12 (#1) p1-a: routing
- PR #11 (#4) client API helpers · PR #10 (#3) store · PR #9 (#7) CityMap
- M0 scaffold by humans (feb9d6a)

## Known bugs
- `fixtures/demoScenario.json` is `{}`, so the server falls back to the relay fixture until the demo city lands (M2).
- No shipments can be matched end to end yet: `assignShipments` (#43) and `POST /api/shipments` are pending.
- Landing/header links use placeholder IDs `biz-a` / `emp-1` until #50.
