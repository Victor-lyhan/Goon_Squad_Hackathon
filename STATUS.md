# STATUS (maintained by the planner)

_Last update: 2026-11-14, 14:08 (Sat), planner pass 51 (started 13:57)_

## Current milestone: M7 Foundation (MVP II, target 2:00 p.m. Sat, missed by the fetch checkpoint)
The second reviewer is working: 8 PRs merged since pass 50, and nothing is `stuck`. The fetch orchestration (#422), movement (#412) and the snapshot (#421) are on main, so the fetch command is queued as #446 (top priority). 13 PRs are open, all waiting for review. This pass queued 6 issues (#446–#451). MVP 1 runs untouched on main.

## Main health: last finished run RED (commit 7460500, 13:52), probably a timing flake
- That commit changed only markdown. The PR checks of #441 and #442 ran the full suite on top of the same main afterwards and passed, so it is not a hard break.
- The planner can't read CI logs. Fix issue **#447** (victor-3): read the log, fix it if it is in `tests/geo`, otherwise report the owner; give the heavy `tests/geo` tests explicit timeouts in any case.
- The runs for #421 and #412 were still in progress at 13:57.

## Stuck
- Nothing. PR #395 (#375, p1-a) merged at 13:46.

## Merged since pass 50
- PR #422 (#417) victor-3: route-fetch orchestration (`fetchRoutes.ts`, `estimateFetch`).
- PR #412 (#402) and PR #421 (#413) p1-b: movement and snapshot assembly.
- PR #414 (#405) victor-1: planning and scenario logic. PR #420 (#415): read routes. PR #423 (#416): simulator clock, control route, ticker.
- PR #395 (#375) p1-a: v2 reason and comparison tests. PR #428 (#419) p2-b: commute route preview.

## In review (13 PRs, all `needs-review`; CI green on every one read this pass)
- victor-1: #430 run boot (#425) · #444 commute save route (#436)
- victor-2: #431 page state (#407) · #434 package list (#418) · #441 first cut of the simulator page (#426)
- victor-3: #442 cache invalidation (#437)
- p1-a: #427 matcher edge tests (#424)
- p2-a: #429 New delivery form (#384) · #432 delivery details (#385) · #433 Business data layer (#386) · #435 fonts (#408) · #443 header and activity (#439)
- p2-b: #445 Employee page (#438)
- CI on #443–#445 was not read (opened during this pass).

## Queued this pass (`ready`)
- victor-3: **#446 fetch command** (`scripts/fetch-routes.ts`, `npm run fetch:routes`, `--dry-run`, reports, exit codes); **#447 red main** + `tests/geo` timeouts; #448 Google access check (`server/geo/keyCheck.ts`).
- p1-b: #449 export the real `snapshotAt` + a whole simulated day of the default NYC scenario as a test.
- victor-2: #450 map legend (`sim/v2/legend/`).
- victor-1: #451 planning and scenario routes (`planningRoutes.ts`). Still `ready` from pass 50: #440 delivery-request routes.

## Next up (each needs the PRs or issues in brackets merged first)
- **HUMAN CHECKPOINT:** when #446 merges, Victor runs `npm run fetch:routes -- --dry-run`, then the real fetch, and commits `fixtures/nyc/`. Confirm the business addresses first (QUESTIONS pass 46). Until then `/api/v2` answers 503 by design.
- victor-3: `--refetch <placeId>`, moved homes in `--dry-run` and `--check-key` in the fetch command [#446, #442, #448].
- victor-1: v2 bootstrap: travel service, `bootV2Run`, ticker and all five route groups in `createV2Router` [#430, #444, #440, #451, #449].
- victor-2: plug inspector, tween + Play journey, comparison, URL state, package list and legend into the page [#441, #431, #434, #450].
- p2-a: Business page `pages/v2/BusinessV2.tsx` [#429, #432, #433, #443]; mount `/nyc/simulator`, `/nyc/business/:id`, `/nyc/employee/:id` [#441, #445].
- p2-b: plug the commute route preview into the Employee page [#445].
- p1-a: verify the story on the real matrix [the fetch checkpoint].
- Then (M8): end-to-end test on cached NYC data, cutover, delete MVP 1 code.

## Known bugs / gaps
- **M7's 2:00 p.m. target is missed.** The fetch command needs one issue (#446) and one review; with two reviewers, about 2:35 p.m.
- p1-a, p2-a and p2-b have nothing `ready`: everything left for them needs open PRs or the real matrix.
- The v2 pages are not mounted; nobody can open `/nyc/...` in a browser until #441 and #445 merge and the mount issue runs.
- No agent has keys: the Google map and the Google request shapes need one human look and the first real fetch. #448 will tell a misconfigured key from a code bug.
- Git tag `mvp1` still does not exist. Business addresses are unconfirmed before the paid fetch.
- `scripts/worker.sh` sends a PR back for review when the agent changed nothing, if the merge of main made a commit (QUESTIONS pass 49).
- This planner run can't use `gh run list`, `gh pr list`, `gh pr checks`, `gh api`, `git fetch` or the test script; it reads PRs one by one with `gh pr view`. (`gh run view <id>` works, but it needs a run ID.)
- The p1-b Codex sandbox can't run the API tests (EPERM on listen), so its PRs rely on CI.
