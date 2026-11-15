# STATUS (maintained by the planner)

_Last update: 2026-11-14, 19:50 (Sat), planner pass 79 (started 19:42)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1, P2 and P3 are merged. P4 browser QA merged: page CSS (#722), simulator (#723), production mode (#726), Employee flow (#729), simulator keyboard pass (#730), Business flow (#731), bare-path redirect + `/` keyboard pass (#732), server hardening (#733), "Back to start" unlocks (#736), Plex Mono 600 (#741), Employee keyboard pass (#744), README walk-through (#738), Business locked copy + mono spans (#748), rehearse-twice UI test (#749), global bold 600 (#750), Employee locked copy (#751). In review: #752 (other journeys), #753 (Landing console error), #754 (pause race). New: #755, #756, #757.**

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start) if anyone pressed "Find a delivery match" while rehearsing: the README request uses up its free commutes (matches twice, then refuses; PR #749). Play / Back to start / journeys need no reset.
3. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726).
4. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line: `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`. 25 route lines missing (PR #738).
5. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
6. **AGENTS.md** (yours) still says "Env vars needed: none"; add `RELAY_STATE_PATH` (optional, PR #733) if you agree.
7. Overrule the calls of passes 63 to 79 in QUESTIONS.md if you disagree. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (#740, #743, #745 merges) are that. No fix issue. PRs #748, #749, #750, #751 each ran `bash scripts/test.sh` green locally (up to 349 files, 6007 tests).

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (3 new)
- #755 A 409-locked New delivery form / commute editor reopens one poll after Back to start; the two `it.fails` of PR #749 become passing tests (victor-7, both pages in one slice because both checks live in `demo-rehearse-twice.test.tsx`).
- #756 README lock paragraph names "Back to start" (still says "planning cycle"), and says one run holds the README request twice, so reset before the demo (victor-8).
- #757 `h3`–`h6` at 600 in `styles/global.css`, guarded by `kit-v2-fonts.test.ts` (victor-9).
- None for victor-3 (geo), victor-4 (engine): no MVP III work. victor-1/2/5 each have one in review; their other files are held.

## In review
- PR #752 (#739) direct, other relay, unmatched journeys + network Play → Back to start in headless Chrome (victor-2).
- PR #753 (#746) `Landing.tsx` key-spread console error (victor-5).
- PR #754 (#747) pause is final, no version bump after the pause answer (victor-1).

## Merged since pass 78 (19:38)
- PR #751 (#745) Employee locked notes name "Back to start".
- PR #750 (#743) `strong, b, th { font-weight: 600 }`; font sweep of 9 views found one faked bold (New delivery result line), now fixed.
- PR #749 (#740) rehearse-twice UI test on a real server: passes; found the 409-stays-locked fault (now #755).
- PR #748 (#742) Business locked notes name "Back to start"; price and hint data in mono spans.

## Next up (each needs the issues in brackets merged first)
- `map/GoogleBaseMap.tsx:135` no-key panel `role="alert"` → `role="status"` [#739].
- `map/layers.ts` deck.gl text asks for 'IBM Plex Sans' (not loaded) at 600/700; should be Inter 600 [#739].
- UI test: every page route renders with no `console.error` [#746].
- Arrows and legend glyphs (`→ ← ▲ ■ ◆ ⇄ ⚑`) are outside the Latin font subsets, drawn in a system font (PR #750 note); low priority, only if time before freeze [#739, #746, #755].
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- A form or editor locked by a 409 stays locked after Back to start until closed and reopened; fix #755.
- README says the locked pages speak of a "planning cycle"; fix #756.
- `/` logs a React key-spread error under `npm run dev` only; fix #746.
- `v2-e2e-nyc-flow` version check can fail under heavy load; fix #747.
- No-key map panel is `role="alert"`; map text layers name an unloaded font (both after #739).
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
- Employee job marks "Collect the package (done)" when the commute leaves (needs a `shared/v2/api.ts` field, QUESTIONS pass 61).
- Employee Watch links on a phone land on the simulator's "needs a wider screen" notice (by design, pass 74).
