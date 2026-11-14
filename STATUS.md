# STATUS (maintained by the planner)

_Last update: 2026-11-14, 13:56 (Sat), planner pass 50 (started 13:45)_

## Current milestone: M7 Foundation (MVP II, target 2:00 p.m. Sat)
The second layer is merging: 7 PRs merged since pass 49, 16 open (15 waiting for review, #395 stuck). All six workers are running again. The fetch script still waits on one PR (#422, fifth in the review queue), so the fetch checkpoint will come after 2:00 p.m. This pass queued 5 issues (#436–#440) on merged work only. MVP 1 runs untouched on main.

## Main health: green
- The last finished CI run on main passed (#381). The runs for #382 and #406 were in progress at 13:45. No fix issue needed.

## Stuck
- **PR #395 (#375, p1-a) is still labeled `stuck`.** It is green and complete for the narrowed #375 (reason and comparison tests). The edge file it was rejected for is now delivered separately in PR #427 (#424). **Humans: relabel PR #395 `needs-review` or merge it.** The planner's `gh pr edit` was denied again this pass. No replacement issue is queued, because it would create the same three test files a second time.

## Merged since pass 49
- PR #410 (#404) victor-1: delivery-request logic (`shipmentOps.ts`). PR #398 (#378): commute-save logic.
- PR #411 (#403) victor-3: runtime travel service.
- PR #400 (#381) victor-2: inspector. PR #401 (#382): route tween + Play-journey driver. PR #409 (#406): comparison section.
- PR #399 (#388) p2-b: Employee data layer (was red in pass 49, now fixed and merged).

## In review (15 PRs, oldest first; the reviewer takes them in this order)
- #412 p1-b movement (#402) · #414 victor-1 planning and scenario logic (#405) · #420 victor-1 read routes (#415) · #421 p1-b snapshot assembly (#413) · **#422 victor-3 route-fetch orchestration (#417)**
- #423 victor-1 simulator clock (#416) · #427 p1-a matcher edge tests (#424) · #428 p2-b commute route preview (#419) · #429 p2-a New delivery form (#384) · #430 victor-1 run boot (#425)
- #431 victor-2 simulator page state (#407) · #432 p2-a delivery details (#385) · #433 p2-a Business data layer (#386) · #434 victor-2 package list (#418) · #435 p2-a fonts (#408)
- CI: green on #412–#430; still running on #431 and #432 at 13:45; not read yet for #433–#435.

## Queued this pass (`ready`)
- victor-1: #436 commute save route (`commuteRoutes.ts`); #440 delivery-request routes (`shipmentRoutes.ts`).
- victor-3: #437 cache invalidation for moved places (`server/geo/cacheEdit.ts`).
- p2-b: #438 Employee workspace page (`pages/v2/EmployeeV2.tsx`) from the merged pieces.
- p2-a: #439 Business workspace header and notifications (`business/v2/activity/`).
- Still `ready` from pass 49: victor-2 #426 (first cut of the simulator page).

## Next up (each needs the PRs in brackets merged first)
- victor-3: `scripts/fetch-routes.ts` + `npm run fetch:routes` with `--dry-run`, `--refetch`, plan check and cache report [#422, then #437].
- p1-b: export `snapshotAt` (movement plugged in) + determinism test on the default scenario [#412, #421].
- victor-1: planning and scenario routes [#414]; v2 bootstrap (travel service, `bootV2Run`, ticker, all route groups) [#420, #423, #430, #436, #440, p1-b's `snapshotAt`].
- victor-2: plug inspector, tween + Play journey, comparison, URL state and package list into the page [#426, #431, #434].
- p2-a: Business page (`pages/v2/BusinessV2.tsx`) [#429, #432, #433, #439]; mount `/nyc/simulator`, `/nyc/business/:id`, `/nyc/employee/:id` [#426, #438].
- p2-b: plug the commute route preview into the Employee page [#428, #438].
- p1-a: verify the story on the real matrix [the fetch checkpoint].
- **HUMAN CHECKPOINT:** when the fetch script merges, Victor runs `npm run fetch:routes -- --dry-run`, then the real fetch, and commits `fixtures/nyc/`. Until then `/api/v2` answers 503 by design. Confirm the business addresses first (QUESTIONS).
- Then: end-to-end test on cached NYC data, cutover, delete MVP 1 code.

## Known bugs / gaps
- **M7's 2:00 p.m. target is missed by the fetch checkpoint.** Realistic time for the script on main: about 2:40 p.m. (PR #422 reviewed, then one issue and one review). Merging #422 by hand saves about 20 minutes.
- Review is the bottleneck: 15 PRs wait and about 6 merge per 15 minutes, so a PR opened now merges in about 40 minutes.
- p1-a and p1-b have nothing `ready`: the matcher is done until the real matrix exists, and `snapshotAt` needs PRs #412 and #421.
- The v2 pages are not mounted yet; nobody can open `/nyc/...` in a browser until the mount issue (after #426 and #438).
- `.gitignore` `data/` ignores any `data` folder in the source tree. Humans: change it to `/data/` (QUESTIONS pass 47).
- `scripts/worker.sh` sends a PR back for review when the agent changed nothing, if the merge of main made a commit (QUESTIONS pass 49).
- Git tag `mvp1` still does not exist. Business addresses are unconfirmed before the paid fetch.
- No agent has keys: the Google map and the Google request shapes need one human look and the first real fetch.
- This planner run can't use `gh run list`, `gh pr list`, `gh pr comment`, `gh pr edit` or `git fetch`; it reads PRs one by one with `gh pr view`.
- The p1-b Codex sandbox can't run the API tests (EPERM on listen), so its PRs rely on CI.
