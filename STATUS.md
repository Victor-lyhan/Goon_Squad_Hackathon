# STATUS (maintained by the planner)

_Last update: 2026-11-14, 15:20 (Sat), planner pass 56 (started 15:08)_

## Current milestone: M8 Integration (target 6:00 p.m. Sat)
One M8 item is left: **the story retune (#492), now in progress with victor-4**. The story still matches 13 of 24 on real travel times. Everything else in M8 is merged: journey mode with Play journey (PR #502), the end-to-end demo flow on the real cache (PR #507, no bug found), `/nyc` and `/nyc/help` (PR #506). The cutover to the MVP II pages is queued as soon as #492 merges. MVP 1 still runs untouched on `/`.

## HUMAN TO-DO
1. **Open `/nyc/simulator`, `/nyc/business/<id>`, `/nyc/employee/<id>` with the browser key.** No agent has seen the Google map. A rejected key shows Google's grey error box until #510 merges.
2. After #492 merges: `npm run fetch:routes` once more (only new route lines are fetched), commit `polylines.json`. Exit code 0 = the story matches as written.
3. Until #503 merges: delete `data/state-v2.json` before a restart after #492, or the old run comes back.
4. **Before you commit `fixtures/nyc/`: check that you did not save a commute with a real address** (it is written into `matrix.json`; see QUESTIONS pass 56). `git checkout fixtures/nyc` undoes it.
5. Git tag `mvp1` still does not exist.

## Main health: green as far as visible
- Snapshot at 15:08: the two newest finished runs on main are green, the run for PR #506 was in progress. PRs #507, #508, #509 and #517 merged after that with green checks. The planner can't list runs.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (11 issues, all `ready`)
- victor-2: #510 message when Google rejects the browser key; #511 simulator page against the redesign doc (`compose/`, `page/`); #512 simulator views on the real NYC run; #519 simulator page in a real DOM.
- p2-b: #513 Employee workspace on the real NYC run; #518 commute form, address search and page in a real DOM.
- p2-a: #514 Business workspace and homepage on the real NYC run.
- victor-3: #515 keep typed addresses out of git (guard test, `--drop-entered`); #520 a failed new-address save leaves nothing in the travel service.
- victor-4: #516 whole simulated day on the real cache. `ready` is back on #482 (timed tests).
- victor-1: #521 broken-request sweep of every `/api/v2` write route.

## In progress
- victor-4: **#492 story retune**. Then #482, #493 (matcher on the real cache), #516.
- victor-1: #503 a changed story starts a fresh NYC run. victor-3: #515.

## Merged since pass 55 (15:03)
- victor-1: PR #507 (#494) end-to-end demo flow on the real cache, restart and commute included; PR #517 (#495) poll budget on the real run, every number inside its budget (largest Random city poll 141.5 KB of 150 KB).
- p2-a: PR #508 (#505) jsdom harness; it found and fixed three bugs in the New delivery form (no shipment ID on the result, Esc did nothing, focus lost on close). PR #506 (#504) `/nyc` and `/nyc/help`.
- victor-4: PR #509 (#481) story explainer `explainShipment`. victor-2: PR #502 (#496) Play journey. victor-3: PR #501 (#498).

## Next up (each needs the issues in brackets merged first)
- p2-a: cutover of `/`, `/help`, `/business/:id`, `/employee/:id`, `/simulator` to MVP II, header text "Real NYC locations · simulated deliveries" [#492, #514]. Then each owner deletes its MVP 1 files.
- victor-1: README demo steps with the live demo request pinned by a test, and the `--drop-entered` line [#492, #503, #515].
- victor-3: print `explainShipment` for failed story rows in the fetch command [#515, same file].
- Fix issues for whatever the real-data and DOM tests leave as `it.fails` [#512, #513, #514, #518, #519].

## Known bugs / gaps
- **The default NYC scenario matches 13 of 24** and the story rows are not as written (#492). The demo flow itself works on it: 5 direct and 8 relay plans (PR #507).
- **A typed home address is written into the committed `fixtures/nyc/matrix.json`** as `home-c-<lat>_<lng>`, also when its save failed (#515, #520).
- A restart keeps the old saved NYC run after the story changes (#503).
- A rejected browser key shows Google's own error box, not ours (#510).
- No test runs the Employee or simulator page in a DOM yet (#518, #519), and no UI test uses real NYC responses (#512 to #514).
- The default detour limit is still 8 in `shared/v2/schemas.ts`; #492 changes it to 12.
- Route lines exist only for the old story's plans; after the retune a human fetch adds the new ones.
- This planner run can't use `gh run list`, `gh pr list`, `npm` or `tsx`; it reads PRs one by one.
