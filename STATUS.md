# STATUS (maintained by the planner)

_Last update: 2026-11-15, 00:09 (Sun), planner pass 111_

## Current milestone: all milestones done. **Polishing ended at midnight (humans, 23:50): no new issues.** In-progress work finishes; anything not merged by 00:15 stays open; then halt. Code freeze 05:00. Rollback tag: `demo-3`.

## HUMAN TO-DO
1. **CI on main is red three runs in a row**: #919 (PR #930), #900 (PR #932) and the 00:04 planner commit (Markdown only). #895 (PR #929) was the last green run. A docs-only commit failing points to a real test failure on main (or billing again). The planner could not open the logs or run git/tests (they need approval in this run). **First thing: run `bash scripts/test.sh` on main**, and if it's red, roll back to `demo-3` or fix it before the demo.
2. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. No agent has seen the markers, routes or dark pills on the real map.
3. **Run the demo check (PR #931)** on the demo machine: it says in plain lines whether keys, travel data, saved run and build are ready. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start it again) and run `npm run build` in the checkout with `.env`.
4. **F1/advisor: put `GEMINI_API_KEY`** in `.env`, then run `npx tsx scripts/gemini-check.ts "<sentence>"`. Without a key, Parse and Options answer offline (PR #925).
5. **The demo price is $9.50** (PR #866). Scenario exports made before PR #866 are refused on import.
6. **Look at the homepage and the 64 px header** (header audit merged, PR #933), ideally in Safari (mask + `offset-path`).
7. Will the demo machine have `GOOGLE_MAPS_SERVER_KEY`? #899 (ready, not started) would check whether the Employee step needs it; it will probably stay open after 00:15.
8. `docs/relay-spec.md:334` still prices a delivery at $10.00 (human-owned doc).

## Main health
- Latest runs: planner 00:04 **failure**, #900 (PR #932) **failure**, #919 (PR #930) **failure**; #895 (PR #929) success. No fix issue (humans' stop); see to-do 1.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass: 0 (humans' 23:50 stop)

## In progress / in review (finish by 00:15 or stay open)
- PRs to review: #935 (#916 Employee copy, victor-6), #934 (#891 Play twice in Chrome, victor-4). Needs fix: #914 (#881 Business list + details, victor-5).
- In progress: #923 restart the server twice mid-demo (victor-8), #921 simulator live updates back off (victor-2), #908 30-second path, simulator half (victor-10), #890 map placeholders (victor-3).
- Ready but not started: #899 address-search errors (victor-3).
- Idle: victor-1, victor-7, victor-9 (nothing to do, by design).

## Merged since pass 110 (00:03)
- #933 (#918) app header audit at 390/900/1440 px; #932 (#900) Business live updates poll one at a time and back off.

## Merged in pass 108-110 window
- #931 (#922), #930 (#919), #929 (#895), #928 (#909), #927 (#892), #926 (#886), #925 (#898), #924 (#917), #920 (#907), #915 (#894), #913 (#893), #912 (#889), #911 (#885), #910 (#882), #906 (#888), #905 (#887), #904 (#880), #903 (#877), #902 (#878).

## Next up
- Nothing. After 00:15 the planner only refreshes this file.

## Known bugs / gaps / risks
- CI red on main since PR #930 (to-do 1); cause not seen.
- Real Gemini API never tested (to-do 4). Homepage animation and mask checked in headless Chrome only.
- PR #870: a parsed form focuses its first field, which may sit below the fold at 390 px.
- Address search with no server key answers 503 (#899 not started).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; no page reaches it (pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note).
- `PORT` does not work with `npm run dev`; `npm run study` needs tsx (devDependency).
