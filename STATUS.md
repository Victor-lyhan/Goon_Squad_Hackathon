# STATUS (maintained by the planner)

_Last update: 2026-11-14, 23:30 (Sat), planner pass 107_

## Current milestone: all milestones done; humans' polish backlog (QUESTIONS 23:01) until 04:30, code freeze 05:00. Rollback tag: `demo-3`.
MVP IV and the approved post-freeze additions are on main. 21 polish issues are open (#877–#900, minus merged #879 and #884); every worker has at least one `ready` or in-progress issue.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Markers, routes and the dark pills over the real map are unseen by agents. Write what looks wrong in QUESTIONS.md.
2. **The demo price is $9.50** (PR #866; the README sentence's 18 h window gets the $1 flexibility discount). Scenario exports made before PR #866 are refused on import.
3. **Look at the homepage (PR #873, audited in PR #897) and the 64 px header (PR #875)**, ideally in Safari (mask + `offset-path`).
4. **F1/advisor: put `GEMINI_API_KEY`** in `.env`, run `npx tsx scripts/gemini-check.ts "<sentence>"`. Without a key the advisor answers offline; after one Gemini failure both Parse and Options go offline for 2 minutes (PR #896).
5. **Before the real demo, reset the run** (stop server, delete `data/state-v2.json`, start). **Demo machine:** `npm run build` in the checkout with `.env`.
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. `docs/relay-spec.md:334` still prices a delivery at $10.00 (human-owned doc).

## Main health
- CI red = billing (DECISIONS pass 61): runs of #879, #884 and the 23:20 planner commit. PR #897's review ran `scripts/test.sh` on its head: 411 files / 7341 tests pass, build OK. The one real failure PR #896's review saw on main (`tests/ui/landing-nyc-css.test.ts` pinning a 48 px header after PR #875) is fixed by PR #897 (it now pins `--app-header-h: 64px`). No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass: 3 (one per worker with nothing ready)
- #898 victor-1: offline Parse / Options handle the demo sentence + 12 typed variants; plain refusals (`server/ai/`, parse + advise routes).
- #899 victor-3: Employee address search (`/api/geo`) errors in plain words; check the Employee step with no server key.
- #900 victor-5: Business live poller: one in flight, back-off, hidden-tab pause, stop on leave (`business/v2/live/`).

## In progress / ready
- In progress: #877 README sync (victor-8), #878 demo re-walk 1440 + 390 px (victor-7), #880 Business 30-second path (victor-10), #881 Business list + details (victor-5), #882 Employee audit (victor-6), #883 sim side panels (victor-2), #885 lazy-load / perf (victor-9), #887 study page (victor-4), #888 `/api/v2` error copy (victor-1), #890 map placeholders (victor-3).
- Ready: #886 UI kit states (victor-9), #889 sim map controls a11y (victor-2), #891 Play twice in Chrome (victor-4), #892 Business frame (victor-6), #893 jargon guard (victor-7), #894 sim page states (victor-8), #895 focus ring / reduced motion (victor-10), #898, #899, #900.

## Merged since pass 106 (23:15)
- PR #896 (#884): after one Gemini failure, Parse and Options answer offline for 2 minutes.
- PR #897 (#879): homepage design audit (one filled button, fold, keyboard); fixes the header-height test.

## Next up
- Copy fixes from #893's offender table, by module, once it merges.
- Fixes for faults #878 (demo re-walk) and #885 (perf) list outside their own files.
- Header (markup in `App.tsx`) 390 px / keyboard audit after #885 frees `App.tsx`.
- `.watch-button` 20 px font onto a token (PR #897 note), low priority.
- Stop queuing at 04:30.

## Known bugs / gaps / risks
- Real Gemini API never tested (to-do 4). Homepage animation and mask checked in headless Chrome only.
- PR #870: a parsed form focuses its first field, which may sit below the fold at 390 px (#878 and #880 check).
- Address search with no server key answers 503; whether the Employee demo step needs it is checked by #899.
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note).
- `PORT` does not work with `npm run dev`; `npm run study` needs tsx (devDependency).
