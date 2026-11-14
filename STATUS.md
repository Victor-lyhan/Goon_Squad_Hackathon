# STATUS (maintained by the planner)

_Last update: 2026-11-14, 15:40 (Sat), planner pass 57 (started 15:26)_

## Current milestone: M9 Polish (target 10:00 p.m. Sat)
**M8 is done.** The story retune merged at 15:33 (PR #527): the default NYC scenario matches **24 of 24**, every story row as written, default detour limit 12, no home moved. What is left in M9: **the cutover of `/`, `/business`, `/employee`, `/simulator` to the MVP II pages** (waits only for the PR of #529, which edits the same `App.tsx`), the README demo steps (after the cutover, so the paths are written once), and the fixes below.

## HUMAN TO-DO
1. **Open `/nyc/simulator`, `/nyc/business/<id>`, `/nyc/employee/<id>` with the browser key.** No agent has seen the Google map. A rejected key now shows our own message with the setting to fix (PR #525).
2. **`npm run fetch:routes` once more** for the route lines of the new story (only new lines are fetched), then `npm run fetch:routes -- --drop-entered`, then commit `fixtures/nyc/`. Exit code 0 = the story matches as written.
3. A restart now starts from the new story by itself (PR #523); the old run is kept as `data/state-v2.json.stale-<n>`.
4. On `/nyc` pages "Watch in simulator" and "Watch this package" open the **old** simulator until the cutover. Use the header's Simulator link.
5. Git tag `mvp1` still does not exist.

## Main health: green
- The three newest runs on main at 15:26 are green. Seven PRs merged since (#522 to #527, #534). This session cannot list runs or fetch.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (10 issues, all `ready`)
- victor-1: #535 **relay business gets no notification (bug from PR #524)**; #536 fetch missing route lines when a map is asked for; #532 the simulator's left panel over HTTP on the real cache; #533 the three workspaces agree on the real run.
- victor-2: #528 an open simulator tab picks up route lines that arrive late.
- victor-3: #530 measure a commute save against a slow or silent Google; #538 explain a failed story row in the fetch command.
- victor-4: #531 metrics on the real cache. p1-b: #540 simulated-day tests without the story file.
- p2-a: #529 page-crash fallback and the header in a real DOM.

## In progress / in review
- victor-1 #521 (broken-request sweep). victor-2 #519 (simulator in a real DOM); PR #537 (#511) in review. victor-3 #530. victor-4 #516 (a whole day on the real cache).
- p2-a #529. p2-b #518 (Employee page in a real DOM). p1-b #512 (simulator views on the real run). p1-a: PR #539 (#482) in review, then #493.

## Merged since pass 56 (15:20)
- victor-4: PR #527 (#492) story retune, 24 of 24. It lists four live demo requests that match (two direct, two relay).
- victor-1: PR #523 (#503) a changed story starts a fresh run. victor-2: PR #525 (#510) message for a rejected browser key.
- victor-3: PR #522 (#515) guard test and `--drop-entered`; PR #526 (#520) a failed save leaves no place behind.
- p2-a: PR #524 (#514) Business and homepage on the real run; found the relay notification bug. p2-b: PR #534 (#513) Employee on the real run; fixed "+0 km" for a negative extra distance.

## Next up (each needs the issues in brackets merged first)
- p2-a: **the cutover**, header text "Real NYC locations · simulated deliveries", `/nyc/...` kept as redirects [#529]. Then each owner deletes its MVP 1 files (p2-a keeps `business/trackingModel.ts`, the MVP II details import it).
- victor-1: README demo steps with one of the four live requests of PR #527 pinned by a test [cutover].
- victor-3: a deadline for the live commute fetch, if #530 measures more than 10 s [#530].
- Fix issues for whatever #512, #518, #519, #521, #532 and #533 leave as `it.fails`.

## Known bugs / gaps
- **A business that is only a relay point is not told** it holds a package; its workspace shows nothing about it (#535).
- An open simulator tab draws no route for a delivery created live, because it loads the map before the lines arrive (#528). Reloading the tab fixes it.
- Plans from a commute re-match, Recompute, Random city or an import get no route lines (#536). The new story's lines are not fetched yet (to-do 2).
- A page that throws shows a blank screen (#529).
- Nobody knows how long a commute save waits when Google is slow; up to 15 s per attempt is possible (#530).
- The Employee job detail shows a negative extra distance ("-5.5 km") when the detour is shorter but slower. It is the real value.
- This planner run can't use `gh run list`, `gh pr list`, `gh api`, `git fetch`, `npm` or `tsx`; it reads PRs one by one.
