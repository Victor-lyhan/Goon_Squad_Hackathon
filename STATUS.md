# STATUS (maintained by the planner)

_Last update: 2026-11-14, 16:03 (Sat), planner pass 59 (started 15:57)_

## Current milestone: M9 Polish (target 10:00 p.m. Sat)
**The cutover is on main** (PR #559, 15:58): `/`, `/business/:id`, `/employee/:id`, `/simulator` and `/help` show the NYC app and `/nyc/...` redirects. Now: delete the MVP 1 client code (#565, #566, #567), rewrite the README (#569), then the MVP 1 API and engine files.

## HUMAN TO-DO
1. **Set the git tag `mvp1` now.** p2-b started deleting MVP 1 files at 16:00 (#566). `git tag mvp1 1e3a80a && git push origin mvp1` (PR #544, the commit just before the cutover merge; check with `git log`).
2. **Main is red, and you need to do nothing.** Reviewers keep asking for a refetch; do not run one unless #554's PR asks. Both causes have an owner (see Main health).
3. **Open `/simulator`, `/business/<id>` and `/employee/<id>` with the browser key.** No agent has seen the Google map.
4. Run `npm run fetch:routes -- --drop-entered` before committing `fixtures/nyc/` again.

## Main health: RED (7 tests in 2 files), CI not readable from this session
- `tests/geo/nyc-cache-committed-lines` (6 tests): the JetBlue to Park Slope line is 0.62x its pair's distance. **#554, victor-3, in progress.**
- `tests/ui/sim-v2-real-movement` (1 test, "a leg with only some pairs cached"): `legLine` gives no path when none of a leg's pairs has a line. Same bug as **#553, victor-2, in progress**; I added the test to its criteria.
- Typecheck and build pass. Reviewers merge PRs whose only failures are these 7.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (6 issues)
- p2-a: #565 delete the MVP 1 Business portal and the synthetic homepage and Help; #568 employer names in the Demo account selector.
- p2-b: #566 delete the MVP 1 Employee portal (in progress).
- victor-2: #567 delete the MVP 1 simulator and, when nothing imports it, the SVG CityMap.
- victor-1: #569 README for the NYC app with a live demo request proven over HTTP; #570 refuse an import that refers to a place it does not contain.

## In progress / in review
- victor-1: #535 relay notification (in progress); ready: #536 missing route lines, #569, #570. Parked: #532, #533.
- victor-2: PR #564 (#552 journey mode) in review; #553 in progress; #567 ready.
- victor-3: #554 in progress. victor-4: #555 commute-save deadline, ready (moved from victor-3 by someone at about 16:00).
- p2-a: #549 Business route map in progress; #565, #568 ready. p2-b: #566.
- p1-a, p1-b: nothing open.

## Merged since pass 58 (15:50)
- **p2-a: PR #559 (#548) the cutover.**
- p2-b: PR #557 (#550) Esc and focus in the commute editor; PR #558 (#551) "5.5 km shorter".
- victor-2: PR #556 (#528) late route lines; PR #544 (#519) simulator page in a real DOM.
- victor-1: PR #562 (#521) broken-request sweep: fixed 5 bugs in the write routes (a deep or huge import no longer breaks the server), left 1 (#570).
- victor-3: PR #561 (#538) the fetch command explains a failed story row.
- victor-4: PR #560 (#531) metrics on the real cache, no bug. p1-b: PR #563 (#493) matcher on the real cache: 2.2 ms, no bug, no missing pair on Random cities.

## Next up (each needs the issues in brackets merged first)
- victor-1: delete the MVP 1 API, store and `client/src/api` calls [#565, #566, #567]; #533 back to `ready` [#536].
- p1-a, p1-b: delete the MVP 1 engine files [the victor-1 deletion].
- victor-2: business names always on the map in the network view [PR #564, same file].
- A last sweep for MVP 1 files the three client issues had to keep [#565, #566, #567].

## Known bugs / gaps
- Main's test suite is red (#554, #553).
- A relay-only business is not told it holds a package (#535).
- A moving marker cuts corners while a leg has no route line (#553). Plans from a re-match, Recompute, Random city or an import get no route lines (#536).
- A commute save can hang for a minute when Google is silent (#555).
- Journey mode: both carriers' vehicles are the same colour (PR #564 in review).
- The README still describes the synthetic city and `/nyc/...` (#569).
- An import with a trip from an unknown place is stored and then blocks Recompute (#570).
- The Demo account selector lists 60 employees by name only (#568).
- This planner run can't use `gh run list`, `gh pr list`, `gh api`, `git pull`, `node` or `npm`.
