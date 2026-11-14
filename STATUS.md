# STATUS (maintained by the planner)

_Last update: 2026-11-14 02:41 (Sat), planner pass 3_

## Current milestone: M1 (Engine + building blocks), target 6:00 a.m. Sat
M1 is mostly done. What's left: matching.ts (#27), p2-a shell/UI kit (#5, #6) and p2-b components (#20, #8). Some M2/M3 backend pieces whose dependencies are merged were queued early.

## Main health
- CI on main: green (b21fbb7, PR #26). No stuck items, no open PRs.

## Queued (label `ready`)
- #27 p1-a: matching.ts candidate plans (evening/morning direct, one-hub relay; spec tests 1, 2, 3, 5)
- #28 p1-b: pure `snapshotAt(run, t)` for statuses/job status/earnings/metrics (spec tests 6, 12; markers later)
- #29 p1-b: `generateScenario(opts)` on the 12x12 grid (feeds the M2 demo city)
- #30 victor-1: trips on load + `PUT /api/employees/:id/commute`
- #31 victor-1: shared clock ticker `server/api/ticker.ts` (not wired yet)
- #32 victor-2: Timeline.tsx event log + timelineModel
- #33 victor-2: sim/MetricsCards + metricsModel
- #5 p2-a: app shell, router, landing page, enable `.tsx` tests
- #6 p2-a: UI kit + `client/src/ui/format.ts`
- #20 p2-b: CommuteEditor + commuteModel
- #8 p2-b: JobCard + jobCardModel

## Next up (queue once dependencies merge)
- p1-a: greedy allocation `assignShipments` (spec tests 4, 10; preserve existing reservations; allowRelay flag), after #27. p1-a has only 1 issue because every remaining p1-a task edits matching.ts.
- p1-b: marker + package position interpolation in snapshotAt (after #28).
- victor-1: GET /api/simulator + POST /api/simulator/control + wire ticker (after #28, #31). `fixtures/demoScenario.json` (after #29 + matching). POST /api/shipments (after matching allocation). Retry unmatched in PUT /commute (after matching).
- victor-2: CityMap render test (after #5). Simulator.tsx page assembly (after #5).
- p2-a: Demo account selector (after #5). ShipmentForm (after #6).
- p2-b: EmployeePortal page wiring (after #5, #8, #20).
- Swap local format helpers (employee/, sim/simFormat.ts) for `client/src/ui/format.ts` once #6 merges.

## Done
- PR #26 (#15) p1-b: seeded PRNG + labelled 12x12 `gridGraph`
- PR #25 (#14) p1-b: `buildTimeline` (stable tie order)
- PR #24 (#17) victor-1: pure `advanceClock` / `applyControl`
- PR #23 (#19) victor-2: sim/PackageQueue + model
- PR #22 (#16) victor-1: `createApp(store)` + GET businesses/employees/map
- PR #21 (#18) victor-2: sim/PlaybackBar + model
- PR #13 (#2) p1-b: pricing.ts + metrics.ts
- PR #12 (#1) p1-a: routing.ts (Dijkstra, waypoints, insertion, buildTrips)
- PR #11 (#4) victor-1: typed fetch helpers in client/src/api/
- PR #10 (#3) victor-1: store.ts serialized mutations + atomic JSON
- PR #9 (#7) victor-2: CityMap.tsx SVG renderer + geometry helpers
- M0 scaffold by humans (feb9d6a)

## Known bugs
- `fixtures/demoScenario.json` is `{}`, so the server falls back to the relay fixture until the demo city is built (M2).
- `run.trips` is empty on load until #30 merges.
