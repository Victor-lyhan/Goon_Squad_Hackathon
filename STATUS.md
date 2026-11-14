# STATUS (maintained by the planner)

_Last update: 2026-11-14 01:58 (Sat), planner pass 1_

## Current milestone: M1 (Engine + building blocks), target 6:00 a.m. Sat

## Main health
- CI on main: green (M0 scaffold, feb9d6a). `/api/health` only; all modules are stubs.

## In progress (queued this pass, label `ready`)
- #1 p1-a: routing.ts (Dijkstra, baseline via waypoints, insertion, buildTrips)
- #2 p1-b: pricing.ts + metrics.ts
- #3 victor-1: store.ts (serialized mutations, atomic JSON)
- #4 victor-1: client/src/api/ typed fetch helpers
- #5 p2-a: app shell, router, landing page, enable `.tsx` component tests
- #6 p2-a: UI kit + `client/src/ui/format.ts`
- #7 victor-2: CityMap.tsx + mapGeometry helpers
- #8 p2-b: JobCard + jobCardModel

## Next up (queue once dependencies merge)
- p1-a: matching.ts (evening/morning direct, one-hub relay, greedy allocation; spec tests 1-5, 10). Needs #1 (+ #2 for pricing).
- p1-b: simulation.ts timeline builder from DeliveryPlans (stable tie order).
- victor-1: GET /api/businesses, /api/employees, /api/map routes in server/api/ + index.ts wiring. Needs #3.
- p2-b: CommuteEditor component.
- victor-2: CityMap render test (needs #5), then sim/ playback bar pieces.
- p2-a: Demo account selector in header (needs #4, #5); UI kit render tests (needs #5).

## Done
- M0 scaffold by humans (feb9d6a): contracts in shared/, build/test/CI green.

## Known bugs
- None yet.
