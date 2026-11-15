# STATUS (maintained by the planner)

_Last update: 2026-11-14, 20:52 (Sat), planner pass 86 (started 20:41)_

## Current milestone: MVP IV (docs/mvp4.md): F2 by 9:30 p.m.; F1 and F3 by 10:30 p.m. Then fixes and polish only.
All three tracks are on main: F2 (moving carriers in journeys and network Play), F1 (text box → Gemini or offline → card), F3 (`npm run study` + `/study.html` + "The numbers" link). Left: checks, README rewrite, small fixes. MVP III rules still hold. Code freeze 5 a.m.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key, and all of F2 is on main (network Play now steps through commutes, PR #801). Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, then run `npx tsx scripts/gemini-check.ts "<sentence>"` (PR #805). Exit 0 / `source: gemini` = OK; `HTTP 400` = refused request or bad key; `HTTP 404` = set `GEMINI_MODEL` to a model the key can use.
3. **F1 demo sentence** (Business page of Brooklyn Roasting, works without a key, PR #804): `Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.` → Relay via Etsy, $10.00. It is listed as "Envelope".
4. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
5. **Demo machine:** `npm run build` in the checkout that has `.env` (browser key read at build time, PR #726).
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. Contract calls to check (QUESTIONS.md passes 80–86): `departed?`, `stopsDone?`, `trips?`; network Play steps with seeks; thinking off for 2.5 Flash; F1 sender always the signed-in business; study page committed as generated HTML; parse-request log line (#811).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs (#790, #796, #799) are that. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (6 new)
- #806 (victor-1): plans/jobs back in creation order after a live request (`pipeline.ts`, the `it.fails` becomes `it`).
- F1 #807 (victor-5): headless-Chrome check of the text box with 8 sentences, 1440/390 px; page fixes in `business/v2/`, parser faults listed.
- F3 #808 (victor-4): headless-Chrome check of `/study.html` at 1440/390 px, no requests; fixes in `scripts/study/page.ts`.
- #810 (victor-8): production test: `npm start` serves `/study.html`, parse-request offline with no key.
- F1 #811 (victor-3): one server log line per parse-request (Gemini, or offline and why), never key or sentence.
- F1 #812 (victor-6): real-page test: demo sentence → match → both carriers' Employee pages.

## In progress / in review
- #800 (victor-7), PR #809 in review: README Gemini setup + study.

## Merged since pass 85 (20:40)
- PR #805 (#797) F1: thinking off for Gemini 2.5 Flash; `scripts/gemini-check.ts` (never run against the real API).
- PR #804 (#798) F1: the README demo package as one sentence parses offline and matches like the form demo; rule-parser fixes.
- PR #803 (#799) F3: `npm run study -- --check`; tests fail when the committed page is stale.
- PR #802 (#796) F3: "The numbers" link on `/`.
- PR #801 (#790) F2: network Play steps through every carrier's commute with seeks.
- PR #795 (#786) F1: New delivery = one big text box → prefilled form as the card (README step 2 now says "Fill in the form instead").
- PR #794 (#791): Employee "Leave work / Leave home" ticked from `departed`.

## Next up (each needs the issues in brackets merged first)
- README demo rewrite: type the #804 sentence (name "Envelope"), network Play pace, "The numbers", gemini-check, log line [#809, #811].
- Offline parser faults found by #807, and Employee faults found by #812 [#807, #812].

## Known bugs / gaps
- Real Gemini API never tested (needs a human with a key, item 2).
- After a live request, `plans`/`jobs` are listed out of creation order (no page shows it; #806).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); low priority.
- Arrows/legend glyphs outside the Latin subsets: low priority.
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
