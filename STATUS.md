# STATUS (maintained by the planner)

_Last update: 2026-11-14 05:51 (Sat), planner pass 16_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Since pass 15, all 8 PRs in review and the 2 queued issues merged (#284–#297). **No open PRs, no open issues before this pass.** No `it.fails` tests are on main. This pass queued 1 issue (#298).

## Main health: GREEN (pending)
- The last finished main run (pass 15) passed. Runs for #259/PR #297, #295/PR #296 and #257/PR #294 were still going at 05:51. The planner can't read run results this pass (`gh run list` needs approval); next pass re-checks.

## Stuck
- None labelled `stuck`.

## In review
- None.

## Queued (label `ready`)
- p2-a: **#298** connection banner uses the `client/src/api` health probe, aborts on unmount, no overlapping probes (last raw `fetch` in UI code).
- p1-a, p1-b, victor-1, victor-2, p2-b: nothing. Their areas are covered by spec tests and audits (DECISIONS pass 13: no filler). Waiting on the humans' M6 bug list.

## Next up
- M6 (11 p.m. Sat): bug fixes only, from the humans' list. Still needed from humans: a two-tab browser walkthrough (spec §10) and a fresh-clone `npm install && npm run dev` check.

## Done (newest first)
- PR #297 (#259), #294 (#257), #293 (#136), #292 (#134) p1-a: matcher property tests on 20 seeds; routing insertion §6; spec test 10; matcher edge cases
- PR #285 (#271), #283 (#256), #270 (#255), #267 (#254) p1-b: metrics at every event minute; spec test 7; simulation §7 audit; generator §5 audit
- PR #296 (#295), #284 (#277), #282 (#276), #280 (#275) p2-a: business poll cancellation; accessible toasts; tracking drawer §3A; reconnect/runId
- PR #290 (#287), #281 (#274), #278 (#273), #268 (#250) victor-2: simulator poll cancellation; map on the largest city; package queue §3C; compare honesty
- PR #289 (#286), #279 (#272), #269 (#247), #266 (#245) victor-1: health probe in client/src/api; clean shutdown + busy port; notifications across cycles; abortable GETs
- PR #291 (#288), #261 (#253), #246 (#227) p2-b: employee poll abort on identity switch; job feed; reconnect/runId
- PR #240 and earlier: see git log

## Known bugs / gaps
- `client/src/ui/connectionModel.ts` calls `fetch('/api/health')` directly, and `ConnectionMonitor` can start overlapping probes with no abort (#298).
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- Setup drawer CRUD (nice-to-have 16) is blocked on `shared/` contracts.
