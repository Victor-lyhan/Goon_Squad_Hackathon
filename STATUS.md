# STATUS (maintained by the planner)

_Last update: 2026-11-14, 20:23 (Sat), planner pass 83 (started 20:17)_

## Current milestone: MVP IV (docs/mvp4.md): F2 moving employees by 9:30 p.m.; F1 Gemini requests and F3 Relay vs traditional study by 10:30 p.m.
MVP III is done (P1 to P4 merged through PR #769). MVP III rules still hold (business-only stops, one relay point, the 30-second demo). Code freeze 5 a.m. unchanged.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key, and F2 (big lettered carriers, package badge, whole commutes) is on main. Write what looks wrong in QUESTIONS.md; it goes first.
2. **F1 needs `GEMINI_API_KEY`** (and optionally `GEMINI_MODEL`) in `.env` for "Parsed by Gemini" once #785 merges; without it the offline parser answers. Agents never see it.
3. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone rehearsed "Find a delivery match" (PR #749).
4. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726).
5. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
6. Contract calls to check (QUESTIONS.md passes 80–83): `trips?` on SimulatorResponse kept full size (#761), `shared/v2/parseRequest.ts` (#764, merged), `stopsDone?` on EmployeeJobView (#781), `study` in package.json (#766); the F1 sender is always the signed-in business; study page committed as generated HTML (#787). Older: AGENTS.md `RELAY_STATE_PATH`; four config lines from pass 62.

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs (#772, #764, the 20:12 planner commit) are that. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (3 new)
- F1 #785 (victor-1): parse-request asks Gemini first (prompt, JSON schema, id validation), falls back offline on no key / error / 6 s.
- F1 #786 (victor-5): Business New delivery = one big text box → prefilled form as the confirmation card, source label, sender note, "Fill in the form instead".
- F3 #787 (victor-4): `npm run study` also writes the self-contained `client/public/study.html` (committed).

## In progress / in review
- F2 #780 (victor-2): real-run check of network Play and journeys; "Journey complete" while still playing.
- #781 (victor-6) `stopsDone` per Employee job: PR #783 needs review.

## Merged since pass 82 (20:12)
- PR #782 (#772) F1: test guard, the Gemini key never in client code, `?key=` URL, a log or a `VITE_` name.
- PR #779 (#764) F1: `POST /api/v2/parse-request`, offline rule parser, `shared/v2/parseRequest.ts`, client helper.
- PR #778 (#766) F3: `npm run study` → `data/study/results.json`.
- PR #777 (#771) F1: New delivery form opens prefilled from a parsed draft, "Check this" hints.

## Next up (each needs the issues in brackets merged first)
- F3: "The numbers" link on `/` (Landing.tsx, victor-5) [#787].
- F1: headless-Chrome check of the text box → card → Send flow, offline and with a faked Gemini answer [#785, #786].
- README: `.env` Gemini lines, `npm run study` and the study page, the text box [#785, #786, #787].
- Arrows/legend glyphs outside the Latin subsets: low priority (map/ held by #780).

## Known bugs / gaps
- A direct evening journey says "Journey complete" while still playing (#780).
- Employee job marks "Collect the package (done)" when the commute leaves (#781, PR #783).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (DECISIONS pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note).
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
