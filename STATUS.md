# STATUS (maintained by the planner)

_Last update: 2026-11-14, 14:25 (Sat), planner pass 52 (started 14:18)_

## Current milestone: M7 Foundation (MVP II, target 2:00 p.m. Sat, missed) → **the fetch checkpoint is open now**
The fetch command is on main (PR #455), so the last M7 item is the humans' paid fetch. All 13 PRs that were open in pass 51 are merged, plus #453 and #455 during this pass. Nothing is `stuck`. This pass queued 9 issues (#458–#466): the server bootstrap, the three v2 pages' last assembly steps and the preview routes. MVP 1 runs untouched on main.

## HUMAN CHECKPOINT (Victor, now)
1. Confirm the four business addresses (QUESTIONS pass 46).
2. `npm run fetch:routes -- --dry-run` (free, no key) to see the cost, then `npm run fetch:routes`. Exit code 0 = cache complete and the story matched as written; 1 = read the flagged rows or run again.
3. Commit `fixtures/nyc/matrix.json` and `polylines.json`. `/api/v2` serves them once #464 is merged and the server restarts.

## Main health: one red run (commit 7460500, 13:52), cause found, fix queued
- #447 (victor-3) read the CI log: the only failure was a wall-clock limit in `tests/ui/sim-v2-motion-route.test.ts:212` (236.8 ms against 225 ms; victor-2's file). No later run on main is red.
- Fix: **#458** (victor-2, top priority). PR #457 (#447) adds explicit timeouts to the `tests/geo` fetch tests.
- The three newest runs on main were still in progress at 14:18; not read (the planner can't list runs).

## Stuck
- Nothing.

## Merged since pass 51
- victor-3: PR #455 (#446) **fetch command**; PR #442 (#437) cache invalidation.
- p1-b: PR #453 (#449) the public `snapshotAt` + a whole simulated day as a test.
- victor-1: PR #430 (#425) run boot; PR #444 (#436) commute save route; PR #452 (#440) delivery-request routes; PR #456 (#451) planning and scenario routes.
- victor-2: PR #431 (#407) page state; PR #434 (#418) package list; PR #441 (#426) first cut of the simulator page; PR #454 (#450) map legend.
- p2-a: PR #429 (#384) New delivery form; PR #432 (#385) delivery details; PR #433 (#386) Business data layer; PR #435 (#408) fonts; PR #443 (#439) header and activity.
- p2-b: PR #445 (#438) Employee page. p1-a: PR #427 (#424) matcher edge tests.

## In review
- PR #457 (#447, victor-3): `tests/geo` timeouts and the red-main report. CI was still running at 14:24.

## Queued this pass (`ready`)
- victor-1: **#464 v2 bootstrap** (`server/api/v2/bootstrap.ts` + `server/index.ts`: travel service, run, real `snapshotAt`, five route groups, `GET /geocode`, ticker; demo flow over HTTP on a sample cache); #466 README section for the Google setup and the fetch.
- victor-2: **#458 red main**; #459 simulator URL state, keys and desktop notice (`SimulatorV2.tsx`, `sim/v2/page/`); #460 inspector, package panel, legend and comparison in the page body (`sim/v2/compose/`).
- p2-a: #461 Business page (`pages/v2/BusinessV2.tsx`, `business/v2/page/`); #462 mount `/nyc/simulator` and `/nyc/employee/:id` with a header that works on the preview.
- p2-b: #463 commute route preview in the Employee page.
- victor-3: #465 `--refetch <placeId>` and moved homes in `--dry-run`. Still `ready` from pass 51: #448 Google access check.

## Next up (each needs the issues in brackets merged first)
- victor-2: route tween + "Play journey" in the simulator page [#459, #460]. This finishes journey mode, the demo's centerpiece.
- p2-a: mount `/nyc/business/:id` [#461, #462]; then the cutover of `/business`, `/employee`, `/simulator` to the v2 pages [end-to-end check on real data].
- victor-3: `--check-key` in the fetch command [#448, #465].
- victor-1: end-to-end test on the committed NYC cache [#464, the fetch]; README for `--refetch` and `--check-key`.
- p1-a, p1-b: verify the story on the real matrix and adjust `demoStory.json` if the plan check flags rows [the fetch].
- Then (M8 → M9): cutover, delete MVP 1 code, visual QA against the redesign doc.

## Known bugs / gaps
- **`GET /api/v2/geocode` is registered nowhere** and `server/index.ts` still mounts `/api/v2` as "not loaded". Both are in #464. Until it merges, the committed cache changes nothing in the app.
- The v2 pages are not mounted; `/nyc/...` works after #462 (simulator, employee) and a follow-up (business).
- No agent has keys: the Google map and the Google request shapes need one human look and the first real fetch.
- 11 other test files compare wall-clock time with a limit (`tests/domain`, `tests/api`); none has failed. Not swept (QUESTIONS pass 52).
- Git tag `mvp1` still does not exist. Business addresses are unconfirmed before the paid fetch.
- p1-a and p1-b have nothing `ready`: their next work needs the real matrix.
- This planner run can't use `gh run list`, `gh pr list`, `gh pr checks`, `gh api` or `git fetch`; it reads PRs one by one.
