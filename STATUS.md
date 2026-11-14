# STATUS (maintained by the planner)

_Last update: 2026-11-14, 12:58 (Sat), planner pass 47 (started 12:46)_

## Current milestone: M7 Foundation (MVP II, target 2:00 p.m. Sat)
The first layer is merging (router, fetch pipeline, generator, views, matcher, providers are on main). The second layer (`snapshotAt`, fetch script, `/api/v2` routes, the three v2 pages) still waits for PRs in review. This pass found and fixed one planner mistake (below) and queued 7 issues (#402–#408) that depend only on merged work. MVP 1 runs untouched on main.

## Main health: no failure known
- This run cannot list CI runs on main. Evidence it is green: PR #396 was re-pushed at about 12:56 and its CI passed on top of main including #365–#368.

## Fixed this pass: source files silently missing from two PRs
- Root `.gitignore` has `data/`, which ignores every folder named `data` at any depth. Pass 46 told three workers to build in `v2/data/`. PRs #396 (#380) and #399 (#388) were pushed with tests only and failed CI.
- The folder is now `v2/live/` (DECISIONS pass 47). #380 was rerun: PR #396 now has its three source files and is green. #388 is `ready` for the same rerun (PR #399 is still red until then). #386 was corrected before p2-a started it.

## Stuck
- Nothing is labeled `stuck`. Review is still the bottleneck: 17 PRs open, 9 merged in the last 25 minutes.

## Merged since pass 46
- PR #367 (#346) victor-1: `/api/v2` mounted with the 503, router skeleton, generic store. PR #361 (#345): v2 read views.
- PR #368 (#342) victor-3: route-fetch pipeline (`fetchPlan`, `fetchRunner`).
- PR #360 (#339) p1-b: NYC scenario generator, 120-home pool.
- PR #366 (#348) victor-2: simulator network view model. PR #365 (#352) p2-b: v2 commute form. PR #363 (#331): address search.
- PR #362 (#325) + #364 (#326) p2-a: header, `/help`, homepage.

## In review (PR open)
- p1-a: #372 matcher 2 s budget (PR #389); #374 plan checker (#394); #375 spec tests (#395).
- p1-b: #340 timeline, progress, metrics (#370); #376 data fixes before the fetch (#390).
- victor-1: #377 pipeline + initial run (#392); #378 commute-save logic (#398).
- victor-3: #343 geocode handler + key loader (#383); #379 travel-cache report (#397).
- victor-2: #349 controls (#373); #350 **journey model + timeline, M8 centerpiece** (#391); #380 data layer (#396, fixed); #381 inspector (#400); #382 route tween + Play-journey driver.
- p2-a: #351 shipments table (#369). p2-b: #353 workspace view (#371); #387 job detail (#393).

## Queued (label `ready`)
- p1-b: #402 vehicle and package movement along route lines (the movement half of `snapshotAt`).
- victor-3: #403 runtime travel service (cache at start, live fetch for a new home and new route lines).
- victor-1: #404 delivery-request logic (`shipmentOps.ts`); #405 planning and scenario logic (`planningOps.ts`).
- victor-2: #406 direct-only vs relay comparison section; #407 simulator page state (URL selection, keys, desktop-only notice).
- p2-a: #384 New delivery form; #385 delivery details; #386 Business data layer (`v2/live/`); #408 load IBM Plex fonts.
- p2-b: #388 Employee data layer (rerun into `v2/live/`).
- p1-a has nothing `ready`: its matcher work is in three PRs, and the next tasks need the real travel matrix.

## Next up (each needs the issues in brackets merged first)
- p1-b: `snapshotAt(run, timeMin, travel)` in `simulation.ts` [#340, #402].
- victor-3: `scripts/fetch-routes.ts` + `npm run fetch:routes`, printing the plan check and cache report [#343, #374, #379].
- victor-1: v2 bootstrap and route groups [#340, #343, #377, #378, #402–#405].
- victor-2: `/nyc/simulator` page [#349, #350, #380–#382, #406, #407]. p2-a: `/nyc/business/:id` page [#351, #384–#386]. p2-b: `/nyc/employee/:id` page [#353, #387, #388].
- **HUMAN CHECKPOINT:** when the fetch script merges, Victor runs `npm run fetch:routes` and commits `fixtures/nyc/`. Until then `/api/v2` answers 503 by design. Confirm the four business addresses first (QUESTIONS).
- Then: end-to-end test on cached NYC data, cutover, delete MVP 1 code, p1-a verifies the story on the real matrix.

## Known bugs / gaps
- `.gitignore` `data/` ignores any `data` folder in the source tree (see above). Humans: change it to `/data/` (QUESTIONS).
- IBM Plex is installed but not loaded; pages render in the system font until #408.
- Server playback is too fast for journey mode; #382 steps with `seek` (DECISIONS pass 46).
- Git tag `mvp1` still does not exist. Four business addresses are unconfirmed; emp-10's home moves in #376.
- No agent has keys: the Google map and the Google request shapes need one human look and the first real fetch.
- This planner run can't use `gh run list`, `gh pr list`, `gh pr comment`, `gh pr edit` or `git fetch`; it reads PRs one by one with `gh pr view` and acts through issues.
- The p1-b Codex sandbox can't run the API tests (EPERM on listen), so its PRs rely on CI.
