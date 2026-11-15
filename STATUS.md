# STATUS (maintained by the planner)

_Last update: 2026-11-14, 22:14 (Sat), planner pass 98_

## Current milestone: MVP IV (docs/mvp4.md), finishing. Feature freeze: fixes, polish and tests only. Code freeze 5 a.m.
All three MVP IV tracks are on main (F2 moving carriers + network Play, F1 text box → Gemini or offline, F3 `npm run study` + `/study.html` + "See the numbers", 3,024 runs, PR #848). Human polish batch: #851 (PR #855) and #854 (PR #856) merged; #852 and #853 left. Also left: #847 (full demo walk), #850 (README sync), then fixes for what #847 lists and one README follow-up for the batch.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Two calls in QUESTIONS pass 98:** relay carrier A vanishes at home (not at the relay point); header keeps "Demo account". SPEC.md line 67 and docs/ still describe the removed header line.
3. **Homepage animation in Safari** (and the presenter's browser): the package uses CSS `offset-path`; without support it rests at the recipient.
4. **F1: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, then run `npx tsx scripts/gemini-check.ts "<sentence>"` (PR #805). Exit 0 / `source: gemini` = OK; `HTTP 400` = refused request or bad key; `HTTP 404` = set `GEMINI_MODEL`.
5. **F1 demo sentence** (Business page of Brooklyn Roasting, works without a key): `Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.` → Relay via Etsy, $10.00, Elena Rossi then Reese Green, listed as "Envelope".
6. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
7. **Demo machine:** `npm run build` in the checkout that has `.env` (browser key read at build time, PR #726).
8. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.

## Main health
- CI red = billing (DECISIONS pass 61): runs of #851, #854 and the 22:09 planner commit. Local `scripts/test.sh` on PR #855: 402 files, 7081 tests pass. No fix issue.

## Stuck
- Nothing labeled `stuck`. No open PRs.

## Queued this pass: 0 (DECISIONS pass 98)
- Everything left is held by open work (`sim/v2/` #852, homepage #853, README #850) or waits for #847's findings.

## In progress / ready
- #852 (victor-3, human): Play / Back to start as a dark floating pill; step text under them removed. `sim/v2/` Play bar + CSS.
- #853 (victor-8, ready, human): homepage hero centered, logo as the R of "Relay". `Landing.tsx`, `landing.css`.
- #847 (victor-7): full demo walk; holds `tests/ui/demo-walk-mvp4*` only.
- #850 (victor-8): README sync; holds `README.md`, `tests/api/readme*`.

## Merged since pass 97 (22:09)
- PR #855 (#851): a package journey shows a carrier's vehicle only inside the commute that handles the package (shares `legWindows` with Play). 187 stray markers gone on the default run.
- PR #856 (#854): header top-right text removed on every page; Demo account selector kept; dead `ENV_*` code removed.

## Earlier MVP IV merges
- Pass 94–97: PR #849 status chips, #848 3,024-run study, #845 Delivered step scroll, #844 landing counts, #840 homepage dark SVG hero.
- F1: PR #793, #795, #804, #805, #817, #818, #825, #834. F2: PR #789, #801, #783, #794, #830, #835, #837, #839. F3: PR #792, #802, #803, #819.
- Other: PR #809 README Gemini + study, #813 plan/job order, #814 production test, #822/#826 test port clash, #828 README MVP IV demos, #829 homepage check, #838 panel text.

## Next up (each needs the issues in brackets merged first)
- Fixes for whatever #847's walk lists, each to its owning module [#847]; README lines they change go after #850.
- One README follow-up for the polish batch (pill Play bar, journey shows only the handling carriers, header) [#850, #852, #853].

## Known bugs / gaps
- Real Gemini API never tested (needs a human with a key, to-do 4).
- Homepage package animation checked in headless Chrome only (to-do 3).
- README does not yet say where the Play bar sits or quote #832's panel wording (#850 fixes).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); low priority, not queued in the freeze.
- `PORT` does not work with `npm run dev` (README says `npm start` only).
- `npm run study` needs tsx (devDependency); run it from a dev checkout.
