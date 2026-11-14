# STATUS (maintained by the planner)

_Last update: 2026-11-14, 18:50 (Sat), planner pass 70 (started 18:37)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1, P2 and P3 are all merged. P4 is down to the browser QA passes: `/`, `/business`, `/employee` (#714), the simulator (#718) and the Business demo flow (#719).**

## HUMAN TO-DO
1. **Open `/simulator` with the browser key now**, or press **Watch a package** on `/`. All of MVP III P1 is on main, legend included (PR #708). Nobody has seen the map yet. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line (25 route lines): `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`. Navy Yard is fine without it.
3. **GitHub Actions still not running (billing).** Fix in GitHub Settings, Billing & plans. Reviewers run `bash scripts/test.sh` locally.
4. Overrule the calls of passes 63 to 70 in QUESTIONS.md if you disagree.
5. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (#711, #704, #703) are that. No fix issue. This pass could not run the suite itself (needs approval); reviewers ran it locally for each merge.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (2 new)
- P1+P4 #718 simulator + Navy Yard journey in headless Chrome at 1440/390 px, played to Delivered; fixes in `sim/v2/` and `map/` (victor-2).
- #719 Business demo flow (Find a delivery match, result, details, Watch in simulator) in headless Chrome; behaviour fixes in `business/v2/` `.tsx`/`.ts` only (victor-5).
- Only 2: #714 holds the page CSS and PR #717 `employee/v2/live/`; the Employee flow check waits for #712. Engine and geo have no MVP III work.

## In progress / in review
- #714 browser QA of `/`, `/business`, `/employee`, CSS only (victor-10).
- PR #717 (#712) Employee page keeps its loading view until the business list arrives (victor-6), needs review.

## Merged since pass 69 (18:29)
- PR #716 (#711) MVP 1 engine and last MVP 1 server files deleted. Outside `v2/`, only `server/{index,store,clock}.ts`, `server/domain/pricing.ts`, `server/api/geo.ts`, `server/geo/` remain on the server.
- PR #715 (#704) UI test of the 30-second demo path (Watch a package to Delivered).
- PR #713 (#703) button reads "Find a delivery match"; README is MVP III.
- PR #710 (#701) simulator restyle. PR #709 (#705) error fallback resets on query change. PR #708 (#699) journey legend symbols, last old map colours.
- Earlier MVP III: #707, #706, #698, #697, #696, #695, #694, #693, #689, #680, #682, #679, #681, #687, #688.

## Next up (each needs the issues in brackets merged first)
- Employee demo flow in headless Chrome (commute edit, job, Watch in simulator), behaviour fixes in `employee/v2/` [#712, #714].
- Faults that #714, #718 and #719 list under "Needs markup" / "Needs CSS" / "Needs other files" [those issues].
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
- Employee job marks "Collect the package (done)" when the commute leaves (needs a per-stop field in `shared/v2/api.ts`, QUESTIONS pass 61).
