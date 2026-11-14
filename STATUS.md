# STATUS (maintained by the planner)

_Last update: 2026-11-14, 15:03 (Sat), planner pass 55 (started 14:57)_

## Current milestone: M8 Integration (target 6:00 p.m. Sat)
The route cache is on main and passes its guard test (PR #501: 148 places, 4,986 pairs, 162 route lines, nothing to refetch). The story still matches **13 of 24** on real travel times; the retune (#492, p1-b) is the top item and **has not been picked up yet**. The cutover to the MVP II pages waits for #492 and the end-to-end test (#494, in progress). Journey mode with "Play journey" is in review (PR #502). MVP 1 still runs untouched on `/`.

## HUMAN TO-DO
1. **Check the Codex workers.** p1-a has not started #481 (ready since 14:36) and p1-b has not started #492 (ready since 14:49). Their last PRs were at 14:04 and 14:22.
2. After #492 merges: `npm run fetch:routes` once more (only new route lines are fetched), commit `polylines.json`. Exit code 0 = the story matches as written.
3. **Before restarting the server after #492: delete `data/state-v2.json`** (or Simulator, Scenario, preset demo, Generate). A saved NYC run survives a story change until #503 merges.
4. Open `/nyc/simulator`, `/nyc/business/<id>`, `/nyc/employee/<id>` with the browser key. No agent has seen the Google map.

## Main health: green as far as visible
- Snapshot at 14:56: the newest finished run on main is green, two were in progress. The planner can't list runs.
- One flake seen by a worker, not on CI: `tests/api/commute-latency.test.ts` (MVP 1) measured 160 ms against 150 ms on a loaded machine (PR #501 notes).

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (`ready`)
- victor-1: **#503 a changed story starts a fresh NYC run** (fingerprint next to `data/state-v2.json`, stale run set aside).
- p2-a: #504 `/nyc` homepage and `/nyc/help` (cutover prep); #505 jsdom test harness, proven on the New delivery form.
- Nothing new for victor-2, victor-3, p2-b, p1-a, p1-b (see QUESTIONS pass 55).

## Still `ready` from earlier passes
- p1-b: **#492 story retune**. #482 (timed tests) stays parked without `ready` until #492 has a PR.
- p1-a: #481 story explainer; #493 matcher on the real cache.
- victor-1: #495 v2 poll budget on the real run.

## In progress / in review
- victor-1: #494 end-to-end demo flow on the real cache (in progress; gate for the cutover).
- victor-2: PR #502 (#496) route tween and "Play journey", CI running at 15:01.

## Merged since pass 54 (14:43)
- victor-3: PR #501 (#498) guard test on the committed cache, all checks pass.
- victor-1: PR #500 (#480) timed tests in `tests/api` at the 10x-or-ratio rule.
- p2-a: PR #499 (#497) Business workspace at 390 px and by keyboard; PR #487 (#476) homepage NYC data source.
- p2-b: PR #488 (#478) Employee workspace check. victor-2: PR #489 (#479). victor-3: PR #491 (#483) `--check-key`.

## Next up (each needs the issues in brackets merged first)
- p2-a: cutover of `/`, `/help`, `/business/:id`, `/employee/:id`, `/simulator` to MVP II, header text "Real NYC locations · simulated deliveries" [#492, #494, #504]. Then each owner deletes its MVP 1 files.
- victor-1: README demo steps with the live demo request pinned by a test [#492].
- victor-3: print `explainShipment` for failed story rows in the fetch command [#481].
- p2-b, victor-2: one real-DOM interaction test each (commute form and address search; Play journey and selection) [#505, #502].
- p1-b: put `ready` back on #482 [#492 has a PR].

## Known bugs / gaps
- **The default NYC scenario matches 13 of 24** and the story rows are not as written (#492).
- **A restart keeps the old saved NYC run after the story changes** (#503; until then delete `data/state-v2.json`).
- `/nyc` is a 404 and `/help` shows MVP 1 accounts and links (#504).
- No test runs a UI effect or event handler in a DOM (#505 starts this).
- The default detour limit is still 8 in `shared/v2/schemas.ts`; #492 changes it to 12.
- Route lines exist only for the old story's plans; after the retune a human fetch adds the new ones.
- Git tag `mvp1` still does not exist.
- This planner run can't use `gh run list`, `gh pr list`, `npm` or `tsx`; it reads PRs one by one.
