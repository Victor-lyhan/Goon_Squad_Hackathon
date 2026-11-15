# STATUS (maintained by the planner)

_Last update: 2026-11-14, 19:30 (Sat), planner pass 77 (started 19:28)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1, P2 and P3 are merged. P4 browser QA merged: page CSS (#722), simulator (#723), production mode (#726), Employee flow (#729), simulator keyboard pass (#730), Business flow (#731), bare-path redirect + `/` keyboard pass (#732), server hardening (#733), "Back to start" unlocks the run (#736), Plex Mono 600 + no-key card advice (#741). Needs fix: README walk-through (PR #738, PR body only). In progress: Employee keyboard pass (#735), other journeys QA (#739), rehearse-twice UI test (#740). New: Business locked copy + mono markup (#742), global bold weight (#743).**

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Rehearsing is safe (PR #736):** after Play with no package picked, press **Back to start** and requests and commute edits reopen. No need to delete `data/state-v2.json`.
3. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726; the no-key card now says so, PR #741).
4. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line: `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`.
5. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
6. Overrule the calls of passes 63 to 77 in QUESTIONS.md if you disagree. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (#719, #737, planner 19:23) are that. No fix issue. PR #731 ran `bash scripts/test.sh` green locally (5985 passed, 1 expected fail).

## Stuck
- Nothing labeled `stuck`. PR #738 (#728) is `needs-fix` for the PR body only (results table, "Needs code" list); code passed review.

## Queued this pass (2 new)
- #742 Business locked notes name "Back to start"; notification price and New delivery hint data in mono spans; stale Plex Mono comments (victor-5).
- #743 `strong, b, th { font-weight: 600 }` in `styles/global.css`, font test, headless sweep of Business details, Employee job, journey (victor-9).
- Only 2: employee/v2 (#735), sim/v2 + map (#739), README (#728) are held; engine, geo and API have no MVP III work.

## In review / needs fix
- PR #738 (#728) README walk-through (victor-7).

## In progress
- #735 Employee keyboard and screen-reader pass (victor-6).
- #739 Direct, other relay, unmatched journeys + network Play → Back to start in headless Chrome (victor-2).
- #740 UI test: rehearse the demo twice on a real server (victor-8).

## Merged since pass 76 (19:23)
- PR #731 (#719) Business flow QA: match result and details scrolled into view, "The server did not answer" for status 0, double press on Find a delivery match dropped; 33 tests.
- PR #741 (#737) Plex Mono 600 loaded, journey badges 600, font-weight test over all 28 client CSS files, no-key card names `npm run build` before `npm start`.
- Earlier MVP III: #736, #733, #732, #730, #729, #726, #723, #722, #717, #716, #715, #713, #710 and before.

## Next up (each needs the issues in brackets merged first)
- Employee locked copy (`employeeWorkspaceModel.ts:178`, `commuteFormModel.ts:231`) names "Back to start"; fix stale title in `tests/ui/employee-v2-mvp3-css.test.ts` [#735].
- `map/layers.ts` deck.gl text asks for 'IBM Plex Sans' (not loaded since #651) at 600/700; should be Inter 600 [#739].
- README: "Back to start" unlocks (and `tests/api/readme.test.ts` pin), `RELAY_STATE_PATH`, bare-path redirect [#728].
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- Business and Employee locked notes still say "next/new planning cycle"; fix #742 (Business), after #735 (Employee).
- Unstyled `<strong>`/`<b>`/`<th>` are faked bold at 700; fix #743.
- Map text layers name an unloaded font (`map/layers.ts`), only visible with a key (after #739).
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
- Employee job marks "Collect the package (done)" when the commute leaves (needs a per-stop field in `shared/v2/api.ts`, QUESTIONS pass 61).
- README still says nothing unlocks a locked run and to delete the state file (after #728).
- Employee Watch links on a phone land on the simulator's "needs a wider screen" notice (by design, pass 74).
