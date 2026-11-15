# STATUS (maintained by the planner)

_Last update: 2026-11-14, 19:38 (Sat), planner pass 78 (started 19:35)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1, P2 and P3 are merged. P4 browser QA merged: page CSS (#722), simulator (#723), production mode (#726), Employee flow (#729), simulator keyboard pass (#730), Business flow (#731), bare-path redirect + `/` keyboard pass (#732), server hardening (#733), "Back to start" unlocks the run (#736), Plex Mono 600 + no-key card advice (#741), Employee keyboard pass (#744), README walk-through (#738). In progress: other journeys QA (#739), rehearse-twice UI test (#740), Business locked copy + mono markup (#742), global bold weight (#743). New: Employee locked copy (#745), Landing console error (#746), pause race (#747).**

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Nobody has seen the map with a key. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Rehearsing is safe (PR #736):** after Play with no package picked, press **Back to start** and requests and commute edits reopen. The README now says so (PR #738).
3. **Demo machine:** the browser key is read at build time. Run `npm run build` in the checkout that has `.env` (PR #726; the no-key card says so, PR #741).
4. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line: `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`. A fresh-clone dry run counts 25 route lines missing (PR #738).
5. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
6. **AGENTS.md** (yours) still says "Env vars needed: none"; add `RELAY_STATE_PATH` (optional, PR #733) if you agree.
7. Overrule the calls of passes 63 to 78 in QUESTIONS.md if you disagree. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (#728, #735, planner 19:30) are that. No fix issue. PR #738 ran `bash scripts/test.sh` green locally (345 files, 5952 passed, 1 expected fail); its one load-only failure in `v2-e2e-nyc-flow` is #747.

## Stuck
- Nothing labeled `stuck`. No open PRs.

## Queued this pass (3 new)
- #745 Employee locked notes (`LOCKED_TEXT`, `LOCKED_MESSAGE`) name "Back to start"; tests pinning "planning cycle" updated (victor-6).
- #746 `Landing.tsx` stops spreading a `key` prop into JSX (dev console error, PR #738 note 4); console-silent render test (victor-5).
- #747 Pause is final: no ticker step bumps the version after the pause answer, or the e2e test waits for a stable version (PR #738 note 5) (victor-1).
- Only 3: sim/v2 + map held by #739; engine and geo have no MVP III work.

## In progress
- #739 Direct, other relay, unmatched journeys + network Play → Back to start in headless Chrome (victor-2).
- #740 UI test: rehearse the demo twice on a real server (victor-8).
- #742 Business locked copy + mono spans (victor-5).
- #743 `strong, b, th` at 600 in `styles/global.css` + font sweep (victor-9).

## Merged since pass 77 (19:30)
- PR #744 (#735) Employee keyboard/screen-reader pass: focus into the editor and back, Save `aria-disabled` while saving, two page-level polite regions, visible checkbox ring; 28 jsdom tests.
- PR #738 (#728) README walk-through on a fresh worktree: every command and both demos in headless Chrome; "Back to start" unlocks, `RELAY_STATE_PATH`, bare-path redirect; `readme.test.ts` pins updated.
- Earlier MVP III: #741, #736, #733, #732, #731, #730, #729, #726, #723, #722, #717, #716, #715 and before.

## Next up (each needs the issues in brackets merged first)
- `map/GoogleBaseMap.tsx:135` no-key panel `role="alert"` → `role="status"` (re-announced on every Employee job open and Back, PR #744 note) [#739].
- `map/layers.ts` deck.gl text asks for 'IBM Plex Sans' (not loaded since #651) at 600/700; should be Inter 600 [#739].
- UI test: every page route renders with no `console.error` [#746].
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- Business and Employee locked notes still say "next/new planning cycle"; fix #742 (Business), #745 (Employee).
- Unstyled `<strong>`/`<b>`/`<th>` are faked bold at 700; fix #743.
- `/` logs a React key-spread error under `npm run dev` only; fix #746.
- `v2-e2e-nyc-flow` version check can fail under heavy load; fix #747.
- No-key map panel is `role="alert"`, so screen readers hear it on each Employee job open (after #739).
- Map text layers name an unloaded font (`map/layers.ts`), only visible with a key (after #739).
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
- Employee job marks "Collect the package (done)" when the commute leaves (needs a per-stop field in `shared/v2/api.ts`, QUESTIONS pass 61).
- Employee Watch links on a phone land on the simulator's "needs a wider screen" notice (by design, pass 74).
