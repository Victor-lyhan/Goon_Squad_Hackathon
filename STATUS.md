# STATUS (maintained by the planner)

_Last update: 2026-11-14, 17:50 (Sat), planner pass 64 (started 17:36)_

## Current milestone: MVP III (docs/mvp3.md, added 5:15 p.m.), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. Order P1 simulator readability, P2 removals, P3 story retune, P4 restyle. Issues are tagged P1 to P4.

## HUMAN TO-DO
1. **GitHub Actions still not running (billing).** The 3 latest runs on main are red for that reason; reviewers run `bash scripts/test.sh` locally. Fix in GitHub Settings, Billing & plans.
2. **Open `/simulator` with the browser key** once #648, #649 and #659 merge. Nobody has seen the map; the MVP III look can only be judged there.
3. Overrule the MVP III calls of passes 63 and 64 in QUESTIONS.md if you disagree.
4. Watch QUESTIONS.md for "NEEDS FETCH" lines from #650, then run `npm run fetch:routes -- --drop-entered` and commit `fixtures/nyc/`.
5. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health: no code failure known; CI cannot run (billing)
- The runs of #627, #609 and the 17:31 status commit failed; same billing cause as every run since 16:19. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (3 new)
- P1 #659 journey map: whole commutes thin in A blue / B green, carried part thick, square / Overnight diamond / swap / flag symbols, 2x orange package on top, A/B badges (victor-2).
- P1 #660 Business "Watch in simulator" opens with `?play=1`; planning note loses "and edited" (victor-5).
- P1 #661 Employee "Watch in simulator" opens with `?play=1` (victor-6).
- Only 3: every other MVP III step shares a file with an open issue (see Next up). victor-4 has nothing; the pool lets it take others' ready work.

## In progress / in review
- In review: PR #656 (#624 clock back to start after a new delivery, victor-3).
- In progress: #608 delete SVG city map (victor-2), #623 header links + delete Help (victor-5), #626 departure once (victor-6), #635 one set of status words (victor-10), #637 README fresh clone (victor-3), #640 fetch command hides typed homes (victor-9), #652 homepage "Watch a package" (victor-1).
- Ready: #648 Play/Pause (victor-8), #649 day/night (victor-10), #650 story retune (victor-7), #651 tokens (victor-9), #653 Navy Yard HTTP test (victor-6), #636 header lists retry (victor-5), #659, #660, #661.

## Merged since pass 63 (17:22)
- PR #655 (#627) commute save re-plans; PR #654 (#609) Business table at 390 px; PR #647 (#595) route hover names; PR #646 (#628) MVP 1 API deleted; PR #645 (#633) Employee announces a new delivery; PR #644 (#597) Employee poller.

## Next up (each needs the issues in brackets merged first)
- P1 journey timeline with the same symbols instead of numbers [#635, #659].
- P1 map legend: A/B carrier rows, no "Leg 2" row for a direct journey [#648 (`legend/`), #659].
- P2 delete the hook's `generate` / `recompute` / `resetPlanning` and the leftover controls fields in `simPageView.ts` [#648, #649].
- P4 lighter restyle passes: simulator, Business, Employee pages [#651; #648/#649/#659 for the simulator].
- README: MVP III demo steps ("Watch a package"), no Help page [#637, #623, #652].
- UI test of the demo path: homepage button to a playing Navy Yard journey [#648, #652].
- Later: MVP 1 engine and `server/api/{initialRun,pipeline,simulator,views,map}.ts` sweep with `createRng` move (touches ~30 test files, so after the simulator test churn ends) [#648].
- "Find a delivery match" label (README test pins it) [#637].

## Known bugs / gaps
- A delivery added after a preview shows as delivered and paid (#624, PR #656).
- Header links open the first account, not the one on screen (#623); stay greyed after a failed load (#636).
- Employee departure shown twice (#626). Status words differ between list and inspector (#635).
- README says Node 22; Vite needs 22.12+ (#637). `PORT` does not work with `npm run dev` (needs your config change).
- This planner run could not use `gh run list`; it read the checkout at b53efad (main after PR #655).
