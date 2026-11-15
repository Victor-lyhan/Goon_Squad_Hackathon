# STATUS (maintained by the planner)

_Last update: 2026-11-14, 21:50 (Sat), planner pass 94 (started 21:46)_

## Current milestone: MVP IV (docs/mvp4.md), finishing. Feature freeze: fixes, polish and tests only (plus the human's #841). Code freeze 5 a.m.
All three MVP IV tracks are on main (F2 moving carriers + network Play, F1 text box → Gemini or offline, F3 `npm run study` + `/study.html` + "See the numbers"). The human UI batch is all merged (#831 PR #837, #832 PR #838, #833 PR #840). Left: #841 (3,024-run study), #842 (simulator polish), #843 (homepage cleanup), then one README sync and the full demo walk.

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
- CI red = billing (DECISIONS pass 61): runs of #833, #836 and the 21:41 planner commit. PR #840's local run: 397 test files, 7000 tests pass. No fix issue.

## Stuck
- Nothing labeled `stuck`. No open PRs.

## Queued this pass: 1 (DECISIONS pass 94)
- #843 (victor-5): drop the unused business/commuter/matched counts from `landingModel.ts` (PR #840 review note); no visual change.

## In progress / in review
- #841 (victor-4, human request): 3,024 simulations on worker threads, CLI summary, study page with spreads and runs.csv. Holds `scripts/study/`, `client/public/study*`.
- #842 (victor-2): Delivered step in view at journey end; Play bar step line capped at two lines. Holds `sim/v2/journey/`, `sim/v2/controls|compose` CSS.
- #843 (victor-5): `landingModel.ts` and the homepage tests.

## Merged since pass 93 (21:45)
- PR #840 (#833): homepage dark SVG NYC hero with a looping relay (CSS `offset-path`; rests at the recipient without it or under reduced motion), How it works, "See the numbers" → `/study.html`; stats line and header text on `/` removed.

## Earlier MVP IV merges (passes 85–93)
- F1: PR #793, #795, #804, #805, #817, #818, #825, #834. F2: PR #789, #801, #783, #794, #830, #835, #837, #839. F3: PR #792, #802, #803, #819.
- Other: PR #809 README Gemini + study, #813 plan/job order, #814 production test, #822/#826 test port clash, #828 README MVP IV demos, #829 homepage check, #838 panel text.

## Next up (each needs the issues in brackets merged first)
- One README sync: new homepage, "See the numbers", the Play bar's place, #832's panel wording, the study's 3,024 runs / `--workers` / CSV [#841].
- Full MVP IV demo walk in production mode, headless Chrome 1440 px (sentence → match → Watch a package → network Play → See the numbers; Elena's "Arrive home" at 6:22 PM) [#841, #842, #843].

## Known bugs / gaps
- Real Gemini API never tested (needs a human with a key, item 3).
- Homepage package animation checked in headless Chrome only (item 2).
- Play button still moves a line during a journey in a 900 px window (#842 fixes).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); low priority.
- `PORT` does not work with `npm run dev` (README says `npm start` only).
