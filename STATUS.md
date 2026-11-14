# STATUS (maintained by the planner)

_Last update: 2026-11-14, 16:34 (Sat), planner pass 60 (started 16:10)_

## Current milestone: M9 Polish (target 10:00 p.m. Sat)
The NYC app is the only app a visitor can reach (cutover PR #559). The MVP 1 Employee portal (PR #574) and simulator (PR #576) are deleted; the Business portal and the synthetic homepage are next (#565, not started). This pass: the three workspaces were read against `docs/mvp2-ui-redesign.md` and the gaps found are queued (#578 to #584).

## HUMAN TO-DO
1. **Open `/simulator`, `/business/<id>` and `/employee/<id>` with the browser key.** No agent has seen the Google map. Write what looks wrong in QUESTIONS.md and I queue it first.
2. **Is p2-a running?** #565 and #568 have been `ready` since 16:00 and are not started. Three follow-ups wait for #565.
3. Run `npm run fetch:routes -- --drop-entered` before committing `fixtures/nyc/` again.
4. Optional: add `held: ShipmentView[]` to `BusinessDashboard` in `shared/v2/api.ts` if a relay business should list the packages it holds (QUESTIONS pass 60).

## Main health: both red tests have merged fixes; CI not readable from this session
- `tests/geo/nyc-cache-committed-lines`: fixed by PR #572 (#554). The JetBlue line is a real Google answer; the rule is now 0.5 to 1.5 times the pair's distance.
- `tests/ui/sim-v2-real-movement`: fixed by PR #575 (#553).
- The CI runs on main listed at 16:10 were still in progress, so I created no fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (7 issues, and #533 back to `ready`)
- victor-2: #578 business names on the map and the package visible at a stop (in progress); #579 focus and selection reset when the run changes; #580 inspectors: reward, extra minutes, one time per stop.
- p2-a: #581 Business page up to 1320 px, a relay business opens the package it holds, New delivery closed while locked; #582 the whole match result in the New delivery form, no duplicate on retry.
- p2-b: #583 one time format, "Day 2, 8:05 AM" (in progress); #584 router links and one `main` on the Employee page.
- victor-1: #533 (three workspaces agree on the real run) is `ready` again.

## In progress / in review
- victor-1: #569 README in progress; #570, #533 ready. Parked: #532.
- victor-4: #555 commute-save deadline, in review.
- p2-a: #565, #568, #581, #582 ready, none started.
- victor-3, p1-a, p1-b: nothing open (no demo-visible work in the geo and engine layers).

## Merged since pass 59 (16:03)
- victor-2: PR #564 (#552) journey mode finished; PR #575 (#553) a leg with no route line moves on the straight line through its places; PR #576 (#567) MVP 1 simulator deleted.
- victor-1: PR #571 (#535) a relay business is told about the packages it holds; PR #577 (#536) missing route lines are fetched when a map is asked for.
- p2-a: PR #573 (#549) a delivery's route on a map in the Business details.
- p2-b: PR #574 (#566) MVP 1 Employee portal deleted.
- victor-3: PR #572 (#554) the cache guard's length rule corrected.

## Next up (each needs the issues in brackets merged first)
- victor-2: delete `CityMap.tsx`, `sim/mapGeometry.ts` and `sim/CityMap.css` [#565].
- victor-1: delete the MVP 1 API, store and `client/src/api` calls [#565, #569]; then #532 back to `ready`.
- p1-a, p1-b: delete the MVP 1 engine files [the victor-1 deletion].
- p2-a: homepage ("Relay points" always equals the business count; the NYC line appears three times) and the button label "Find a delivery match" with the Help page [#565]; shipments table rows as links [#581].

## Known bugs / gaps
- Simulator: no business names on the map; the package is hidden under the stop numbers while it waits (#578). A stale focus blanks the map after Random city (#579).
- Business: the table is squeezed into 960 px; a relay business's notification opens "belongs to another business" (#581). The result shows only an ID; a retry after a no-match creates a second delivery (#582).
- Employee: three time formats (#583); every link reloads the app (#584).
- A commute save can hang for a minute when Google is silent (#555, in review).
- The README still describes the synthetic city and `/nyc/...` (#569).
- An import with a trip from an unknown place is stored and then blocks Recompute (#570).
- The Demo account selector lists 60 employees by name only (#568).
- This planner run can't use `gh run list`, `gh pr list`, `git fetch`, `node` or `npm`.
