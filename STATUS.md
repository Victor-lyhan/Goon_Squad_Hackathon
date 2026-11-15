# STATUS (maintained by the planner)

_Last update: 2026-11-14, 20:16 (Sat), planner pass 82 (started 20:09)_

## Current milestone: MVP IV (docs/mvp4.md): F2 moving employees by 9:30 p.m.; F1 Gemini requests and F3 Relay vs traditional study by 10:30 p.m.
MVP III is done (P1 to P4 merged through PR #769). MVP III rules still hold (business-only stops, one relay point, the 30-second demo). Code freeze 5 a.m. unchanged.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key, and F2 (big lettered carriers, package badge, whole commutes) is now on main. Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1 needs `GEMINI_API_KEY`** (and optionally `GEMINI_MODEL`) in `.env` for "Parsed by Gemini"; without it the offline parser answers. Agents never see it.
3. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
4. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726).
5. **No route fetch needed any more:** PR #774's dry run finds 0 lines to fetch; the #650 NEEDS FETCH is closed (DECISIONS pass 82).
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. Contract calls to check (QUESTIONS.md passes 80–82): `trips?` on SimulatorResponse kept full size (#761), new `shared/v2/parseRequest.ts` (#764), `stopsDone?` on EmployeeJobView (#781), `study` in package.json (#766); the F1 sender is always the signed-in business. Older: AGENTS.md `RELAY_STATE_PATH`; four config lines from pass 62.

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs (#761, #762, #763) are that. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (2 new)
- F2 #780 (victor-2): real-run test that network Play and journeys show every carrier's whole commute with the package riding on it; fix "Journey complete" showing while a direct evening journey still plays.
- #781 (victor-6): server sends `stopsDone` per Employee job, so "Collect the package" is not marked done when the commute leaves.

## In progress / in review
- F1 #764 (victor-1) `POST /api/v2/parse-request`, offline rule parser, `shared/v2/parseRequest.ts`, client helper.
- F1 #771 (victor-5) New delivery form opens prefilled from a parsed draft: PR #777 in review.
- F1 #772 (victor-9) test guard: Gemini key never in client code, a `?key=` URL, a log or a `VITE_` variable.
- F3 #766 (victor-4) `npm run study` → `data/study/results.json`: PR #778 needs review.

## Merged since pass 81 (20:02)
- PR #776 (#761) F2: journey Play covers each carrier's whole commute; `trips` in the simulator answer (Navy Yard journey 15.5 s).
- PR #775 (#762) F2: big carrier marker with letter, package badge riding on it, dashed uncached lines, map text in Inter 600.
- PR #774 (#763) F2: dry run counts carrier home ↔ work lines: 0 missing.
- PR #773 (#765) F1: Gemini structured-output client (`server/ai/gemini.ts`, `env.ts`).
- PR #770 (#768) UI test: no page route logs `console.error`/`warn`.

## Next up (each needs the issues in brackets merged first)
- F1: wire Gemini into parse-request: prompt with businesses, categories, sim time; JSON schema; validate ids; fall back to offline on no key / error / 6 s; `source` label [#764] (victor-1; #765 is merged).
- F1: Business New delivery is one big text box → the prefilled form as the confirmation card ("Parsed by Gemini"/"Parsed offline") → Send; "Fill in the form instead"; a named sender other than the signed-in business is a plain note [#764, #771] (victor-5).
- F3: `client/public/study.html` (self-contained: headline numbers, cost/miles/CO₂ charts, run distribution, assumptions table) generated from the results and committed, plus "The numbers" link on `/` [#766].
- README: `.env` Gemini lines, `npm run study`, the text box [F1 and F3 merged].
- Arrows/legend glyphs outside the Latin subsets: low priority.

## Known bugs / gaps
- A direct evening journey says "Journey complete" while still playing (#780).
- Employee job marks "Collect the package (done)" when the commute leaves (#781).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note).
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
