# STATUS (maintained by the planner)

_Last update: 2026-11-14 02:20 (Sat), planner pass 2_

## Current milestone: M1 (Engine + building blocks), target 6:00 a.m. Sat

## Main health
- CI on main: green (1a4f1ae "Fix codex flag in worker script"). No stuck items, no open PRs.

## In progress
- #1 p1-a: routing.ts (Dijkstra, baseline via waypoints, insertion, buildTrips), in progress
- #2 p1-b: pricing.ts + metrics.ts, in progress

## Queued (label `ready`)
- #14 p1-b: simulation.ts `buildTimeline` (sorted SimEvents, stable tie order)
- #15 p1-b: generator.ts seeded PRNG + labelled 12x12 `gridGraph` (feeds the M2 demo city)
- #16 victor-1: `createApp(store)` + initial run + GET /api/businesses, /api/employees, /api/map
- #17 victor-1: pure `advanceClock` / `applyControl` in server/clock.ts
- #18 victor-2: sim/PlaybackBar + playbackModel
- #19 victor-2: sim/PackageQueue + packageQueueModel
- #20 p2-b: CommuteEditor + commuteModel
- #8 p2-b: JobCard + jobCardModel
- #5 p2-a: app shell, router, landing page, enable `.tsx` component tests
- #6 p2-a: UI kit + `client/src/ui/format.ts`

## Next up (queue once dependencies merge)
- p1-a: matching.ts (evening/morning direct, one-hub relay, greedy allocation; spec tests 1-5, 10). Blocked on #1 (+ #2 for pricing). p1-a has nothing else to queue until then.
- p1-b: `snapshotAt(run, t)` + marker interpolation (after #14); generator scenario builder (after #15).
- victor-1: compute trips on load + PUT /commute (after #1, #16); `fixtures/demoScenario.json` from `gridGraph` (after #15); simulator timer + GET /api/simulator + POST /control (after #14, #16, #17).
- victor-2: CityMap render test (after #5); Simulator.tsx page assembly (after #5, #18, #19).
- p2-a: Demo account selector in header (after #5); ShipmentForm (after #6).
- p2-b: EmployeePortal page wiring (after #5, #8, #20).
- Swap local format helpers (employee/, sim/simFormat.ts) for `client/src/ui/format.ts` once #6 merges.

## Done (M1)
- PR #11 (#4) victor-1: typed fetch helpers in client/src/api/ for every endpoint
- PR #10 (#3) victor-1: store.ts serialized mutations + atomic JSON
- PR #9 (#7) victor-2: CityMap.tsx SVG renderer + mapGeometry helpers
- M0 scaffold by humans (feb9d6a): contracts in shared/, build/test/CI green.

## Known bugs
- `fixtures/demoScenario.json` is `{}`; #16 falls back to the relay fixture until the demo city is built (M2).
