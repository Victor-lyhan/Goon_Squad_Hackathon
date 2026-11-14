# STATUS (maintained by the planner)

_Last update: 2026-11-14, 18:10 (Sat), planner pass 67 (started 18:02)_

## Current milestone: MVP III (docs/mvp3.md, added 5:15 p.m.), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. Order P1 simulator readability, P2 removals, P3 story retune, P4 restyle. Issues are tagged P1 to P4.

## HUMAN TO-DO
1. **GitHub Actions still not running (billing).** The 3 latest runs on main (#659, #652, the 17:57 planner commit) are red; reviewers run `bash scripts/test.sh` locally. Fix in GitHub Settings, Billing & plans.
2. **Open `/simulator` with the browser key now.** Day/night (#649) and the journey map (#659) are merged; Play/Pause (#648, PR #680) is not yet. Nobody has seen the map.
3. Overrule the MVP III calls of passes 63 to 67 in QUESTIONS.md if you disagree.
4. Watch QUESTIONS.md for "NEEDS FETCH" lines from #650, then run `npm run fetch:routes -- --drop-entered` and commit `fixtures/nyc/`.
5. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health: no code failure known; CI cannot run (billing)
- Same billing cause as every run since 16:19 (DECISIONS pass 61). No fix issue. `gh run` needs approval in this session, so logs were not opened.

## Stuck
- Nothing labeled `stuck`. **PR #680 (#648 Play/Pause) is the bottleneck:** the reviewer found 26 type errors in 5 test files, and it now conflicts with main (#659, #664 Help deletion). Five "Next up" items wait for it.

## Queued this pass (4 new)
- P1 #683 journey timeline with the map's symbols and A/B carrier lines (victor-2).
- P4 #684 Business page restyle, CSS only (victor-5). P4 #685 Employee page restyle, CSS only (victor-6).
- P2 #686 delete the unused UI kit components Card, StatusPill, Field, Drawer, Toast, EmptyState, focusCycle (victor-9).
- Only 4: everything else shares a file with PR #680, #650, #660 or #677 (see Next up).

## In progress / in review
- In review: PR #680 (#648 Play/Pause, victor-8, conflicting + failing typecheck); #678 createRng move (victor-4, closed by its PR).
- In progress: #650 story retune (victor-7), #677 MVP 1 store out of the server (victor-10).
- Ready: #660 Business `?play=1` (victor-7), #683, #684, #685, #686.

## Merged since pass 66 (17:58)
- PR #679 (#659) journey map: A blue / B green commutes, carried part thick, square/diamond/swap/flag, 2x orange package.
- PR #676 (#661) Employee `?play=1` links; PR #675 (#669) Employee MVP 1 models deleted; PR #674 (#670) New delivery helpers moved; PR #673 (#651) MVP III tokens and fonts; PR #672 (#636) header lists retry; PR #671 (#652) homepage "Watch a package".

## Next up (each needs the issues in brackets merged first)
- P1 map legend (`sim/v2/legend/`): A/B carrier rows, no "Leg 2" row for a direct journey [#648].
- P2 delete the hook's `generate` / `recompute` / `resetPlanning` and leftover controls fields in `simPageView.ts` [#648].
- P2 move `clampAlpha` / `REDUCED_MOTION_QUERY` into `sim/v2/motion/`, delete `sim/markerTween.ts` and `sim/playbackModel.ts` with their MVP 1 tests [#648].
- P2 move `carrierHref` / `simulatorHref` into `business/v2/`, delete MVP 1 `business/trackingModel.ts` and its tests [#660].
- P2 MVP 1 sweep, second half: `server/api/{initialRun,views}.ts`, MVP 1 engine files, `client/src/api/client.ts` shim and `tests/api/client.test.ts` [#648, #660, #677].
- P4 simulator restyle [#648, #683].
- README MVP III demo steps + "Find a delivery match" label, one issue (both touch README; PR #680 edits README) [#648].
- UI test of the demo path: homepage button to a playing Navy Yard journey [#648].

## Known bugs / gaps
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
