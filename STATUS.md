# STATUS (maintained by the planner)

_Last update: 2026-11-14, 19:00 (Sat), planner pass 73 (started 18:58)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1, P2 and P3 are merged. P4 browser QA: page CSS (PR #722) and the simulator (PR #723) are merged; production mode (PR #726) is in review and found nothing broken; the Business (#719) and Employee (#720) flow checks and two follow-ups (#724, #725) are in progress; server hardening (#727) and the README walk-through (#728) are queued.**

## HUMAN TO-DO
1. **Open `/simulator` with the browser key now**, or press **Watch a package** on `/`. All of MVP III P1 is on main. Agents checked it without a key; nobody has seen the map. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env`, or the production map says "key missing" (PR #726).
3. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line (25 route lines): `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`. Navy Yard is fine without it.
4. **GitHub Actions still not running (billing).** Fix in GitHub Settings, Billing & plans. Reviewers run `bash scripts/test.sh` locally.
5. Overrule the calls of passes 63 to 73 in QUESTIONS.md if you disagree.
6. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (#718, planner 18:53, #714) are that. No fix issue. `gh run` needs approval in the planner run. PR #723 and #726 ran `bash scripts/test.sh` green locally (5875 tests).

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (2 new)
- #727 `RELAY_STATE_PATH` so a QA server keeps its own state file; 404 for a missing `/assets/` file; `HEAD` on page paths like `GET`; `server/index.ts` + new test (victor-1).
- #728 README walk-through on a fresh worktree: every command and both demos against `npm start`, README.md only (victor-7).
- Only 2: `business/v2`, `employee/v2`, `sim/v2`, `map/`, App/Landing/shell are held by #719, #720, #724, #725; engine and geo have no MVP III work.

## In review
- PR #726 (#721) production mode: new `tests/api/production-mode.test.ts` only, no server change needed (reviewer-2).

## In progress
- #719 Business demo flow, `business/v2/` `.tsx`/`.ts` (victor-5).
- #720 Employee demo flow, `employee/v2/` `.tsx`/`.ts` (victor-6).
- #724 bare `/business` and `/employee` redirect, one "Real NYC locations" line, keyboard pass of `/` (victor-10).
- #725 simulator keyboard/screen-reader pass, `journey.css` fallbacks, no-key bold (victor-2).

## Merged since pass 71 (18:44)
- PR #723 (#718) simulator QA at 1440/390: header gap, package names no longer cut, journey times in Plex Mono, current step scrolls into view. No console errors.
- PR #722 (#714) `/`, Business, Employee CSS QA: 11 fixes. No overflow at 390 px.
- Earlier MVP III: #717, #716, #715, #713, #710, #709, #708, #707, #706, #698, #697, #696, #695, #694, #693, #689, #680, #682, #679, #681, #687, #688.

## Next up (each needs the issues in brackets merged first)
- Business markup from PR #722: price in the notification sentence and New delivery hints in mono spans [#719].
- No-key map card says "restart `npm run dev`", wrong in production mode (`map/GoogleBaseMap.tsx`) [#725].
- README: `RELAY_STATE_PATH` sentence and the bare-path redirect [#727, #724, #728].
- Faults #719, #720, #724, #725, #728 list under "Needs other files" / "Needs code".
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
- Employee job marks "Collect the package (done)" when the commute leaves (needs a per-stop field in `shared/v2/api.ts`, QUESTIONS pass 61).
- Business notification price and New delivery hints are Inter, not Plex Mono (after #719).
- A server started from a worktree writes `data/state-v2.json` and turns `tests/api/v2-e2e-nyc-*` red while it runs (#727).
