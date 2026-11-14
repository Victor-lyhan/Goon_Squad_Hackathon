# STATUS (maintained by the planner)

_Last update: 2026-11-14, about 12:15 (Sat), planner pass 45 (started 12:01)_

## Current milestone: M7 Foundation (MVP II, target 2:00 p.m. Sat)
The contracts, the Google client and the map component are merged, so this pass queued everything that depends only on them: 16 issues (#338–#353), one layer deep. Nothing queued depends on unmerged work. MVP 1 still runs untouched on main; MVP II is built side by side (DECISIONS pass 44).

## Main health: GREEN
- CI passed on #322 (PR #332) and #329 (PR #333). The run for #323 (PR #334) was still in progress at 12:01.

## Stuck
- No issue or PR is labeled `stuck`.
- **p2-a and p2-b have still not picked up anything** (#324–#326 and #317, #331 have been `ready` since 11:40; last activity about 6:30 a.m.). Five other workers took new issues within 10 minutes. See QUESTIONS pass 45.

## Merged since pass 44
- PR #332 (#322) victor-1: `shared/v2` contracts (data model, `TravelProvider`, API types, schemas, fixture formats).
- PR #334 (#323) victor-3: Google HTTP client (geocode, route matrix in ≤ 625-element batches, polylines).
- PR #333 (#329) victor-2: Google basemap + deck.gl map component, all seven MVP II client dependencies.
- #330 victor-2 is closed (PR #336, simulator workspace frame; it was green and in review at 12:01).

## In review
- PR #335 (#327) p1-b: NYC data set (18 businesses, 8 neighborhoods, 9 featured employees, 24 packages). CI green.
- #328 p1-b: polyline geometry (`server/domain/v2/polyline.ts`).

## In progress (picked up within 10 minutes)
- #338 p1-a **[critical path]**: matcher on `TravelProvider` + `buildTrips` (relay = any other business), §9 fixture on a fake provider.
- #341 victor-3: cache file IO, `CachedProvider`, `FakeProvider`, `GoogleProvider`.
- #344 victor-1: typed `/api/v2` client in `client/src/api/v2.ts`.
- #347 victor-2: map extension for journeys (two leg tones, numbered stops, pan-to-point).

## Queued (label `ready`)
- p1-b: #339 NYC generator (120-home pool, demo scenario, Random preset); #340 v2 timeline, progress-at-time and metrics.
- victor-3: #342 route-fetch pipeline (plan + runner, no fs); #343 `GET /api/v2/geocode` handler + server key loader.
- victor-1: #345 v2 read views incl. `MapResponse` polylines; #346 `/api/v2` mount with a 503 until NYC data is loaded, generic store.
- victor-2: #350 **package journey model + timeline + Play-journey plan (M8 centerpiece)**; #348 network view model (selection, focus, hover); #349 left-panel controls.
- p2-a: #324 tokens + UI kit; #325 header + `/help`; #326 homepage; #351 Business shipments table.
- p2-b: #317 [P0 for the MVP 1 fallback] commute form resets on poll; #331 address search; #352 v2 commute form; #353 Employee workspace view.

## Next up (each needs the issues in brackets merged first)
- p1-b: `snapshotAt(run, timeMin, travel)` in `server/domain/v2/simulation.ts` [#328, #340]; real-data generator test [#335, #339].
- victor-3: `scripts/fetch-routes.ts` + `npm run fetch:routes` [#335, #338, #339, #341, #342, #343].
- victor-1: v2 initial run, pipeline, state file and the route groups, incl. mounting geocode [#338–#341, #343, #345, #346].
- victor-2: the `/nyc/simulator` page: frame + map + network view + journey mode + controls on `client/src/api/v2` [#344, #347–#350]; then the inspector for business, employee and package.
- p2-a: New delivery form, delivery details + match result, Business workspace page; font imports [#324]. p2-b: wire the employee workspace [#331, #344, #352, #353].
- **HUMAN CHECKPOINT:** when the fetch script merges, Victor runs `npm run fetch:routes` and commits `fixtures/nyc/`. Nothing NYC runs before that; `/api/v2` answers 503 until then (#346).
- Then: cutover (routes swap to the v2 pages, indicator text becomes "Real NYC locations · simulated deliveries"), delete MVP 1 code.

## Done earlier
- MVP 1 complete (M0–M6): must-haves 1–10, nice-to-haves 11–15, scrubber, Duplicate request, CI timing sweeps. PR #321 and earlier; see git log.

## Known bugs / gaps
- Git tag `mvp1` (the fallback named in SPEC) does not exist in this clone.
- Commute editor resets every second in a browser (#317), on the MVP 1 pages.
- No agent can see the Google map (no keys). PR #333's map and #347's journey colors need one human look.
- The Google request shapes in PR #334 are tested only against a fake `fetch`; the first real call is the human fetch.
- #327's business addresses and featured home points come from the worker's own knowledge; a human should check them before geocoding (list in PR #335).
- #347 and #348 carry a wrong issue number in their Context line (corrected in a comment; no effect on the work).
- This planner run can't use `gh run list` or `gh pr list`; CI and PR state come from the prompt snapshot and `gh pr view`.
- The p1-b Codex sandbox can't run the API tests (EPERM on listen), so its PRs rely on CI.
