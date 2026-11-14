# STATUS (maintained by the planner)

_Last update: 2026-11-14, 17:35 (Sat), planner pass 63 (started 17:22)_

## Current milestone: MVP III (docs/mvp3.md, added 5:15 p.m.), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. Order P1 simulator readability, P2 removals, P3 story retune, P4 restyle. Issues are tagged P1 to P4. M9 polish issues still open finish as they are, unless mvp3 removed their feature (closed: #604, #625, #630, #639).

## HUMAN TO-DO
1. **GitHub Actions still not running (billing).** The 3 latest runs on main are red for that reason; reviewers run `bash scripts/test.sh` locally. Fix in GitHub Settings, Billing & plans.
2. **Open `/simulator` with the browser key** once #648 and #649 merge. Nobody has seen the map; the MVP III look can only be judged there.
3. Overrule the MVP III calls of this pass in QUESTIONS.md if you disagree (one Play/Pause and network play at speed 120; night 4:30 PM to 6:45 AM; Navy Yard found by label; `@fontsource/inter`; story targets).
4. Watch QUESTIONS.md for "NEEDS FETCH" lines from #650, then run `npm run fetch:routes -- --drop-entered` and commit `fixtures/nyc/`.
5. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health: no code failure known; CI cannot run (billing)
- The runs of #643, #642 and the MVP III spec commit failed; same billing cause as every run since 16:19. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (6 new, 1 extended)
- P1+P2 #648 one Play/Pause, overnight card, `?play=1`, delete speed/scrubber/next event/Scenario/Planning/Layers/key hints (victor-8).
- P1 #649 day and night on the map, sun/moon and time (victor-10).
- P1 #653 HTTP test of the Navy Yard journey: relay, 2 carriers, 3 businesses, overnight at the relay (victor-6).
- P2 #623 extended: also deletes the Help page (victor-5).
- P3 #650 story retune: 24/24 matched, 12+ relays, 2+ directs, cached pairs only (victor-7).
- P4 #651 tokens: colors, 6 px radius, Inter + Plex Mono (victor-9); #652 homepage with "Watch a package" (victor-1).

## In progress / in review
- In review: PR #646 (#628 delete the MVP 1 API, victor-1), PR #645 (#633 Employee announces a new delivery, victor-9), PR #644 (#597 Employee poller, victor-6).
- In progress: #595 route hover text (victor-7), #608 delete the SVG city map (victor-2), #609 Business table at 390 px (victor-5), #624 clock back to start after a new delivery (victor-3), #626 departure once (victor-6), #627 commute save re-plans (victor-4), #640 fetch command hides typed homes (victor-9).
- Ready: #635 one set of status words (victor-2), #636 header lists retry (victor-5), #637 README for a fresh clone (victor-3).

## Merged since pass 62 (17:10)
- PR #643 (#631) Inspector opens when a journey starts; PR #642 (#634) Employee job screens; PR #641 (#602) address search deadline and five boroughs only; PR #632 (#532) left-panel controls over HTTP; PR #629 (#607) simulator keys; PR #619 (#581) Business page 1320 px and relay point.

## Next up (each needs the issues in brackets merged first)
- P1 journey map: carrier full commute thin in A/B colors (blue `#1D5075`, green `#0F8A5F`) with the carried part thick; symbols (square sender, diamond "Overnight" relay, swap icon at the handoff, flag at delivery) with short labels; package marker 2x, orange `#E8590C`, halo, on top; other places at 30% during playback; letter badges in JourneyLegend; no "Leg 2" row for a direct journey [#595: same `map/layers.ts`, `map/types.ts`, `journey/journeyModel.ts`].
- P1 journey timeline with the same symbols instead of numbers [#635, same `JourneyTimeline.tsx`].
- P2 after #648: delete the hook's `generate` / `recompute` / `resetPlanning` and the leftover controls fields in `simPageView.ts` [#648, #649].
- P4 lighter restyle passes: simulator, Business, Employee pages [#651, and #648/#649 for the simulator].
- README: MVP III demo steps ("Watch a package"), no Help page [#637, #623].
- From pass 62, still valid: the Business header's "can be edited" sentence; "Find a delivery match" button label; `createRng` move and MVP 1 engine deletion (step 3) [#628].

## Known bugs / gaps
- A delivery added after a preview shows as delivered and paid (#624). A commute save for a carrier leaves a 404 job (#627).
- Header links open the first account, not the one on screen (#623); stay greyed after a failed load (#636).
- A route's hover text has no name (#595). Employee departure shown twice (#626). Business rows break at 390 px (#609).
- README says Node 22; Vite needs 22.12+ (#637). `PORT` does not work with `npm run dev` (needs your config change).
- This planner run cannot use `gh run list`, `node` or `npm`; it read the checkout at 12179fc (main after PR #643).
