# STATUS (maintained by the planner)

_Last update: 2026-11-14, 21:36 (Sat), planner pass 92 (started 21:32)_

## Current milestone: MVP IV (docs/mvp4.md), finishing. Last UI batch: #831 merged; #832, #833 due by 22:30. Then feature freeze: fixes, polish and tests only. Code freeze 5 a.m.
All three MVP IV tracks are on main (F2 moving carriers + network Play, F1 text box → Gemini or offline, F3 `npm run study` + `/study.html` + "The numbers"). README demos rewritten (PR #828). Left: #832, #833 (human UI batch), the simulator browser check (PR #830), the Employee "Arrive home" tick fix (#836).

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, then run `npx tsx scripts/gemini-check.ts "<sentence>"` (PR #805). Exit 0 / `source: gemini` = OK; `HTTP 400` = refused request or bad key; `HTTP 404` = set `GEMINI_MODEL`. `npm start` prints one `[parse-request]` line per sentence (PR #817).
3. **F1 demo sentence** (Business page of Brooklyn Roasting, works without a key, PR #804): `Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.` → Relay via Etsy, $10.00, Elena Rossi then Reese Green, listed as "Envelope".
4. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
5. **Demo machine:** `npm run build` in the checkout that has `.env` (browser key read at build time, PR #726).
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. Contract calls to check (QUESTIONS.md passes 80–92).

## Main health
- CI red = billing (DECISIONS pass 61): runs of #831, #815 and the 21:27 planner commit. No fix issue.

## Stuck
- Nothing labeled `stuck`. **PR #830 (#816, victor-2):** two reviews on a9d50b4, no push since 02:17Z. Its fix keeps the journey step line at two lines so the Packages list stops jumping. **#831 (PR #837) has since moved Play/Pause and the step line into the floating `.spc-playbar` at the bottom center of the map** (`compose/compose.css:82-104`, `bottom: 32px`). So the line now pushes the Play button up, not the list down, and the rule may belong under `.spc-playbar`. Worker: rebase, redo the 1440/390 px journey run on main, then do the two review items (a guard test that fails on main, and the run table via `gh pr edit 830 --body-file`). Reviewers: label it `stuck` if the next review finds a9d50b4 unchanged.

## Queued this pass: none (DECISIONS pass 92)
- Open: #832 (victor-3) simpler panel text; #833 (victor-8) homepage dark SVG hero; #836 (victor-6) Employee "Arrive home" tick from `EmployeeJobView.arrived`.
- **Overlap:** #832 and PR #830 both edit `client/src/components/sim/v2/`. Merge whichever is ready first; the other rebases.

## In progress / in review
- #832, #833 (human UI batch), #836, in progress. PR #830 needs-fix (see Stuck).

## Merged since pass 91 (21:26)
- PR #837 (#831): simulator Play/Pause in a floating bar at the bottom center of the map panel; never wider than the map, two rows at 220 px; new `tests/ui/sim-v2-playbar-css.test.ts`.
- PR #828 (#815): README demos for MVP IV (typed demo sentence, network Play as it now behaves, "The numbers", gemini-check step).

## Earlier MVP IV merges (passes 85–91)
- F1: PR #793, #795, #804, #805, #817, #818, #825, #834. F2: PR #789, #801, #783, #794, #835. F3: PR #792, #802, #803, #819.
- Other: PR #809 README Gemini + study, #813 plan/job order, #814 production test, #822/#826 test port clash, #829 homepage check.

## Next up (each needs the issues in brackets merged first)
- README sync with the new homepage, panel wording and where Play now is ("See the numbers", the floating Play bar, any quoted panel sentence) [#832, #833].
- Full MVP IV demo walk in production mode after the UI batch (sentence → match → Watch a package → network Play → See the numbers) [#830, #832, #833, #836].
- Simulator faults outside `sim/v2/` found by #816 [#830].

## Known bugs / gaps
- Employee "Arrive home" ticked ~23 sim-min early on evening legs (Elena Rossi, demo delivery); fix in progress (#836).
- Real Gemini API never tested (needs a human with a key, item 2).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); low priority.
- `PORT` does not work with `npm run dev` (README says `npm start` only).
