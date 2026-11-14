# STATUS (maintained by the planner)

_Last update: 2026-11-14, 15:50 (Sat), planner pass 58 (started 15:43)_

## Current milestone: M9 Polish (target 10:00 p.m. Sat)
Following the humans' note of 15:40: **the cutover is in progress** (#548, p2-a started it at 15:47). Next is deleting the MVP 1 code (one issue per owner, queued when the PR of #548 merges), then visible demo polish. Test-only work is parked behind visible fixes.

## HUMAN TO-DO
1. **Main is red since your route-line commit 2c8423d**, in `tests/geo/nyc-cache-committed-lines`. One line, JetBlue to a Park Slope home, is 0.62x its pair's distance. It looks like a real route (Google's matrix took a 20.6 km road, the line is about 12.8 km). **Nothing for you to do**: #554 (victor-3) fixes the rule. No refetch needed unless #554 says the line is broken.
2. **Open `/nyc/simulator`, `/nyc/business/<id>`, `/nyc/employee/<id>` with the browser key** (after #548: `/simulator`, `/business/<id>`, `/employee/<id>`). No agent has seen the Google map.
3. Run `npm run fetch:routes -- --drop-entered` before committing `fixtures/nyc/` again.
4. Git tag `mvp1` still does not exist. Set it before the MVP 1 code is deleted (a pass or two from now).

## Main health: RED (test suite), CI not readable
- `bash scripts/test.sh` fails on main in 6 tests of one file (reported by PR #545, cause checked in `matrix.json`). Fix: #554, top priority, victor-3.
- The three newest CI runs were still in progress at 15:43. This session cannot list runs.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (8 issues)
- p2-a: **#548 the cutover** (in progress); #549 a route map in the Business delivery details.
- p2-b: #550 keyboard and focus fixes in the commute editor and job view (in progress); #551 "5.5 km shorter" and the reward first in the job view.
- victor-2: #552 journey mode: carrier vehicles in their leg colour, reward and delivery time in the panel; #553 a marker stays on a line when a leg has no route yet.
- victor-3: **#554 main is red**; #555 a 10 s deadline for the live commute save (PR #546 measured 63.5 s).
- Parked (`ready` removed): #532, #533 (victor-1 test sets), so #535 and #536 go first.

## In progress / in review
- victor-1 #521 (broken-request sweep); ready: #535 relay notification, #536 missing route lines.
- victor-2 #528 (late route lines); PR #544 (#519) in review. Its two `it.fails` are already fixed on main by PR #537, so they must become `it` (comment on #519).
- victor-3 #538 (story explainer in the fetch command). victor-4 #531 (metrics on the real cache); PR #547 (#516) in review.
- p1-a: #493 ready (matcher on the real cache). p1-b: nothing open.

## Merged since pass 57 (15:40)
- p2-a: PR #541 (#529) page-crash fallback; fixed a double history entry and Help's active mark.
- p2-b: PR #542 (#518) Employee page in a real DOM; found 4 focus bugs (#550).
- p1-b: PR #543 (#512) simulator views on the real run, found the straight-line bug (#553); PR #545 (#540) day tests without the story, found main red.
- victor-2: PR #537 (#511) simulator page against the doc; Esc now works after a click. p1-a: PR #539 (#482) timed tests.
- victor-3: PR #546 (#530) commute save measured: no limit near the 10 s budget.

## Next up (each needs the issues in brackets merged first)
- **Delete MVP 1 code** [#548]: client first, one issue per owner (p2-a, p2-b, victor-2), then the MVP 1 API and `client/src/api` calls (victor-1), then the MVP 1 engine files (p1-a, p1-b). See DECISIONS pass 58.
- victor-1: README demo steps with one live request of PR #527 pinned by a test [#548]; #533 back to `ready` [#535, #536].
- victor-2: business names always on the map in the network view [#552, same file].
- Whatever #521 and #544 leave as `it.fails`.

## Known bugs / gaps
- Main's test suite is red (#554).
- A relay-only business is not told it holds a package (#535).
- A live delivery has no route in an open simulator tab (#528), and its marker cuts corners until the line arrives (#553).
- Plans from a re-match, Recompute, Random city or an import get no route lines (#536).
- A commute save can hang for a minute when Google is silent (#555).
- Employee: Esc does not close the commute editor, focus is lost on close (#550); "-5.5 km" in the job view (#551).
- Journey mode: both carriers' vehicles are the same colour; no reward or delivery time in the panel (#552).
- This planner run can't use `gh run list`, `gh pr comment`, `git fetch`, `node`, `npm` or `tsx`.
