# STATUS (maintained by the planner)

_Last update: 2026-11-14, 20:53 (Sat), planner pass 87 (started 20:49)_

## Current milestone: MVP IV (docs/mvp4.md): F2 by 9:30 p.m.; F1 and F3 by 10:30 p.m. Then fixes and polish only.
All three tracks are on main: F2 (moving carriers in journeys and network Play), F1 (text box → Gemini or offline → card), F3 (`npm run study` + `/study.html` + "The numbers" link). Left: browser checks, README demo rewrite, small fixes. MVP III rules still hold. Code freeze 5 a.m.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key, and all of F2 is on main (network Play steps through commutes, PR #801). Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, then run `npx tsx scripts/gemini-check.ts "<sentence>"` (PR #805). Exit 0 / `source: gemini` = OK; `HTTP 400` = refused request or bad key; `HTTP 404` = set `GEMINI_MODEL` to a model the key can use. README now has the setup (PR #809).
3. **F1 demo sentence** (Business page of Brooklyn Roasting, works without a key, PR #804): `Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.` → Relay via Etsy, $10.00. It is listed as "Envelope".
4. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
5. **Demo machine:** `npm run build` in the checkout that has `.env` (browser key read at build time, PR #726).
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. Contract calls to check (QUESTIONS.md passes 80–87): `departed?`, `stopsDone?`, `trips?`; network Play steps with seeks; thinking off for 2.5 Flash; F1 sender always the signed-in business; study page committed as generated HTML; parse-request log line (#811).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs (#810, #806, the 20:44 planner commit) are that. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (2 new)
- #815 (victor-7): README demos rewritten for MVP IV (typed sentence, network Play as observed, "The numbers", gemini-check). README only.
- F2 #816 (victor-2): headless-Chrome check of `/simulator` after PR #801 (network Play, Watch a package, relay journey, reduced motion) at 1440/390 px; fixes in `sim/v2/`.

## In progress
- F1 #807 (victor-5): text box with 8 sentences in headless Chrome; fixes in `business/v2/`.
- F3 #808 (victor-4): `/study.html` in headless Chrome; fixes in `scripts/study/page.ts`.
- F1 #811 (victor-3): one log line per parse-request.
- F1 #812 (victor-6): real-page test, demo sentence → both carriers' Employee pages.

## Merged since pass 86 (20:44)
- PR #814 (#810): production test: `npm start` serves `/study.html`, parse-request answers offline with no key.
- PR #813 (#806): plans/jobs back in creation order after a live request (known bug closed).
- PR #809 (#800): README: Gemini setup, offline fallback, `npm run study`, `/study.html`.

## Earlier MVP IV merges (pass 85–86)
- F1: PR #793 Gemini first, #795 text box + card, #804 demo sentence offline, #805 thinking off + `gemini-check.ts`.
- F2: PR #789 real-run test, #801 network Play steps with seeks; Employee PRs #783, #794 (`stopsDone`, `departed`).
- F3: PR #792 study page, #802 "The numbers" link, #803 `--check`.

## Next up (each needs the issues in brackets merged first)
- Offline parser faults found by #807, Employee faults found by #812, simulator faults outside `sim/v2/` found by #816 [#807, #812, #816].
- README line for the parse-request log, if #811's final text differs from what PR #809 wrote [#811, #815].

## Known bugs / gaps
- Real Gemini API never tested (needs a human with a key, item 2).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); low priority.
- Arrows/legend glyphs outside the Latin subsets: low priority.
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
