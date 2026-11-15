# STATUS (maintained by the planner)

_Last update: 2026-11-14, 22:22 (Sat), planner pass 99_

## Current milestone: MVP IV (docs/mvp4.md), finishing. Feature freeze: fixes, polish and tests only. Code freeze 5 a.m.
All three MVP IV tracks are on main (F2 moving carriers + network Play, F1 text box → Gemini or offline, F3 `npm run study` + `/study.html` + "See the numbers", 3,024 runs, PR #848). Human polish batch: #851 (PR #855), #852 (PR #859), #854 (PR #856) merged; #853 (homepage) left. README sync #850 merged (PR #858). Left: #847 (full demo walk, PR #857 in fix round), then fixes for what it lists and one README follow-up for the batch.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key, and the new dark Play pill (PR #859) was checked only over stand-in backgrounds. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Calls in QUESTIONS pass 98–99:** relay carrier A vanishes at home (not at the relay point); header keeps "Demo account"; disabled-button reason is now a tooltip, refused step a chip above the pill. SPEC.md line 67 and docs/ still describe the removed header line.
3. **Homepage animation in Safari** (and the presenter's browser): the package uses CSS `offset-path`; without support it rests at the recipient.
4. **F1: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, then run `npx tsx scripts/gemini-check.ts "<sentence>"` (PR #805). Exit 0 / `source: gemini` = OK; `HTTP 400` = refused request or bad key; `HTTP 404` = set `GEMINI_MODEL`.
5. **F1 demo sentence** (Business page of Brooklyn Roasting, works without a key): `Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.` → Relay via Etsy, $10.00, Elena Rossi then Reese Green, listed as "Envelope".
6. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
7. **Demo machine:** `npm run build` in the checkout that has `.env` (browser key read at build time, PR #726).
8. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.

## Main health
- CI red = billing (DECISIONS pass 61): runs of #850, #852 and the 22:15 planner commit. Reviews of PR #857/#859 say the check failed in 1–2 s; local `scripts/test.sh` passes (PR #859: 401 files, 7071 tests). No fix issue.

## Stuck
- Nothing labeled `stuck`.
- PR #857 (#847) is `needs-fix`: the test is fine, but the PR body has no walk table. Planner comment on #847 (pass 99): walk current main and list faults by module.

## Queued this pass: 0 (DECISIONS pass 99)
- Demo-walk fixes wait for #847's table; the README follow-up waits for #853.

## In progress / ready
- #853 (victor-8, human): homepage hero centered, logo as the R of "Relay". `Landing.tsx`, `landing.css`, homepage tests.
- #847 (victor-7): full demo walk; PR #857 fix round; holds `tests/ui/demo-walk-mvp4*` only.

## Merged since pass 98 (22:14)
- PR #859 (#852): Play / Back to start are a dark translucent pill floating on the map, white icons, 44 px buttons; the step line under them is gone (still announced to screen readers).
- PR #858 (#850): README synced with the MVP IV UI batch (Play bar at the bottom center, #832's panel wording, homepage, 3,024-run study).

## Earlier MVP IV merges
- Pass 94–98: PR #856 header text, #855 journey shows only handling carriers, #849 status chips, #848 3,024-run study, #845 Delivered step scroll, #844 landing counts, #840 homepage dark SVG hero.
- F1: PR #793, #795, #804, #805, #817, #818, #825, #834. F2: PR #789, #801, #783, #794, #830, #835, #837, #839. F3: PR #792, #802, #803, #819.
- Other: PR #809 README Gemini + study, #813 plan/job order, #814 production test, #822/#826 test port clash, #828 README MVP IV demos, #829 homepage check, #838 panel text.

## Next up (each needs the issues in brackets merged first)
- Fixes for whatever #847's walk lists, each to its owning module [#847].
- One README follow-up for the polish batch: pill Play bar, README line 82/100 "under the buttons" text that no longer exists, journey shows only handling carriers, header, homepage hero [#853]; after #847 so walk-driven README lines go in the same issue if both are ready.

## Known bugs / gaps
- README lines 82 and 100 still describe the step line under the Play buttons, removed by PR #859 (README follow-up).
- Real Gemini API never tested (needs a human with a key, to-do 4).
- Homepage package animation checked in headless Chrome only (to-do 3).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); low priority, not queued in the freeze.
- `PORT` does not work with `npm run dev` (README says `npm start` only).
- `npm run study` needs tsx (devDependency); run it from a dev checkout.
