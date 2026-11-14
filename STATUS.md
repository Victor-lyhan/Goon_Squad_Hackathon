# STATUS (maintained by the planner)

_Last update: 2026-11-14, 13:36 (Sat), planner pass 49 (started 13:26)_

## Current milestone: M7 Foundation (MVP II, target 2:00 p.m. Sat)
The first layer is on main and the second layer is merging: 6 PRs merged since pass 48, 14 open (12 green, #399 red, #395 stuck). The fetch script now waits on one PR (#422). This pass queued 3 issues (#424–#426) on merged work only. MVP 1 runs untouched on main.

## Main health: green
- The last finished CI run on main passed (#387). The runs for #374 and #380 were in progress at 13:26. No fix issue needed.

## Stuck
- **PR #395 (#375, p1-a) is labeled `stuck`**: rejected 3 times because `matching-v2-edge.test.ts` never arrived. The two "fix" runs took 30 s and 8 s and pushed only a merge of main, so the p1-a Codex agent is failing at once. Split: #375 now covers the reason and comparison tests (PR #395 delivers them, green); the edge file is #424. **Humans: relabel PR #395 `needs-review` or merge it** (the planner cannot edit PR labels).
- **p2-a and p2-b have not picked up an issue for 45–60 minutes** (p2-a: #384–#386, #408 since 12:32; p2-b: #388 since 12:52, #419). The Business and Employee pages wait on them.
- PR #399 (#388, p2-b) is still red: tests only (the `data/` ignore problem of pass 47). It needs p2-b's rerun.

## Merged since pass 48
- PR #392 (#377) victor-1: v2 pipeline + initial run. PR #394 (#374) p1-a: plan checker.
- PR #397 (#379) victor-3: travel-cache report.
- PR #391 (#350) victor-2: **journey model + timeline (M8 centerpiece)**. PR #396 (#380): simulator data layer.
- PR #393 (#387) p2-b: delivery job detail.

## In review (PR open, green unless noted)
- p1-b: #402 movement (#412); #413 snapshot assembly (#421).
- victor-1: #378 commute-save logic (#398); #404 delivery-request logic (#410); #405 planning and scenario logic (#414); #415 read routes + comparison (#420); #416 simulator clock (#423).
- victor-3: #403 runtime travel service (#411); #417 route-fetch orchestration (#422).
- victor-2: #381 inspector (#400); #382 route tween + Play-journey driver (#401); #406 comparison section (#409).
- p2-b: #388 data layer (#399, **red**). p1-a: #375 (#395, **stuck**, see above).

## Queued this pass (not started)
- p1-a: #424 v2 matcher edge tests (the file missing from #375).
- victor-1: #425 v2 run boot (`bootRun.ts`): default scenario → initial run → v2 store, 503 when the cache is missing.
- victor-2: #426 first cut of the simulator page from the merged pieces. Also `ready`: #407 page state, #418 package list.
- Still `ready` from earlier passes: p2-a #384, #385, #386, #408; p2-b #388 (rerun), #419.

## Next up (each needs the issues in brackets merged first)
- victor-3: `scripts/fetch-routes.ts` + `npm run fetch:routes` with `--dry-run`, plan check and cache report [#417].
- p1-b: export `snapshotAt` (movement plugged in) + determinism test on the default scenario [#413, #402].
- victor-1: v2 bootstrap (travel service, `bootV2Run`, ticker, read and control routes) [#403, #415, #416, #425, p1-b's `snapshotAt`]; write routes [#378, #404, #405].
- victor-2: plug inspector, tween + Play journey, comparison, URL state and package panel into the page [#426, #381, #382, #406, #407, #418].
- p2-a: mount `/nyc/simulator`, `/nyc/business/:id`, `/nyc/employee/:id`; Business page [#384–#386]. p2-b: Employee page [#388, #419].
- **HUMAN CHECKPOINT:** when the fetch script merges, Victor runs `npm run fetch:routes -- --dry-run`, then the real fetch, and commits `fixtures/nyc/`. Until then `/api/v2` answers 503 by design. Confirm the business addresses first (QUESTIONS).
- Then: end-to-end test on cached NYC data, cutover, delete MVP 1 code, p1-a verifies the story on the real matrix.

## Known bugs / gaps
- **M7's 2:00 p.m. target will be missed by the fetch checkpoint**: the script is not queued yet (it needs PR #422 merged, then about 20 minutes to build and review).
- Three of six workers look down (p1-a failing fast, p2-a and p2-b idle). The simulator and the API are on track; the Business and Employee pages are not.
- `scripts/worker.sh` sends a PR back for review when the agent changed nothing, if the merge of main made a commit. That burned PR #395's three review rounds in 3 minutes (QUESTIONS).
- `.gitignore` `data/` ignores any `data` folder in the source tree. Humans: change it to `/data/` (QUESTIONS pass 47).
- IBM Plex is installed but not loaded; pages render in the system font until #408.
- Git tag `mvp1` still does not exist. Business addresses are unconfirmed before the paid fetch.
- No agent has keys: the Google map and the Google request shapes need one human look and the first real fetch.
- This planner run can't use `gh run list`, `gh pr list`, `gh pr comment`, `gh pr edit` or `git fetch`; it reads PRs one by one with `gh pr view`.
- The p1-b Codex sandbox can't run the API tests (EPERM on listen), so its PRs rely on CI.
