# STATUS (maintained by the planner)

_Last update: 2026-11-14, 13:16 (Sat), planner pass 48 (started 13:08)_

## Current milestone: M7 Foundation (MVP II, target 2:00 p.m. Sat)
The first layer is on main. The second layer (pure API steps, movement, travel service, UI data hooks) is written and waits in review: 16 PRs open (14 green, #414 still running CI, #399 red). This pass queued 6 issues (#413, #415–#419) that depend only on merged work and shorten the path to the route fetch and to a running `/api/v2`. MVP 1 runs untouched on main.

## Main health: green
- The last two finished CI runs on main passed (#353, #340). The run for #349 (PR #373) was still in progress at 13:08. No fix issue needed.

## Stuck
- Nothing is labeled `stuck`. PR #399 (#388, p2-b) is still red: it holds tests only (the `data/` ignore problem of pass 47). #388 is `ready` for its rerun into `v2/live/`; p2-b has not started it yet.
- Review is the bottleneck: 7 PRs merged in the last 20 minutes, 16 open.

## Merged since pass 47
- PR #370 (#340) p1-b: v2 timeline, `progressAt`, metrics. PR #390 (#376): emp-10's home moved, story package fixed.
- PR #383 (#343) victor-3: geocode handler + `env.ts` key loader.
- PR #389 (#372) p1-a: matcher under 2 s on the default NYC workload.
- PR #373 (#349) victor-2: simulator left-panel controls.
- PR #369 (#351) p2-a: Business shipments table. PR #371 (#353) p2-b: Employee workspace view.

## In review (PR open, green unless noted)
- p1-a: #374 plan checker (PR #394); #375 spec tests (#395).
- p1-b: #402 movement (#412).
- victor-1: #377 pipeline + initial run (#392); #378 commute-save logic (#398); #404 delivery-request logic (#410); #405 planning and scenario logic (#414, CI running).
- victor-3: #379 travel-cache report (#397); #403 runtime travel service (#411).
- victor-2: #350 **journey model + timeline, M8 centerpiece** (#391); #380 data layer (#396); #381 inspector (#400); #382 route tween + Play-journey driver (#401); #406 comparison section (#409).
- p2-b: #387 job detail (#393); #388 data layer (#399, **red**, rerun queued).

## Queued or started this pass
- p1-b: #413 snapshot assembly in `simulation.ts`, movement passed in (in progress).
- victor-1: #415 read routes + comparison (in progress); #416 simulator clock: control route + ticker.
- victor-3: #417 route-fetch orchestration (`fetchRoutes.ts`) with a no-call estimate.
- victor-2: #418 left-panel package list with filters; #407 page state (queued in pass 47).
- p2-b: #419 commute route preview on the NYC map; #388 rerun.
- p2-a: #384 New delivery form; #385 delivery details; #386 Business data layer; #408 fonts (all from pass 47, not started).
- p1-a has nothing `ready`: no matcher work is left that does not need the real travel matrix.

## Next up (each needs the issues in brackets merged first)
- victor-3: `scripts/fetch-routes.ts` + `npm run fetch:routes` with `--dry-run`, plan check and cache report [#417, #374, #379].
- p1-b: export `snapshotAt` (movement plugged in) + determinism test on the default scenario [#413, #402].
- victor-1: v2 bootstrap (travel service, store, initial run, ticker, all route groups) and the write routes [#377, #378, #403–#405, #413, #415, #416].
- victor-2: `/nyc/simulator` page [#350, #380–#382, #406, #407, #418]. p2-a: `/nyc/business/:id` [#384–#386]. p2-b: `/nyc/employee/:id` [#387, #388, #419].
- **HUMAN CHECKPOINT:** when the fetch script merges, Victor runs `npm run fetch:routes` and commits `fixtures/nyc/`. Until then `/api/v2` answers 503 by design. Confirm the business addresses first (QUESTIONS).
- Then: end-to-end test on cached NYC data, cutover, delete MVP 1 code, p1-a verifies the story on the real matrix.

## Known bugs / gaps
- M7's 2:00 p.m. target is at risk: the fetch script is two merges away (#417, then the script), and the bootstrap needs about ten open PRs merged.
- `.gitignore` `data/` ignores any `data` folder in the source tree. Humans: change it to `/data/` (QUESTIONS pass 47).
- IBM Plex is installed but not loaded; pages render in the system font until #408.
- Git tag `mvp1` still does not exist. Business addresses are unconfirmed before the paid fetch.
- No agent has keys: the Google map and the Google request shapes need one human look and the first real fetch.
- This planner run can't use `gh run list`, `gh pr list`, `gh label list`, `gh pr comment`, `gh pr edit` or `git fetch`; it reads PRs one by one with `gh pr view`. The local clone is behind main by the three PRs merged after 13:05.
- The p1-b Codex sandbox can't run the API tests (EPERM on listen), so its PRs rely on CI.
