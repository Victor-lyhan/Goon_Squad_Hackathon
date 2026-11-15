# STATUS (maintained by the planner)

_Last update: 2026-11-14, 23:57 (Sat), planner pass 109_

## Current milestone: all milestones done. **Polishing ends at midnight (humans, 23:50): no new issues.** In-progress work finishes; anything not merged by 00:15 stays open; then halt. Code freeze 05:00. Rollback tag: `demo-3`.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Markers, routes and the dark pills over the real map are unseen by agents.
2. **Before the real demo, reset the run** (stop server, delete `data/state-v2.json`, start). **Demo machine:** `npm run build` in the checkout with `.env`. #922 (in progress) adds one demo-check command for keys, travel data, saved run and build.
3. **F1/advisor: put `GEMINI_API_KEY`** in `.env`, run `npx tsx scripts/gemini-check.ts "<sentence>"`. Without a key Parse and Options answer offline (PR #925 checked the demo sentence and 12 typed variants offline).
4. **The demo price is $9.50** (PR #866). Scenario exports made before PR #866 are refused on import.
5. **Look at the homepage and 64 px header**, ideally in Safari (mask + `offset-path`).
6. Will the demo machine have `GOOGLE_MAPS_SERVER_KEY`? #899 (ready, not started) reports whether the Employee step needs it.
7. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
8. `docs/relay-spec.md:334` still prices a delivery at $10.00 (human-owned doc).

## Main health
- CI runs of #898, #877 and the QUESTIONS commit were still in progress at 23:57; earlier runs fail for billing (DECISIONS pass 61). Last local run (PR #897 review): 411 files / 7341 tests pass. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass: 0 (humans' 23:50 stop)

## In progress / in review (finish by 00:15 or stay open)
- PRs needing review: #929 (#895 focus ring / reduced motion), #927 (#892 Business frame). Needs fix: #914 (#881 Business list + details).
- In progress: #923 restart server twice mid-demo (victor-8), #922 demo-check command (victor-1), #921 simulator live updates back off (victor-2), #919 Business New delivery copy (victor-7), #918 header audit (victor-9), #916 Employee copy (victor-6), #908 30-second path, simulator half (victor-10), #900 Business live poller (victor-5), #891 Play twice in Chrome (victor-4), #890 map placeholders (victor-3).
- Ready but not started: #899 address-search errors (victor-3). Per the 23:50 rule it is left open if nobody has started it.

## Merged since pass 108 (23:35)
- #928 (#909) client API errors in one plain sentence; #926 (#886) UI kit 404 / error / unreachable / spinner states; #925 (#898) offline Parse + Options for the demo sentence and 12 variants; #924 (#917) simulator Inspector and map tooltip copy; #920 (#907) simulator page frame; #915 (#894) simulator page states; #913 (#893) jargon guard test; #912 (#889) sim map controls a11y; #911 (#885) lazy-loaded workspace pages; #910 (#882) Employee audit; #906 (#888) `/api/v2` error copy; #905 (#887) study page; #904 (#880) 30-second path, Business half; #903 (#877) README sync; #902 (#878) full demo re-walk in production.

## Next up
- Nothing. After 00:15 the planner only refreshes this file.

## Known bugs / gaps / risks
- Real Gemini API never tested (to-do 3). Homepage animation and mask checked in headless Chrome only.
- PR #870: a parsed form focuses its first field, which may sit below the fold at 390 px.
- Address search with no server key answers 503 (#899 checks the Employee step).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note).
- `PORT` does not work with `npm run dev`; `npm run study` needs tsx (devDependency).
