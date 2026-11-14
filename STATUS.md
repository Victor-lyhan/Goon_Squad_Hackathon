# STATUS (maintained by the planner)

_Last update: 2026-11-14, 15:00 (Sat), planner pass 54 (started 14:43)_

## Current milestone: M8 Integration (target 6:00 p.m. Sat)
M7 is closed: the humans ran the paid fetch and committed the route cache (4fe3039, complete, 0 errors). The plan check on real travel times fails: **13 of 24 packages matched, 6 story rows of the wrong type**. The humans set the default detour limit to 12 min and asked for a retune to at least 20 of 24. That retune (#492) is the top item; the cutover to the MVP II pages waits for it and for the end-to-end test (#494). MVP 1 still runs untouched on `/`.

## HUMAN TO-DO
1. After #492 merges: `npm run fetch:routes` once more (only the new route lines are fetched), commit `polylines.json`. Exit code 0 = the story matches as written.
2. Restart the server, open `/nyc/simulator`, `/nyc/business/<id>`, `/nyc/employee/<id>` with the browser key. No agent has seen the Google map.
3. If p1-b writes BLOCKED.md on #492, it lists home moves and their `--refetch` lines for you.

## Main health: green as far as visible
- Snapshot at 14:43: the newest finished run on main is green (#466), two were in progress. The planner can't list runs.
- PR #487 (#476) has a failed check on its branch; the reviewer has it.

## Stuck
- Nothing.

## Queued this pass (`ready`)
- p1-b: **#492 story retune** (`demoStory.json`, default limit 12 in `shared/v2/schemas.ts`, a story test on the committed matrix). #482 (timed tests) is parked without `ready` until #492 has a PR.
- p1-a: #481 story explainer (from pass 53, not picked up yet); #493 matcher on the real cache (2 s limit, determinism, Random cities never miss a pair).
- victor-1: **#494 end-to-end demo flow on the real cache** (gate for the cutover); #495 v2 poll budget on the real run.
- victor-2: **#496 journey mode: route tween and "Play journey" in the simulator page** (the demo's centerpiece; the motion files exist but nothing uses them).
- p2-a: #497 Business workspace check at 390 px and by keyboard.
- victor-3: #498 guard test on the committed cache.
- p2-b: nothing (see QUESTIONS pass 54).

## In progress / in review
- victor-1: #480 timed tests in `tests/api` (in progress).
- p2-a: PR #487 (#476) homepage NYC data source, CI failed. p2-b: PR #488 (#478) Employee workspace check, CI running at 14:55.

## Merged since pass 52 (14:25)
- victor-1: PR #472 (#464) **v2 bootstrap**, `/api/v2` is live when the cache loads; PR #484 (#466) README for MVP II.
- victor-2: PR #470 (#458) red-main fix; PR #473 (#459) simulator URL state and keys; PR #485 (#460) simulator page body; PR #489 (#479) simulator pieces QA.
- p2-a: PR #469 (#461) Business page; PR #471 (#462) `/nyc` preview routes; PR #486 (#475) `/nyc/business/:id`; PR #490 (#477) kit and tokens QA.
- p2-b: PR #468 (#463) commute route on the Employee page.
- victor-3: PR #457 (#447); PR #467 (#448) key check; PR #474 (#465) `--refetch`; PR #491 (#483) `--check-key`.
- Humans: 4fe3039 route cache; f0e90f4 the retune note in QUESTIONS.md.

## Next up (each needs the issues in brackets merged first)
- p2-a: cutover of `/business/:id`, `/employee/:id`, `/simulator` to the v2 pages, header text "Real NYC locations · simulated deliveries" [#492, #494]. Then each owner deletes its MVP 1 files.
- victor-1: README demo steps with the live demo request pinned by a test [#492].
- victor-3: print `explainShipment` for failed story rows in the fetch command [#481].
- p1-b: put `ready` back on #482 [#492 has a PR].
- M9: Help page copy for NYC (p2-a), reduced motion and 390 px on the assembled pages after the cutover.

## Known bugs / gaps
- **The default NYC scenario matches 13 of 24** and the story rows are not as written (#492).
- **"Play journey" and the route tween are not wired into the simulator page** (#496).
- The default detour limit is still 8 in `shared/v2/schemas.ts`; #492 changes it to 12.
- Route lines exist only for the old story's plans; after the retune a human fetch adds the new ones.
- Pass 53's planner files were lost (rebuilt in DECISIONS pass 53). Git tag `mvp1` still does not exist.
- This planner run can't use `gh run list`, `gh pr list`, `npm` or `tsx`; it reads PRs one by one and cannot run the plan check itself.
