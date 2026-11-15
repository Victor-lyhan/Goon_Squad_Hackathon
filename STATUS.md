# STATUS (maintained by the planner)

_Last update: 2026-11-14, 19:23 (Sat), planner pass 76 (started 19:21)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1, P2 and P3 are merged. P4 browser QA merged: page CSS (#722), simulator (#723), production mode (#726), Employee flow (#729), simulator keyboard pass (#730), bare-path redirect + `/` keyboard pass (#732), server hardening (#733), "Back to start" unlocks the run (#736). Needs fix: Business flow (PR #731), README walk-through (PR #738), both for their PR body only. In progress: Employee keyboard pass (#735), Plex Mono 600 (#737). New: other journeys QA (#739), rehearse-twice UI test (#740).**

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Rehearsing is safe again (PR #736):** after Play with no package picked, press **Back to start** and requests and commute edits reopen. No need to delete `data/state-v2.json`.
3. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726).
4. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line: `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`.
5. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
6. Overrule the calls of passes 63 to 76 in QUESTIONS.md if you disagree. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (#734, planner 19:08 and 19:16) are that. No fix issue. PR #736 ran `bash scripts/test.sh` green locally (5952 tests).

## Stuck
- Nothing labeled `stuck`. PRs #731 (#719) and #738 (#728) are `needs-fix` for the PR body only (results table, "Needs …" lists); code and tests passed review.

## Queued this pass (2 new)
- #739 Play a direct, a non-Navy-Yard relay and an unmatched journey, and network Play → Back to start → journey, in headless Chrome; fix `.tsx`/`.ts` in `sim/v2/` and `map/` (not `GoogleBaseMap.tsx`, no CSS) (victor-2).
- #740 UI test: Play locks Business and Employee, Back to start reopens them within one poll, twice, on a real server; `tests/ui/demo-rehearse-twice.test.tsx` only (victor-8).
- Only 2: business/v2 (#719), employee/v2 (#735), README (#728) and fonts/journey CSS/GoogleBaseMap (#737) are held; engine and geo have no MVP III work.

## In review / needs fix
- PR #731 (#719) Business flow QA (victor-5), PR #738 (#728) README walk-through (victor-7).

## In progress
- #735 Employee keyboard and screen-reader pass (victor-6).
- #737 Plex Mono 600, font-weight test over all client CSS, no-key card advice (victor-9).

## Merged since pass 75 (19:20)
- PR #736 (#734) `reset_playback` sets `phase: 'planning'` (clock at start, paused, no re-match); the three locked 409s name "Back to start"; `tests/api/v2-reset-unlocks.test.ts` rehearses twice over HTTP.
- Earlier MVP III: #733, #732, #730, #729, #726, #723, #722, #717, #716, #715, #713, #710, #709, #708 and before.

## Next up (each needs the issues in brackets merged first)
- Business locked copy ("until the next planning cycle", `newDeliveryModel.ts:301`, `deliveryDetailsModel.ts:218`) names "Back to start" [#719].
- Employee locked copy (`employeeWorkspaceModel.ts:178`, `commuteFormModel.ts:231`) names "Back to start" [#735].
- README: "Back to start" unlocks (and `tests/api/readme.test.ts` pin "reset as above to unlock it" with it), `RELAY_STATE_PATH`, bare-path redirect [#728].
- Business markup from PR #722: price in the notification sentence, New delivery hints in mono spans [#719].
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- Business and Employee locked notes still say "next/new planning cycle", a control that no longer exists; the way out is now "Back to start" (after #719, #735).
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
- Employee job marks "Collect the package (done)" when the commute leaves (needs a per-stop field in `shared/v2/api.ts`, QUESTIONS pass 61).
- Business notification price and New delivery hints are Inter, not Plex Mono (after #719).
- Plex Mono at 600/700 is faked bold, and the no-key map card says "restart `npm run dev`", wrong under `npm start`; fix #737.
- README still says nothing unlocks a locked run and to delete the state file (after #728).
- Employee Watch links on a phone land on the simulator's "needs a wider screen" notice (by design, pass 74).
