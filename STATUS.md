# STATUS (maintained by the planner)

_Last update: 2026-11-14, 18:58 (Sat), planner pass 72 (started 18:51)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1, P2 and P3 are merged. P4 browser QA: `/`, `/business`, `/employee` CSS (PR #722) and the simulator (PR #723) are merged; the Business flow (#719), Employee flow (#720) and production mode (#721) are in progress; two follow-ups queued (#724, #725).**

## HUMAN TO-DO
1. **Open `/simulator` with the browser key now**, or press **Watch a package** on `/`. All of MVP III P1 is on main. Agents checked it without a key; nobody has seen the map. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line (25 route lines): `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`. Navy Yard is fine without it.
3. **GitHub Actions still not running (billing).** Fix in GitHub Settings, Billing & plans. Reviewers run `bash scripts/test.sh` locally.
4. Overrule the calls of passes 63 to 72 in QUESTIONS.md if you disagree.
5. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (#714, planner 18:46, planner 18:39) are that. No fix issue. This pass could not read the run logs (`gh run` needs approval). PR #722 and #723 ran `bash scripts/test.sh` green locally.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (2 new)
- #724 `/business` and `/employee` with no id redirect to the header's account; "Real NYC locations" shown once on `/`; keyboard pass of `/` and the header (victor-10). From PR #722 "Needs markup".
- #725 keyboard and screen-reader pass of `/simulator` and the Navy Yard journey; last MVP II fallbacks in `journey.css`; no-key panel bold (victor-2). From PR #722/#723 notes.
- Only 2: `business/v2` and `employee/v2` are held by #719/#720, the server by #721; engine and geo have no MVP III work.

## In progress
- #719 Business demo flow in headless Chrome, `business/v2/` `.tsx`/`.ts` (victor-5).
- #720 Employee demo flow in headless Chrome, `employee/v2/` `.tsx`/`.ts` (victor-6).
- #721 production mode (`npm run build && npm start`), `server/index.ts` (victor-1).

## Merged since pass 71 (18:44)
- PR #723 (#718) simulator QA at 1440/390: header gap, package names no longer cut, journey times in Plex Mono, inspector leg times on one line, current step scrolls into view. No console errors.
- PR #722 (#714) `/`, Business, Employee CSS QA: 11 fixes (synthetic bold, cut-off borders, broken times, Watch button size). No overflow at 390 px.
- Earlier MVP III: #717, #716, #715, #713, #710, #709, #708, #707, #706, #698, #697, #696, #695, #694, #693, #689, #680, #682, #679, #681, #687, #688.

## Next up (each needs the issues in brackets merged first)
- Business markup from PR #722: price in the notification sentence and the New delivery hints (window, "Up to 2 kg") in their own mono spans [#719].
- Faults #719, #720, #721, #724, #725 list under "Needs other files".
- README walk-through (every command runs as written) [#721].
- QA servers write `data/state-v2.json` and turn the `tests/api/v2-e2e-nyc-*` "data/ untouched" checks red while they run: let a QA server use a temp data dir [#721, server/index.ts].
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
- Employee job marks "Collect the package (done)" when the commute leaves (needs a per-stop field in `shared/v2/api.ts`, QUESTIONS pass 61).
- Business notification price and New delivery hints are Inter, not Plex Mono (after #719).
