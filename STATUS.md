# STATUS (maintained by the planner)

_Last update: 2026-11-14, 22:03 (Sat), planner pass 96 (started 22:01)_

## Current milestone: MVP IV (docs/mvp4.md), finishing. Feature freeze: fixes, polish and tests only. Code freeze 5 a.m.
All three MVP IV tracks are on main (F2 moving carriers + network Play, F1 text box → Gemini or offline, F3 `npm run study` + `/study.html` + "See the numbers", now 3,024 runs, PR #848). The human UI batch and #841 are all merged. Left: #846 / PR #849 (simulator chips at 900 px, in review), #847 (full demo walk), #850 (the one README sync), then fixes for what #847 lists.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Homepage animation in Safari** (and the presenter's browser), PR #840 is merged: the package uses CSS `offset-path`; without support it rests at the recipient.
3. **F1: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, then run `npx tsx scripts/gemini-check.ts "<sentence>"` (PR #805). Exit 0 / `source: gemini` = OK; `HTTP 400` = refused request or bad key; `HTTP 404` = set `GEMINI_MODEL`. `npm start` prints one `[parse-request]` line per sentence (PR #817).
4. **F1 demo sentence** (Business page of Brooklyn Roasting, works without a key, PR #804): `Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.` → Relay via Etsy, $10.00, Elena Rossi then Reese Green, listed as "Envelope".
5. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
6. **Demo machine:** `npm run build` in the checkout that has `.env` (browser key read at build time, PR #726).
7. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
8. Contract calls to check (QUESTIONS.md passes 80–94).

## Main health
- CI red = billing (DECISIONS pass 61): runs of #841, #842 and the 21:55 planner commit. PR #848's local run: 398 test files, 7029 tests pass. No fix issue.

## Stuck
- Nothing labeled `stuck`. PR #849 (#846) waits for reviewer-2.

## Queued this pass: 1 (DECISIONS pass 96)
- #850 (victor-8): the one README sync: Play bar at the bottom center of the map, #832's panel wording, homepage and study sections checked against PR #840/#848, walked on `npm start`. `README.md` + `tests/api/readme-mvp4.test.ts`.

## In progress / in review
- #846 / PR #849 (victor-2): holds `sim/v2/packages/`, `PackageList.tsx`, `SimWorkspace.css`.
- #847 (victor-7): holds the new `tests/ui/demo-walk-mvp4*` only.
- #850 (victor-8): holds `README.md`, `tests/api/readme*`.

## Merged since pass 95 (21:55)
- PR #848 (#841, human request): 3,024 simulations on worker threads (`--workers N`, byte-identical for any count), CLI summary, `/study.html` with spreads, by-employee and by-detour tables, `client/public/study/runs.csv` (411 KB). Headline: cost 37.5% less, miles/CO2 77.0% less, match rate 58.2%. Browser-checked at 1440–360 px; README "The numbers" already updated.

## Merged during pass 94–95 (21:50)
- PR #845 (#842): Delivered step scrolls into view at the journey's end; Play bar step line capped at two lines, so Play/Pause no longer jumps at 900 px.
- PR #844 (#843): `landingModel.ts` drops the unused counts; no visual change.
- PR #840 (#833): homepage dark SVG NYC hero with a looping relay (CSS `offset-path`; rests at the recipient without it or under reduced motion), How it works, "See the numbers" → `/study.html`.

## Earlier MVP IV merges (passes 85–93)
- F1: PR #793, #795, #804, #805, #817, #818, #825, #834. F2: PR #789, #801, #783, #794, #830, #835, #837, #839. F3: PR #792, #802, #803, #819.
- Other: PR #809 README Gemini + study, #813 plan/job order, #814 production test, #822/#826 test port clash, #828 README MVP IV demos, #829 homepage check, #838 panel text.

## Next up (each needs the issues in brackets merged first)
- Fixes for whatever #847's walk lists, each to its owning module [#847]; README lines they change go after #850.
- `npm run study` needs tsx (devDependency) for its worker threads (PR #848 note); fine for the demo, no issue.

## Known bugs / gaps
- Real Gemini API never tested (needs a human with a key, item 3).
- Homepage package animation checked in headless Chrome only (item 2).
- Left panel status chips run past the panel edge at 900 px (#846 / PR #849 fixes).
- README does not yet say where the Play bar sits or quote #832's panel wording (#850 fixes).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); low priority.
- `PORT` does not work with `npm run dev` (README says `npm start` only).
