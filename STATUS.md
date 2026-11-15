# STATUS (maintained by the planner)

_Last update: 2026-11-14, 21:32 (Sat), planner pass 91 (started 21:26)_

## Current milestone: MVP IV (docs/mvp4.md), finishing. Last UI batch (#831, #832, #833) by 22:30, then feature freeze: fixes, polish and tests only. Code freeze 5 a.m.
All three MVP IV tracks are on main (F2 moving carriers + network Play, F1 text box → Gemini or offline, F3 `npm run study` + `/study.html` + "The numbers"). Left: the human UI batch, the simulator browser check (PR #830), the README demo rewrite (PR #828), the Employee "Arrive home" tick fix (#836).

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, then run `npx tsx scripts/gemini-check.ts "<sentence>"` (PR #805). Exit 0 / `source: gemini` = OK; `HTTP 400` = refused request or bad key; `HTTP 404` = set `GEMINI_MODEL`. `npm start` prints one `[parse-request]` line per sentence (PR #817).
3. **F1 demo sentence** (Business page of Brooklyn Roasting, works without a key, PR #804): `Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.` → Relay via Etsy, $10.00, Elena Rossi then Reese Green, listed as "Envelope".
4. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
5. **Demo machine:** `npm run build` in the checkout that has `.env` (browser key read at build time, PR #726).
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. Contract calls to check (QUESTIONS.md passes 80–90).

## Main health
- CI red = billing (DECISIONS pass 61): runs of #827, #823 and the 21:21 planner commit (the PR #830/#828 reviews confirm the job never starts). No fix issue.

## Stuck
- Nothing labeled `stuck`. Watch PR #830: reviewed twice on the same commit a9d50b4 with no new push; label `stuck` if a third review finds it unchanged.

## Queued this pass (1 new)
- #836 (victor-6) Employee end row ("Arrive home") ticked from a new optional `EmployeeJobView.arrived`, not from the job status (PR #835 fault). Files: `shared/v2/api.ts`, `server/api/v2/views.ts`, `employee/v2/jobDetailV2Model.ts`, `tests/ui/employee-v2-real-ticks.test.tsx`.
- Human batch (do not duplicate): #831 (victor-10) Play/Pause bottom center; #832 (victor-3) simpler panel text; #833 (victor-8) homepage dark SVG hero.
- **Overlap risk:** #831, #832 and PR #830 all edit `client/src/components/sim/v2/` (#831 and PR #830 likely both `controls/controls.css`). Reviewers: merge PR #830 first, expect rebases.

## In progress / in review
- PR #830 (#816, victor-2) simulator in headless Chrome: needs-fix (guard test for `controls.css:65`, report table in PR body). CSS fix itself is fine.
- PR #828 (#815, victor-7) README demos: needs-fix: `tests/api/readme.test.ts` (lines 160, 212) and `v2-readme-demo.test.ts` PAGE_WORDS still expect the old text.
- #831, #832, #833 (human UI batch), in progress.

## Merged since pass 90 (21:19)
- PR #834 (#827): offline parser reads the package name/contents from a sentence with no package word ("Espresso blend samples"); label cut at 60 chars like the Gemini path.
- PR #835 (#823): Employee pages of Elena Rossi / Reese Green in headless Chrome as the demo plays: no page fault; ticks equal `departed`/`stopsDone` at both widths. Found the "Arrive home" fault → #836.

## Earlier MVP IV merges (passes 85–90)
- F1: PR #793, #795, #804, #805, #817, #818, #825. F2: PR #789, #801, #783, #794. F3: PR #792, #802, #803, #819.
- Other: PR #809 README Gemini + study, #813 plan/job order, #814 production test, #822/#826 test port clash, #829 homepage check.

## Next up (each needs the issues in brackets merged first)
- README sync with the new homepage and panel wording ("See the numbers", any quoted panel sentence) [#828, #832, #833].
- Full MVP IV demo walk in production mode after the UI batch (sentence → match → Watch a package → network Play → See the numbers) [#828, #830, #831, #832, #833, #836].
- Simulator faults outside `sim/v2/` found by #816 [#830].

## Known bugs / gaps
- Employee "Arrive home" ticked ~23 sim-min early on evening legs (Elena Rossi, demo delivery), fix queued #836.
- Real Gemini API never tested (needs a human with a key, item 2).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); low priority.
- `PORT` does not work with `npm run dev` (README says `npm start` only).
