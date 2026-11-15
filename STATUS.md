# STATUS (maintained by the planner)

_Last update: 2026-11-14, 19:58 (Sat), planner pass 80 (started 19:50)_

## Current milestone: MVP IV (docs/mvp4.md, added 19:50): F2 moving employees by 9:30 p.m.; F1 Gemini requests and F3 Relay vs traditional study by 10:30 p.m.
MVP III is done: P1 to P3 merged, P4 browser QA merged through PR #754. MVP III rules still hold (business-only stops, one relay point, the 30-second demo). Code freeze 5 a.m. unchanged.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1 needs `GEMINI_API_KEY`** (and optionally `GEMINI_MODEL`) in `.env` for "Parsed by Gemini"; without it the offline parser answers. Agents never see it.
3. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
4. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726).
5. **Run the fetch:** QUESTIONS.md "NEEDS FETCH" lines (#650: 25 plan lines; #763 will add the carriers' home ↔ work lines). `npm run fetch:routes`, then `-- --drop-entered`, commit `fixtures/nyc/`.
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. Pass 80 made three small contract calls (QUESTIONS.md): `trips?` on SimulatorResponse (#761), new `shared/v2/parseRequest.ts` (#764), `study` and maybe `@deck.gl/extensions` in package.json (#766, #762). Overrule if you disagree. Older open items: AGENTS.md `RELAY_STATE_PATH`; four config lines from pass 62.

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs (#754 merge, 19:45 planner commit, MVP IV spec commit) are that. No fix issue. PRs #752 to #754 ran `bash scripts/test.sh` green locally.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (8 new)
- F2 #761 (victor-10): journey Play covers each carrier's whole commute; carriers' `trips` in the simulator response.
- F2 #762 (victor-2): big employee marker with letter, package badge riding on it, dashed line for uncached stretches, deck.gl font to Inter 600.
- F2 #763 (victor-3): count/fetch missing home ↔ work route lines, NEEDS FETCH line.
- F1 #764 (victor-1): `POST /api/v2/parse-request` with the offline rule parser, contract, client helper.
- F1 #765 (victor-3): Gemini structured-output client (header key, 6 s timeout).
- F3 #766 (victor-4): `npm run study` → `data/study/results.json` with assumptions.
- #767 (victor-9): no-key map card `role="status"`.
- #768 (victor-8): UI test that no page route logs `console.error`/`warn`.
- No issue for victor-5/6/7: their next F1 work (New delivery text box) needs #764; victor-7 has #755.

## In progress
- #755 (victor-7) 409 "locked" form/editor reopens after Back to start.
- #756 (victor-8) README lock paragraph names "Back to start".
- #757 (victor-9) `h3`–`h6` at 600.

## Merged since pass 79 (19:50)
- PR #754 (#747) Pause is final: no version bump after the pause answer.
- PR #753 (#746) `/` React key-spread console error gone.
- PR #752 (#739) direct, other relay, unmatched journeys and network Play → Back to start checked in headless Chrome.

## Next up (each needs the issues in brackets merged first)
- F1: wire Gemini into parse-request: prompt with businesses, categories, sim time; JSON schema; validate ids; fall back to offline on no key / error / 6 s; `source` label [#764, #765] (victor-1).
- F1: Business New delivery is one big text box → editable confirmation card ("Parsed by Gemini"/"Parsed offline") → Send via the existing shipment API; "Fill in the form instead" [#764, #755] (victor-5).
- F3: `client/public/study.html` (self-contained: headline numbers, cost/miles/CO₂ charts, run distribution, assumptions table) generated from the results and committed, plus "The numbers" link on `/` [#766].
- F2: headless Chrome check of the whole-commute journey and network Play [#761, #762].
- Arrows/legend glyphs outside the Latin subsets: low priority.

## Known bugs / gaps
- A form or editor locked by a 409 stays locked after Back to start until reopened; fix #755.
- README says "planning cycle" for the lock; fix #756.
- Journey Play shows only the stops part of each commute (F2, #761); package ring hides the carrier (#762).
- 25 relay stretches (and maybe some home ↔ work stretches) move on straight lines until the NEEDS FETCH is run.
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- Employee job marks "Collect the package (done)" when the commute leaves (needs a `shared/v2/api.ts` field, QUESTIONS pass 61).
