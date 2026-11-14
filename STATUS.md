# STATUS (maintained by the planner)

_Last update: 2026-11-14, 16:45 (Sat), planner pass 61 (started 16:24)_

## Current milestone: M9 Polish (target 10:00 p.m. Sat)
The NYC app is the only app a visitor can reach. Step 1 of the MVP 1 deletion is merged for all three client modules (PRs #574, #576, #591); only the SVG city map is left (#608). All seven gaps of pass 60 are merged or in review. This pass: five code audits (simulator, Business and shell, Employee, API, engine and geo) found the next 16 issues (#594 to #605, #607 to #610).

## HUMAN TO-DO
1. **GitHub Actions is not running.** Every check since about 16:19 fails in 1 s with "recent account payments have failed or your spending limit needs to be increased" (run 43642572600). Fix it in GitHub Settings, Billing & plans. Until then a red check means nothing; reviewers run `bash scripts/test.sh` themselves.
2. **Open `/simulator`, `/business/<id>` and `/employee/<id>` with the browser key.** No agent has seen the Google map. Write what looks wrong in QUESTIONS.md and I queue it first.
3. Run `npm run fetch:routes -- --drop-entered` before committing `fixtures/nyc/` again.
4. Optional contract edits in `shared/v2/api.ts` (QUESTIONS pass 61): `runId` on both dashboards; `held: ShipmentView[]` on `BusinessDashboard`; a per-stop state on the Employee job.

## Main health: not broken as far as I can tell; CI cannot run (billing)
- The last real CI run, PR #585's merge result with #577 inside, passed (16:17 to 16:24). The two red runs on main (the #555 merge and the planner commit, both 16:19) started after the limit was hit. I could not open them by ID, so this is a conclusion from the PR checks, not a reading of those two runs.
- PRs #586 to #593 merged with the check red. The reviewer of #587 wrote that the full suite passed locally; I did not check the other seven reviews. No fix issue created.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (16 issues, the cap; #532 back to `ready`)
- Simulator (victor-2): #594 Play journey no longer flickers the left panel; #595 route tooltips name the package and the carrier; #607 Esc, Space and "." work after the scrubber, Packages under Playback; #608 delete the SVG city map.
- Employee (victor-6): #596 a new job's route appears without a reload (in progress); #597 no map download every second during playback; #598 commute editor messages.
- Business and homepage (victor-5): #599 the same poller fix and no "Unknown business" on first load (in progress); #609 table at 390 px, Esc and focus in the details; #610 homepage retries, environment line once.
- API (victor-1): #600 `npm start` start lines and a log line per 500 (in progress); #532 left-panel controls over HTTP.
- Geo (victor-3): #601 a commute save goes ahead of route-line fetches; #602 address search within 7 s and only the five boroughs.
- Engine (victor-4): #603 no "Avery Brooks 2"; #604 Random city at the edges of the form; #605 the §9 tests without the MVP 1 router.

## In progress / in review
- #568 account selector "Name · Employer": in review (PR #606).
- Moved by a human to other workers, in progress: #570 import check (victor-2), #581 Business page 1320 px (victor-4), #582 match result in the form (victor-3).

## Merged since pass 60 (16:19)
- PR #587 (#578) business names on the map; PR #588 (#579) view reset on a new run; PR #590 (#580) inspectors.
- PR #589 (#583) one time format; PR #592 (#584) router links on the Employee page.
- PR #591 (#565) MVP 1 Business portal and synthetic homepage deleted.
- PR #586 (#569) README for the NYC app; PR #593 (#533) the three workspaces agree on the real run.
- PR #585 (#555) commute-save deadline; PR #577 (#536) missing route lines fetched on a map request.

## Next up (each needs the issues in brackets merged first)
- victor-1: delete the MVP 1 API, its tests and the MVP 1 calls in `client/src/api` [#600, same file `server/index.ts`].
- victor-5: retry in `ui/shell.ts`, the last MVP 1 imports in the shell and the unused kit components [#568]; button label "Find a delivery match" with the Help page [#582]; table rows as links [#581, #609].
- victor-4: move `createRng` into the v2 engine, then delete the MVP 1 engine files [the API deletion, #603, #605].

## Known bugs / gaps
- Simulator: Play journey greys out the playback buttons on every step (#594); a hovered route has no name (#595); Esc and Space are dead after the scrubber (#607).
- Employee: a new job has no route line until a reload (#596); wrong "needs the Google key" message when Google is slow (#598).
- Business and Employee pages download the whole map every second during playback (#597, #599).
- Business: relay and unmatched rows break at 390 px (#609). Homepage: links stay disabled if the API was down at load (#610).
- A commute save can get a 503 behind a background route-line fetch (#601). Address search can offer Mount Vernon or Yonkers (#602).
- About three employees are named like "Avery Brooks 2" (#603, expected from the code, not counted).
- The Employee job view marks a stop "done" from the job status only (needs a contract field, QUESTIONS pass 61).
- This planner run can't use `gh run list`, `gh pr list`, `git fetch`, `node` or `npm`; `gh run view <id>` works.
