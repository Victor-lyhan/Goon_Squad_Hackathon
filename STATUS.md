# STATUS (maintained by the planner)

_Last update: 2026-11-14, 23:35 (Sat), planner pass 108_

## Current milestone: all milestones done; humans' polish backlog (QUESTIONS 23:01) until 04:30, code freeze 05:00. Rollback tag: `demo-3`.
MVP IV and the approved post-freeze additions are on main. 23 polish issues are open (#877–#909 minus merged #879, #883, #884); every worker except victor-7 has a `ready` issue, and victor-7 has #893 in progress plus PR #902's fix round.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Markers, routes and the dark pills over the real map are unseen by agents. Write what looks wrong in QUESTIONS.md.
2. **The demo price is $9.50** (PR #866; the README sentence's 18 h window gets the $1 flexibility discount). Scenario exports made before PR #866 are refused on import.
3. **Look at the homepage (PR #873, audited in PR #897) and the 64 px header (PR #875)**, ideally in Safari (mask + `offset-path`).
4. **F1/advisor: put `GEMINI_API_KEY`** in `.env`, run `npx tsx scripts/gemini-check.ts "<sentence>"`. Without a key the advisor answers offline; after one Gemini failure both Parse and Options go offline for 2 minutes (PR #896).
5. **Before the real demo, reset the run** (stop server, delete `data/state-v2.json`, start). **Demo machine:** `npm run build` in the checkout with `.env`.
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. `docs/relay-spec.md:334` still prices a delivery at $10.00 (human-owned doc).
8. Will the demo machine have `GOOGLE_MAPS_SERVER_KEY`? (#899 reports whether the Employee step needs it.)

## Main health
- CI red = billing (DECISIONS pass 61): runs of #879, #883 and the 23:27 planner commit. Last local run (PR #897 review): 411 files / 7341 tests pass, build OK. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass: 3
- #907 victor-2: simulator page frame (`SimWorkspace.*`, `FocusSelector`, `PanelSection`, `page/page.css`) at 900–1440 px, keyboard.
- #908 victor-10: 30-second path, simulator half (homepage files, sim `journey/` + `packages/`).
- #909 victor-8: `client/src/api/` network / timeout / bad-reply messages in plain words.

## In progress / in review / ready
- PRs: #905 (#887 study page) and #904 (#880 Business 30-second path) need review; #903 (#877 README) and #902 (#878 demo re-walk) need fixes.
- In progress: #881 Business list + details (victor-5), #882 Employee audit (victor-6), #885 lazy-load / perf (victor-9), #888 `/api/v2` error copy (victor-1), #889 sim map controls a11y (victor-2), #890 map placeholders (victor-3), #893 jargon guard (victor-7), #894 sim page states (victor-8), #895 focus ring / reduced motion (victor-10).
- Ready: #886 UI kit states (victor-9), #891 Play twice in Chrome (victor-4), #892 Business frame (victor-6), #898 offline Parse variants (victor-1), #899 address-search errors (victor-3), #900 Business live poller (victor-5), #907, #908, #909.

## Merged since pass 107 (23:30)
- PR #901 (#883): simulator side panels (packages, inspector, journey, run summary, compare) audit, plain empty states, keyboard.

## Next up
- Copy fixes from #893's offender table, by module, once it merges.
- Fixes for faults #878 (demo re-walk), #885 (perf) and #891 (replay twice) list outside their own files.
- Header (markup in `App.tsx`) 390 px / keyboard audit after #885 frees `App.tsx`.
- `.watch-button` 20 px font onto a token after #895 frees `tokens.css`, low priority.
- Stop queuing at 04:30.

## Known bugs / gaps / risks
- Real Gemini API never tested (to-do 4). Homepage animation and mask checked in headless Chrome only.
- PR #870: a parsed form focuses its first field, which may sit below the fold at 390 px (#878 and #880 check).
- Address search with no server key answers 503; whether the Employee demo step needs it is checked by #899.
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note).
- `PORT` does not work with `npm run dev`; `npm run study` needs tsx (devDependency).
