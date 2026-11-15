# STATUS (maintained by the planner)

_Last update: 2026-11-14, 19:20 (Sat), planner pass 75 (started 19:13)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1, P2 and P3 are merged. P4 browser QA merged: page CSS (#722), simulator (#723), production mode (#726), Employee flow (#729), simulator keyboard pass (#730), bare-path redirect + `/` keyboard pass (#732), server hardening (#733). In review: "Back to start" unlocks the run (PR #736), Business flow (PR #731, needs fix). In progress: README walk-through (#728), Employee keyboard pass (#735). New: Plex Mono 600 + no-key card advice (#737).**

## HUMAN TO-DO
1. **Do not press Play with no package picked while rehearsing until #734 (PR #736) merges.** It locks the run and nothing in the app unlocks it; every later "Find a delivery match" is refused. Fix now: stop the server, delete `data/state-v2.json`, restart. (QUESTIONS pass 74.)
2. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
3. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726).
4. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line: `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`.
5. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
6. Overrule the calls of passes 63 to 74 in QUESTIONS.md if you disagree. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (#724, #725, planner 19:08) are that. No fix issue. PRs #730, #732, #733 ran `bash scripts/test.sh` green locally (up to 5907 tests).

## Stuck
- Nothing labeled `stuck`. PR #731 (#719) is `needs-fix`: reviewer wants jsdom tests for its four fixes and a real PR body; victor-5 is on it.

## Queued this pass (1 new)
- #737 Load IBM Plex Mono 600 (mono badges were faked bold), font-weight test over every client CSS file, no-key map card advice right for `npm start` (victor-9). `styles/fonts.css`, `sim/v2/journey/journey.css`, `map/GoogleBaseMap.tsx`.
- Only 1: business/v2 (#719), employee/v2 (#735), server (#734) and README (#728) are held; engine and geo have no MVP III work.

## In review
- PR #736 (#734) `reset_playback` reopens planning; locked 409s name "Back to start" (victor-1).
- PR #731 (#719) Business flow QA, needs fix (victor-5).

## In progress
- #728 README walk-through against `npm start` (victor-7).
- #735 Employee keyboard and screen-reader pass (victor-6).

## Merged since pass 74 (19:10)
- PR #733 (#727) `RELAY_STATE_PATH` (a folder means `state-v2.json` inside it), 404 for missing `/assets/`, HEAD on pages.
- PR #732 (#724) bare `/business` `/employee` replace-redirect to the header's account; one "Real NYC locations" line; shell focus-ring fixes.
- PR #730 (#725) simulator: one announcement per step, Overnight card announced once, Play and Back to start keep focus (`aria-disabled`).
- Earlier MVP III: #729, #726, #723, #722, #717, #716, #715, #713, #710, #709, #708, #707 and before.

## Next up (each needs the issues in brackets merged first)
- Business and Employee locked copy names "Back to start" instead of "new planning cycle" [#734, #719, #735].
- Business markup from PR #722: price in the notification sentence, New delivery hints in mono spans [#719].
- README: `RELAY_STATE_PATH` sentence (in PR #733 body), bare-path redirect, "Back to start" reopens planning [#734, #728].
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- **Play with no package locks the run for good** (no unlock control since #700); fix #734.
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
- Employee job marks "Collect the package (done)" when the commute leaves (needs a per-stop field in `shared/v2/api.ts`, QUESTIONS pass 61).
- Business notification price and New delivery hints are Inter, not Plex Mono (after #719).
- Plex Mono at 600/700 is faked bold (only 400/500 loaded), and the no-key map card says "restart `npm run dev`", wrong under `npm start`; fix #737.
- A QA server without `RELAY_STATE_PATH` still writes `data/state-v2.json`; set it (PR #733).
- Employee Watch links on a phone land on the simulator's "needs a wider screen" notice (by design, pass 74).
