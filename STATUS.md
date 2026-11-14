# STATUS (maintained by the planner)

_Last update: 2026-11-14, 17:58 (Sat), planner pass 66 (started 17:53)_

## Current milestone: MVP III (docs/mvp3.md, added 5:15 p.m.), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. Order P1 simulator readability, P2 removals, P3 story retune, P4 restyle. Issues are tagged P1 to P4.

## HUMAN TO-DO
1. **GitHub Actions still not running (billing).** The 3 latest runs on main (#649, #608, the 17:48 planner commit) are red; reviewers run `bash scripts/test.sh` locally. Fix in GitHub Settings, Billing & plans.
2. **Open `/simulator` with the browser key** once #648 and #659 merge (#649 day/night is merged). Nobody has seen the map yet.
3. Overrule the MVP III calls of passes 63 to 66 in QUESTIONS.md if you disagree.
4. Watch QUESTIONS.md for "NEEDS FETCH" lines from #650, then run `npm run fetch:routes -- --drop-entered` and commit `fixtures/nyc/`.
5. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health: no code failure known; CI cannot run (billing)
- Same billing cause as every run since 16:19 (DECISIONS pass 61). No fix issue. This pass could not open the run logs (`gh run` needs approval).

## Stuck
- Nothing labeled `stuck`. PR #671 (#652 homepage) is `needs-fix`, back with victor-1.

## Queued this pass (2 new)
- P2 #677 remove the MVP 1 store from `server/index.ts` and every `tests/api/` file; delete `server/api/{map,simulator,pipeline}.ts` (victor-10, idle).
- P2 #678 move `createRng` into `server/domain/v2/rng.ts` (victor-4).
- Only 2: everything else shares a file with an open issue or waits for one (see Next up).

## In progress / in review
- In review: PR #675 (#669 delete Employee MVP 1 models, victor-4), PR #674 (#670 New delivery helpers, victor-3), PR #673 (#651 MVP III tokens, victor-9), PR #672 (#636 header lists retry, victor-5), PR #671 (#652 homepage, needs-fix, victor-1).
- In progress: #648 Play/Pause (victor-8), #659 journey map (victor-2), #650 story retune (victor-7), #661 Employee `?play=1` (victor-6).
- Ready: #660 Business `?play=1` (victor-7), #677, #678.

## Merged since pass 65 (17:48)
- PR #668 (#649) day/night map; PR #667 (#608) SVG city map deleted; PR #666 (#653) Navy Yard over HTTP; PR #665 (#640) fetch command hides typed homes; PR #664 (#623) Help deleted + header links open the account.

## Next up (each needs the issues in brackets merged first)
- P1 journey timeline with the same symbols instead of numbers [#659].
- P1 map legend: A/B carrier rows, no "Leg 2" row for a direct journey [#648, #659].
- P2 delete the hook's `generate` / `recompute` / `resetPlanning` and the leftover controls fields in `simPageView.ts` [#648].
- P2 move `clampAlpha` / `REDUCED_MOTION_QUERY` into `sim/v2/motion/`, delete `sim/markerTween.ts` and `sim/playbackModel.ts` with their MVP 1 tests [#648].
- P2 move `carrierHref` / `simulatorHref` into `business/v2/`, delete MVP 1 `business/trackingModel.ts` and its tests [#660].
- P2 MVP 1 sweep, second half: `server/api/{initialRun,views}.ts`, MVP 1 engine files and their tests [#648, #660, #669, #670, #677, #678].
- P4 lighter restyle passes: simulator, Business, Employee pages [#651; #648/#659 for the simulator].
- README: MVP III demo steps ("Watch a package"), no Help page [#652].
- "Find a delivery match" button label [#670].
- UI test of the demo path: homepage button to a playing Navy Yard journey [#648, #652].

## Known bugs / gaps
- Header link lists stay greyed after a failed load (#636, PR #672).
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
