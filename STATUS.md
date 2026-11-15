# STATUS (maintained by the planner)

_Last update: 2026-11-14, 20:27 (Sat), planner pass 84 (started 20:25)_

## Current milestone: MVP IV (docs/mvp4.md): F2 moving employees by 9:30 p.m.; F1 Gemini requests and F3 Relay vs traditional study by 10:30 p.m.
MVP III is done (P1 to P4 merged through PR #769). MVP III rules still hold (business-only stops, one relay point, the 30-second demo). Code freeze 5 a.m. unchanged.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key, and F2 (big lettered carriers, package badge, whole commutes) is on main. Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1 needs `GEMINI_API_KEY`** (and optionally `GEMINI_MODEL`) in `.env` for "Parsed by Gemini" once #785 merges; without it the offline parser answers. Agents never see it.
3. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
4. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726).
5. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
6. Contract calls to check (QUESTIONS.md passes 80–84): `departed?` on EmployeeJobView (#791, new); network Play steps with seeks instead of the server clock (#790, new); `trips?` on SimulatorResponse (#761), `shared/v2/parseRequest.ts` (#764), `stopsDone?` (#781), `study` in package.json (#766); the F1 sender is always the signed-in business; study page committed as generated HTML (#787).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs (#784, #780, the 20:20 planner commit) are that. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (2 new)
- F2 #790 (victor-2): Play with no package picked steps through the carriers' commute windows with seeks, so every carrier is seen moving (the `it.fails` from PR #789).
- #791 (victor-6): the Employee job's "Leave work / Leave home" row is done when the commute leaves (`departed?` from the server).

## In progress / in review
- F1 #785 (victor-1): parse-request asks Gemini first, offline fallback on no key / error / 6 s.
- F1 #786 (victor-5): New delivery = one big text box → prefilled form as the confirmation card.
- F3 #787 (victor-4): `npm run study` also writes `client/public/study.html` (committed).

## Merged since pass 83 (20:17)
- PR #789 (#780) F2: real-run check of network Play and journeys; "Journey complete" only once playback ends. Found the network Play pace gap (now #790).
- PR #788 (#784) New Relay logo: tab icons, header and homepage hero.
- PR #783 (#781) Employee job stops marked done from the server's `stopsDone`.

## Next up (each needs the issues in brackets merged first)
- F3: "The numbers" link on `/` (Landing.tsx, victor-5) [#787].
- F1: headless-Chrome check of the text box → card → Send flow, offline and with a faked Gemini answer [#785, #786].
- README: `.env` Gemini lines, `npm run study` and the study page, the text box, network Play pace [#785, #786, #787, #790].
- Plan/job list order after a live request (`it.fails` in `tests/api/v2-nyc-consistency-readers.test.ts`, `server/api/v2/pipeline.ts`) [#791, same test file].
- Arrows/legend glyphs outside the Latin subsets: low priority.

## Known bugs / gaps
- Network Play: most carriers are seen in at most one poll, so they never visibly move (#790).
- Employee job start row "(done)" only once the pickup is handled (#791).
- After a live request, `plans`/`jobs` are listed out of creation order (no page shows it; the package list sorts itself).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note).
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
