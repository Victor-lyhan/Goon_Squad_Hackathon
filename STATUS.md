# STATUS (maintained by the planner)

_Last update: 2026-11-14, 18:35 (Sat), planner pass 68 (started 18:19)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. Order P1 simulator readability, P2 removals, P3 story retune, P4 restyle. **P1 and P3 are merged except the legend (#699). The rest is cleanup and restyle.**

## HUMAN TO-DO
1. **Open `/simulator` with the browser key now.** Play/Pause (#648), day/night (#649), the journey map (#659) and the timeline symbols (#683) are all merged. Nobody has seen the map yet. Or press **Watch a package** on `/`.
2. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line (25 route lines): `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`. Until then some relay legs move on straight lines (Navy Yard is fine).
3. **GitHub Actions still not running (billing).** Fix in GitHub Settings, Billing & plans. Reviewers run `bash scripts/test.sh` locally.
4. Overrule the calls of passes 63 to 68 in QUESTIONS.md if you disagree.
5. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health: two real local test failures, fix in review
- CI red = billing (DECISIONS pass 61). But local `bash scripts/test.sh` on main has 2 red tests: `kit-v2-index-html` (theme colour) and `employee-v2-map-refresh`. Fix issue #690 exists, PR #696 (victor-10) in review. No new fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (7 new)
- P1+P4 #699 legend shows the journey symbols, no "Leg 1/2"; map's last old colours (victor-2).
- P2 #700 hook/view cleanup (generate, recompute, resetPlanning, nextEventMin, scenario) + delete `sim/playbackModel.ts` and 4 tests (victor-8).
- P4 #701 simulator CSS restyle (victor-7). P2 #702 delete `client/src/api/client.ts` shim (victor-1).
- P2+P4 #703 "Find a delivery match" label + README to MVP III, no `/help` (victor-5).
- #704 UI test of the 30-second demo path (victor-9). #705 error fallback resets on query change (victor-3).
- Fewer than 4 each: every other step shares files with these or with PRs #696 to #698. victor-4 (engine) and victor-6 (Employee, #690 is in its files) got nothing.

## In review
- PR #696 (#690 red tests on main, victor-10), PR #697 (#691 Business `trackingModel` out, victor-5), PR #698 (#692 `markerTween` out, victor-1).

## Merged since pass 67 (18:10)
- PR #680 (#648) one Play/Pause, Overnight card, `?play=1`; speed, scrubber, next event, Scenario, Layers, key hints deleted.
- PR #682 (#650) story retune: 24 of 24 matched, at least 12 relays, 2 directs (NEEDS FETCH for 25 lines).
- PR #694 (#683) journey timeline with map symbols and A/B lines. PR #693 (#684) Business restyle. PR #695 (#685) Employee restyle.
- PR #689 (#686) unused UI kit components deleted. PR #688 (#660) Business `?play=1`. PR #687 (#677) MVP 1 store out of the server. PR #681 (#678) `createRng` in `server/domain/v2/rng.ts`.

## Next up (each needs the issues in brackets merged first)
- P2 MVP 1 server sweep, second half: `server/api/{initialRun,views,pipeline}.ts`, `server/domain/{routing,matching,simulation,metrics,generator}.ts`, `tests/api/views.test.ts`, the MVP 1 `tests/domain/*` files; `tests/ui/sim-v2-compare-fixture.ts` still imports MVP 1 `computeMetrics` [#691, #692, #700].
- Employee "Unknown place" flash before the business list arrives [#690].
- After #699 to #701: a final visual QA pass of `/simulator` once a human has looked at the real map.

## Known bugs / gaps
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
