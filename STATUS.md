# STATUS (maintained by the planner)

_Last update: 2026-11-14, 20:58 (Sat), planner pass 88 (started 20:56)_

## Current milestone: MVP IV (docs/mvp4.md): F2 by 9:30 p.m.; F1 and F3 by 10:30 p.m. Then fixes and polish only.
All three tracks are on main: F2 (moving carriers in journeys and network Play), F1 (text box → Gemini or offline → card, with a server log line), F3 (`npm run study` + `/study.html` + "The numbers" link). Left: browser checks (#807, #808, #816), README demo rewrite (#815), test stability. MVP III rules still hold. Code freeze 5 a.m.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key, and all of F2 is on main (network Play steps through commutes, PR #801). Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, then run `npx tsx scripts/gemini-check.ts "<sentence>"` (PR #805). Exit 0 / `source: gemini` = OK; `HTTP 400` = refused request or bad key; `HTTP 404` = set `GEMINI_MODEL` to a model the key can use. With `npm start`/`npm run dev` the terminal now prints one `[parse-request]` line per sentence saying who answered (PR #817); "no key" while the key is in `.env` means the server did not read it.
3. **F1 demo sentence** (Business page of Brooklyn Roasting, works without a key, PR #804; real-page test PR #818): `Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.` → Relay via Etsy, $10.00, Elena Rossi then Reese Green. It is listed as "Envelope".
4. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
5. **Demo machine:** `npm run build` in the checkout that has `.env` (browser key read at build time, PR #726).
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. Contract calls to check (QUESTIONS.md passes 80–88): `departed?`, `stopsDone?`, `trips?`; network Play steps with seeks; thinking off for 2.5 Flash; F1 sender always the signed-in business; study page committed as generated HTML; parse-request log line kept in the `[parse-request]` format (PR #817).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs (#812, #811, the 20:51 planner commit) are that. No fix issue.
- Local runs sometimes red from a port clash with another program on 127.0.0.1 (PR #818 note); #820 and #821 fix the tests.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (2 new)
- #820 (victor-1): `tests/api/` test servers bind 127.0.0.1 or check `/api/health` first; dummy-server test.
- #821 (victor-8): same for `tests/ui/` helpers and `tests/geo/geocode-route.test.ts`.

## In progress
- F1 #807 (victor-5): text box with 8 sentences in headless Chrome; fixes in `business/v2/`.
- F3 #808 (victor-4): `/study.html` in headless Chrome; PR #819 in review.
- #815 (victor-7): README demos rewritten for MVP IV.
- F2 #816 (victor-2): `/simulator` in headless Chrome after network Play became seeks.

## Merged since pass 87 (20:51)
- PR #818 (#812): real-page test, typed demo sentence → Elena Rossi and Reese Green Employee pages. Found no fault.
- PR #817 (#811): one `[parse-request]` line per sentence (Gemini / no key added; fallback lines were already there). README updated in the same PR.

## Earlier MVP IV merges (passes 85–87)
- F1: PR #793 Gemini first, #795 text box + card, #804 demo sentence offline, #805 thinking off + `gemini-check.ts`.
- F2: PR #789 real-run test, #801 network Play steps with seeks; Employee PRs #783, #794 (`stopsDone`, `departed`).
- F3: PR #792 study page, #802 "The numbers" link, #803 `--check`.
- Other: PR #809 README Gemini + study, #813 plans/jobs in creation order, #814 production test of `/study.html` + offline parse-request.

## Next up (each needs the issues in brackets merged first)
- Offline parser faults found by #807 (`server/ai/ruleParser.ts`), simulator faults outside `sim/v2/` found by #816 [#807, #816].

## Known bugs / gaps
- Real Gemini API never tested (needs a human with a key, item 2).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); low priority.
- Arrows/legend glyphs outside the Latin subsets: low priority.
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
