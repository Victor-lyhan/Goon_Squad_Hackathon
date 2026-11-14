# STATUS (maintained by the planner)

_Last update: 2026-11-14, 17:55 (Sat), planner pass 65 (started 17:45)_

## Current milestone: MVP III (docs/mvp3.md, added 5:15 p.m.), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. Order P1 simulator readability, P2 removals, P3 story retune, P4 restyle. Issues are tagged P1 to P4.

## HUMAN TO-DO
1. **GitHub Actions still not running (billing).** The 3 latest runs on main (#637, #626, the planner commit) are red; reviewers run `bash scripts/test.sh` locally. Fix in GitHub Settings, Billing & plans.
2. **Open `/simulator` with the browser key** once #648, #649 and #659 merge. Nobody has seen the map; the MVP III look can only be judged there.
3. Overrule the MVP III calls of passes 63 to 65 in QUESTIONS.md if you disagree.
4. Watch QUESTIONS.md for "NEEDS FETCH" lines from #650, then run `npm run fetch:routes -- --drop-entered` and commit `fixtures/nyc/`.
5. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health: no code failure known; CI cannot run (billing)
- Same billing cause as every run since 16:19 (DECISIONS pass 61). No fix issue. This pass could not run `gh run list` (needs approval); it read the checkout at a83f78b (main after PR #663).

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (2 new)
- P2 #669 delete MVP 1 `employee/commuteModel.ts` + `jobDetailModel.ts` and their 6 tests (victor-4, idle).
- P2 #670 move the 4 live helpers into `business/v2/newDeliveryModel.ts`, delete MVP 1 `business/shipmentFormModel.ts` + its tests (victor-3, idle).
- Only 2: every other MVP III step shares a file with an open issue or waits for one (see Next up).

## In progress / in review
- In review: PR #665 (#640 fetch command hides typed homes, victor-9), PR #664 (#623 header links + delete Help, victor-5).
- In progress: #648 Play/Pause (victor-8), #649 day/night (victor-10), #650 story retune (victor-7), #651 tokens (victor-9), #652 homepage "Watch a package" (victor-1), #653 Navy Yard HTTP test (victor-6), #636 header lists retry (victor-5), #608 delete SVG city map (victor-2).
- Ready: #659 journey map (victor-2), #660 Business `?play=1` (victor-7), #661 Employee `?play=1` (victor-6), #669, #670.

## Merged since pass 64 (17:36)
- PR #663 (#637) README fresh clone + tab icon; PR #662 (#626) departure once; PR #658 (#635) one set of status words; PR #657 (#604) Random city edges test; PR #656 (#624) clock back to start after a new delivery.

## Next up (each needs the issues in brackets merged first)
- P1 journey timeline with the same symbols instead of numbers [#659].
- P1 map legend: A/B carrier rows, no "Leg 2" row for a direct journey [#648 (`legend/`), #659].
- P2 delete the hook's `generate` / `recompute` / `resetPlanning` and the leftover controls fields in `simPageView.ts` [#648, #649].
- P2 move `clampAlpha` / `REDUCED_MOTION_QUERY` into `sim/v2/motion/`, delete `sim/markerTween.ts` and `sim/playbackModel.ts` with their MVP 1 tests [#608, #648].
- P2 move `carrierHref` / `simulatorHref` into `business/v2/`, delete MVP 1 `business/trackingModel.ts` and its tests [#660].
- P4 lighter restyle passes: simulator, Business, Employee pages [#651; #648/#649/#659 for the simulator].
- README: MVP III demo steps ("Watch a package"), no Help page [#623, #652].
- "Find a delivery match" button label [#623, #670].
- UI test of the demo path: homepage button to a playing Navy Yard journey [#648, #652].
- MVP 1 server sweep (`server/api/{initialRun,pipeline,simulator,views,map}.ts`, MVP 1 engine) with the `createRng` move [#648, #669, #670].

## Known bugs / gaps
- Header link lists stay greyed after a failed load (#636).
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
