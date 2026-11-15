# STATUS (maintained by the planner)

_Last update: 2026-11-14, 19:10 (Sat), planner pass 74 (started 19:05)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1, P2 and P3 are merged. P4 browser QA: page CSS (#722), simulator (#723), production mode (#726) and the Employee flow (#729) are merged. In review: Business flow (#731, needs fix), simulator keyboard pass (#730), bare-path redirect and `/` keyboard pass (#732), server hardening (#733). README walk-through (#728) in progress. New: "Back to start" unlocks the run (#734), Employee keyboard pass (#735).**

## HUMAN TO-DO
1. **Do not press Play with no package picked while rehearsing until #734 merges.** It locks the run and nothing in the app unlocks it; every later "Find a delivery match" is refused. Fix now: stop the server, delete `data/state-v2.json`, restart. (QUESTIONS pass 74.)
2. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
3. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726).
4. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line: `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`.
5. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
6. Overrule the calls of passes 63 to 74 in QUESTIONS.md if you disagree. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (#720, #721, planner 19:00) are that. No fix issue. PR #729 ran `bash scripts/test.sh` green locally (5875 tests).

## Stuck
- Nothing labeled `stuck`. PR #731 (#719) is `needs-fix`: reviewer wants tests for its four fixes and a real PR body; victor-5 is on it.

## Queued this pass (2 new)
- #734 `reset_playback` returns the run to `planning`; locked 409 texts name "Back to start"; HTTP test rehearses the demo twice (victor-1). `server/clock.ts`, `server/api/v2/`, `tests/api/`.
- #735 Employee keyboard and screen-reader pass in headless Chrome, `employee/v2/**` (victor-6).
- Only 2: business/v2, sim/v2, map/, App/Landing/shell, server/index.ts and README are held by open PRs; engine and geo have no MVP III work.

## In review
- PR #733 (#727) `RELAY_STATE_PATH`, 404 for missing `/assets/`, HEAD on pages (victor-1).
- PR #732 (#724) bare `/business` `/employee` redirect, one "Real NYC locations" line, `/` keyboard pass (victor-10).
- PR #730 (#725) simulator keyboard/screen-reader pass, `journey.css` fallbacks (victor-2).
- PR #731 (#719) Business flow QA, needs fix (victor-5).

## In progress
- #728 README walk-through against `npm start` (victor-7).

## Merged since pass 73 (19:00)
- PR #729 (#720) Employee flow QA: save waits for its refetch (no old times under "Commute saved."), locked sentence names no missing button; 5875 tests.
- PR #726 (#721) production mode: new `tests/api/production-mode.test.ts`, no server change needed.
- Earlier MVP III: #723, #722, #717, #716, #715, #713, #710, #709, #708, #707, #706, #698, #697 and before.

## Next up (each needs the issues in brackets merged first)
- Business and Employee locked copy names "Back to start" instead of "new planning cycle" [#734, #719].
- Business markup from PR #722: price in the notification sentence, New delivery hints in mono spans [#719].
- No-key map card says "restart `npm run dev`", wrong in production mode (`map/GoogleBaseMap.tsx`) [#725].
- README: `RELAY_STATE_PATH`, bare-path redirect, "Back to start" reopens planning [#727, #724, #734, #728].
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- **Play with no package locks the run for good** (no unlock control since #700); fix #734.
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
- Employee job marks "Collect the package (done)" when the commute leaves (needs a per-stop field in `shared/v2/api.ts`, QUESTIONS pass 61).
- Business notification price and New delivery hints are Inter, not Plex Mono (after #719).
- A server started from a worktree writes `data/state-v2.json` and turns `tests/api/v2-e2e-nyc-*` red while it runs (#727).
- Employee Watch links on a phone land on the simulator's "needs a wider screen" notice (by design, pass 74).
