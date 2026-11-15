# STATUS (maintained by the planner)

_Last update: 2026-11-14, 20:08 (Sat), planner pass 81 (started 20:02)_

## Current milestone: MVP IV (docs/mvp4.md): F2 moving employees by 9:30 p.m.; F1 Gemini requests and F3 Relay vs traditional study by 10:30 p.m.
MVP III is done (P1 to P4 merged through PR #769). MVP III rules still hold (business-only stops, one relay point, the 30-second demo). Code freeze 5 a.m. unchanged.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1 needs `GEMINI_API_KEY`** (and optionally `GEMINI_MODEL`) in `.env` for "Parsed by Gemini"; without it the offline parser answers. Agents never see it.
3. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
4. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726).
5. **Run the fetch:** QUESTIONS.md "NEEDS FETCH" lines (#650: 25 plan lines; #763 will add the carriers' home ↔ work lines). `npm run fetch:routes`, then `-- --drop-entered`, commit `fixtures/nyc/`.
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. Contract calls to check (QUESTIONS.md pass 80/81): `trips?` on SimulatorResponse (#761), new `shared/v2/parseRequest.ts` (#764), `study` and maybe `@deck.gl/extensions` in package.json (#766, #762); pass 81: the F1 sender is always the signed-in business. Older: AGENTS.md `RELAY_STATE_PATH`; four config lines from pass 62.

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs (#767, the 19:57 planner commit, #755) are that. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (2 new)
- F1 #771 (victor-5): New delivery form opens prefilled from a parsed draft and marks fields still to fill (becomes the confirmation card).
- F1 #772 (victor-9): test guard that the Gemini key never reaches client code, a `?key=` URL, a log or a `VITE_` variable.
- Nothing else: every other MVP IV step waits for an issue in progress (see Next up). victor-6 has no F1/F2/F3 work in the Employee page.

## In progress (all started 19:56–20:00)
- F2 #761 (victor-10) journey Play covers each carrier's whole commute; `trips` in the simulator response.
- F2 #762 (victor-2) big employee marker with letter, package badge riding on it, dashed uncached lines.
- F2 #763 (victor-3) count/fetch missing home ↔ work route lines, NEEDS FETCH line.
- F1 #764 (victor-1) `POST /api/v2/parse-request` with the offline rule parser, contract, client helper.
- F1 #765 (victor-8, taken from victor-3) Gemini structured-output client.
- F3 #766 (victor-4) `npm run study` → `data/study/results.json`.
- #768 (victor-7, taken from victor-8) UI test: no page route logs `console.error`/`warn`.

## Merged since pass 80 (19:50)
- PR #769 (#767) no-key map card is `role="status"`.
- PR #760 (#755) a 409 "locked" form/editor reopens after Back to start.
- PR #759 (#756) README lock paragraph names "Back to start"; one run holds the README request twice.
- PR #758 (#757) `h3`–`h6` at 600.

## Next up (each needs the issues in brackets merged first)
- F1: wire Gemini into parse-request: prompt with businesses, categories, sim time; JSON schema; validate ids; fall back to offline on no key / error / 6 s; `source` label [#764, #765] (victor-1).
- F1: Business New delivery is one big text box → the prefilled form as the confirmation card ("Parsed by Gemini"/"Parsed offline") → Send; "Fill in the form instead"; a named sender other than the signed-in business is shown as a plain note [#764, #771] (victor-5).
- F3: `client/public/study.html` (self-contained: headline numbers, cost/miles/CO₂ charts, run distribution, assumptions table) generated from the results and committed, plus "The numbers" link on `/` [#766].
- F2: headless Chrome check of the whole-commute journey and network Play [#761, #762].
- Employee job "Collect the package (done)" too early: needs a `shared/v2/api.ts` field [#761 holds the file].
- Arrows/legend glyphs outside the Latin subsets: low priority.

## Known bugs / gaps
- Journey Play shows only the stops part of each commute (F2, #761); package ring hides the carrier (#762).
- 25 relay stretches (and maybe some home ↔ work stretches) move on straight lines until the NEEDS FETCH is run.
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- Employee job marks "Collect the package (done)" when the commute leaves (needs a `shared/v2/api.ts` field, QUESTIONS pass 61).
