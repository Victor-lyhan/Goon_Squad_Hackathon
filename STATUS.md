# STATUS (maintained by the planner)

_Last update: 2026-11-14, 20:40 (Sat), planner pass 85 (started 20:32)_

## Current milestone: MVP IV (docs/mvp4.md): F2 moving employees by 9:30 p.m.; F1 Gemini requests and F3 Relay vs traditional study by 10:30 p.m.
MVP III is done (P1 to P4 merged through PR #769). MVP III rules still hold (business-only stops, one relay point, the 30-second demo). Code freeze 5 a.m. unchanged.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key, and F2 is on main. Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`; Gemini answers first since PR #793. Once #797 merges, run `npx tsx scripts/gemini-check.ts "<sentence>"`: `source: gemini` = OK; `HTTP 400` = schema needs a fix (never tested against the real API).
3. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
4. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726).
5. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
6. Contract calls to check (QUESTIONS.md passes 80–85): `departed?` on EmployeeJobView (#791); network Play steps with seeks (#790); Gemini 2.5 Flash thinking off (#797); `trips?` on SimulatorResponse, `shared/v2/parseRequest.ts`, `stopsDone?`, `study` in package.json; F1 sender is always the signed-in business; study page committed as generated HTML.

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs (#785, #787, the 20:27 planner commit) are that. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (5 new)
- F3 #796 (victor-5): "The numbers" link on `/` → `/study.html`.
- F1 #797 (victor-3): thinking off for Gemini 2.5 Flash (6 s limit) + `scripts/gemini-check.ts` for the humans.
- F1 #798 (victor-1): the README demo package as one sentence parses offline and matches like the form demo (Relay via Etsy, $10.00); rule-parser fixes.
- F3 #799 (victor-4): `npm run study -- --check` for a stale committed page; headline test (Relay below courier on cost, miles, CO₂).
- #800 (victor-7): README sections for Gemini setup and the study.

## In progress / in review
- F2 #790 (victor-2): network Play steps through the carriers' commutes with seeks.
- F1 #786 (victor-5): New delivery = one big text box → prefilled form as the confirmation card.
- #791 (victor-6), PR #794 in review: Employee "Leave work / Leave home" done from `departed?`.

## Merged since pass 84 (20:27)
- PR #793 (#785) F1: parse-request asks Gemini first (Zod-checked), offline fallback on no key / error / 6 s; never 5xx.
- PR #792 (#787) F3: `npm run study` writes the committed `client/public/study.html` (cost −37.4%, miles and CO₂ −74.8%, 100% on time by construction, match 53.4%, 81 runs).

## Next up (each needs the issues in brackets merged first)
- F1: headless-Chrome check of the text box → card → Send flow, offline and with a faked Gemini answer [#786].
- README: the text box demo steps with the #798 sentence, network Play pace, "The numbers" link, gemini-check [#786, #790, #796, #797, #798, #800].
- Help page: the text box and "The numbers" [#786, #796].
- Plan/job list order after a live request (`it.fails` in `tests/api/v2-nyc-consistency-readers.test.ts`, `server/api/v2/pipeline.ts`) [#791].
- Arrows/legend glyphs outside the Latin subsets: low priority.

## Known bugs / gaps
- Network Play: most carriers are seen in at most one poll, so they never visibly move (#790).
- Gemini answers may exceed 6 s with thinking on (#797); real API never tested.
- After a live request, `plans`/`jobs` are listed out of creation order (no page shows it).
- Committed study page can go stale after a cache/engine change (#799).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note).
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
