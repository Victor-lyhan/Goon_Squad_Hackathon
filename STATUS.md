# STATUS (maintained by the planner)

_Last update: 2026-11-14, about 12:36 (Sat), planner pass 46 (started 12:24)_

## Current milestone: M7 Foundation (MVP II, target 2:00 p.m. Sat)
The first layer is written: every issue from pass 45 has a PR, and the matcher and the travel providers are merged. This pass queued 15 issues (#372–#388) that depend only on merged work. The second layer (`snapshotAt`, fetch script, `/api/v2` routes, the three v2 pages) still waits for PRs in review. MVP 1 runs untouched on main.

## Main health: no failure known
- Every merged PR was green on its branch. The three newest runs on main (#344, #327, the humans' commit) were still in progress at 12:24, and this planner run cannot list CI runs. No fix issue queued.

## Stuck
- Nothing is labeled `stuck`. p2-a and p2-b are working again (all 8 of their issues are in review or merged).
- Review is the bottleneck: 15 issues are in review, 6 PRs merged in the last 15 minutes.

## Merged since pass 45
- PR #356 (#338) p1-a: v2 matcher on `TravelProvider` + `buildTrips`, relay through any business, §9 fixture. **Critical path, done.**
- PR #359 (#341) victor-3: cache file IO, `CachedProvider`, `FakeProvider`, `GoogleProvider`.
- PR #357 (#317) p2-b: commute form no longer resets on the 1 s poll (MVP 1 fallback fix).
- PR #355 (#344) victor-1: typed `/api/v2` client. PR #354 (#347) victor-2: journey map props.
- PR #337 (#328) p1-b: polyline geometry. PR #335 (#327) p1-b: NYC data set (merged by the humans).

## In review (PR open, CI green unless noted)
- p1-b: #339 NYC generator (PR #360); #340 timeline, progress, metrics.
- victor-1: #345 v2 read views (PR #361); #346 `/api/v2` mount + 503 + generic store.
- victor-3: #342 route-fetch pipeline; #343 geocode handler + key loader.
- victor-2: #348 network view model; #349 left-panel controls.
- p2-a: #324 tokens (PR #358); #325 header + `/help` (PR #362); #326 homepage (PR #364); #351 shipments table.
- p2-b: #331 address search (PR #363); #352 commute form; #353 Employee workspace view.

## In progress
- p1-a #372 matcher 2 s budget. p1-b #376 data fixes before the fetch. victor-1 #377 v2 pipeline + initial run.
- victor-2 #350 **package journey model + timeline (M8 centerpiece)**. victor-3 #379 travel-cache report.

## Queued (label `ready`)
- p1-a: #374 independent plan checker + demo-story report; #375 remaining matcher spec tests (tests only).
- victor-1: #378 commute-save logic (home resolution, pairs to fetch, apply to run).
- victor-2: #380 simulator data layer; #381 inspector for business and employee; #382 along-route tween + Play-journey step driver.
- p2-a: #384 New delivery form; #385 delivery details + match result; #386 Business data layer.
- p2-b: #387 job detail; #388 Employee data layer.
- p1-b and victor-3 have nothing `ready`: their next tasks need PRs that are still in review.

## Next up (each needs the issues in brackets merged first)
- p1-b: `snapshotAt(run, timeMin, travel)` [#340]; real-data generator test [#339].
- victor-3: `scripts/fetch-routes.ts` + `npm run fetch:routes`, printing the plan check and cache report [#339, #342, #343, #374, #379].
- victor-1: v2 store bootstrap and route groups incl. geocode mount and commute save with live Google [#339, #340, #343, #345, #346, #377, #378].
- victor-2: the `/nyc/simulator` page [#348–#350, #380–#382]. p2-a: Business page at `/nyc/business/:id` [#351, #384–#386] + font imports [#324]. p2-b: Employee page at `/nyc/employee/:id` [#331, #352, #353, #387, #388].
- **HUMAN CHECKPOINT:** when the fetch script merges, Victor runs `npm run fetch:routes` and commits `fixtures/nyc/`. Until then `/api/v2` answers 503 by design. Confirm the four business addresses first (QUESTIONS).
- Then: end-to-end test on cached NYC data, cutover (routes swap to the v2 pages), delete MVP 1 code.

## Done earlier
- MVP 1 complete (M0–M6). M7 so far: contracts (#332), Google client (#334), map (#333), simulator frame (#336).

## Known bugs / gaps
- Server playback is too fast for journey mode (slowest speed = 30 simulated minutes per second). #382 steps with `seek` instead (DECISIONS pass 46; QUESTIONS).
- Git tag `mvp1` still does not exist. #317 is merged, so now is the moment to tag.
- `fixtures/nyc/demoStory.json`: emp-10's home is on a named building until #376 merges. Four business addresses are unconfirmed.
- No agent has keys: the Google map (basemap, journey colors, markers) needs one human look, and the Google request shapes are tested only against a fake `fetch` until the human fetch.
- This planner run can't use `gh run list`, `gh pr list` or `git pull`; state comes from the prompt snapshot, `gh pr view` and `gh issue list`.
- The p1-b Codex sandbox can't run the API tests (EPERM on listen), so its PRs rely on CI.
