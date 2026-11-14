# STATUS (maintained by the planner)

_Last update: 2026-11-14, 18:50 (Sat), planner pass 71 (started 18:44)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1, P2 and P3 are all merged. P4 is down to browser QA: `/`, `/business`, `/employee` CSS (#714), the simulator (#718), the Business flow (#719), the Employee flow (#720) and production mode (#721).**

## HUMAN TO-DO
1. **Open `/simulator` with the browser key now**, or press **Watch a package** on `/`. All of MVP III P1 is on main. Nobody has seen the map yet. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line (25 route lines): `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`. Navy Yard is fine without it.
3. **GitHub Actions still not running (billing).** Fix in GitHub Settings, Billing & plans. Reviewers run `bash scripts/test.sh` locally.
4. Overrule the calls of passes 63 to 71 in QUESTIONS.md if you disagree.
5. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (planner 18:39, #712, #711) are that. No fix issue. This pass could not read the run logs or run the suite (needs approval); reviewers ran it locally for each merge.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (2 new)
- #720 Employee demo flow (commute edit, job, Watch in simulator) in headless Chrome at 1440/390 px; behaviour fixes in `employee/v2/` `.tsx`/`.ts` only (victor-6). Unblocked by PR #717.
- #721 production mode (`npm run build && npm start`): load and reload every page and deep link, fonts and assets, JSON 404 for unknown `/api`; fixes in `server/index.ts`, `server/api/`, `tests/api/` (victor-1).
- Only 2: the rest of the client is in #714, #718, #719, #720; engine and geo have no MVP III work.

## In progress
- #714 browser QA of `/`, `/business`, `/employee`, CSS only (victor-10).
- #718 simulator + Navy Yard journey in headless Chrome, fixes in `sim/v2/` and `map/` (victor-2).
- #719 Business demo flow in headless Chrome, `business/v2/` `.tsx`/`.ts` (victor-5).

## Merged since pass 70 (18:37)
- PR #717 (#712) Employee page keeps its loading view until the business list arrives (no "Unknown place" flash).
- Pass 70 and earlier MVP III: #716, #715, #713, #710, #709, #708, #707, #706, #698, #697, #696, #695, #694, #693, #689, #680, #682, #679, #681, #687, #688.

## Next up (each needs the issues in brackets merged first)
- Faults that #714, #718, #719 and #720 list under "Needs markup" / "Needs CSS" / "Needs other files" [those issues].
- Landing/shell `.tsx` behaviour or keyboard pass on `/` [#714].
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
- Employee job marks "Collect the package (done)" when the commute leaves (needs a per-stop field in `shared/v2/api.ts`, QUESTIONS pass 61).
