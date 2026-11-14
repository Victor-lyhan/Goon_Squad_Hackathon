# STATUS (maintained by the planner)

_Last update: 2026-11-14 06:02 (Sat), planner pass 17_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Since pass 16, #298 merged (PR #299). **No open PRs, no open issues before this pass.** This pass queued 1 issue (#300, P0 CI fix).

## Main health: RED
- The last 3 main runs failed: PR #297 (#259), the planner commit at 05:52, and PR #299 (#298). The first failure is #297's merge, which only added `tests/domain/matching-properties.test.ts` (50 sync tests, 5 s timeout each, 7.9 s total locally). Likely the same CI-runner timeout as #213.
- Fix queued: **#300** (p1-a, top priority). The planner can't read run logs (`gh run list`/`gh run view` need approval), so #300 starts by confirming the failing test from the log. If it's outside p1-a's files, the worker writes BLOCKED.md and the next pass re-routes it.

## Stuck
- None labelled `stuck`.

## In review
- None.

## Queued (label `ready`)
- p1-a: **#300** [P0] make matching-properties tests fast on CI (city cache per seed, Map edge lookup, CI-sized timeouts).
- p1-b, victor-1, victor-2, p2-a, p2-b: nothing. Their areas are covered by spec tests and audits (DECISIONS pass 13: no filler). Waiting on the humans' M6 bug list.

## Next up
- Get main green (#300). Then M6 (11 p.m. Sat): bug fixes only, from the humans' list. Still needed from humans: a two-tab browser walkthrough (spec §10) and a fresh-clone `npm install && npm run dev` check.

## Done (newest first)
- PR #299 (#298) p2-a: connection banner uses the `client/src/api` health probe, no overlapping probes (no raw `fetch` left in UI code)
- PR #297 (#259), #294 (#257), #293 (#136), #292 (#134) p1-a: matcher property tests on 20 seeds; routing insertion §6; spec test 10; matcher edge cases
- PR #285 (#271), #283 (#256), #270 (#255), #267 (#254) p1-b: metrics at every event minute; spec test 7; simulation §7 audit; generator §5 audit
- PR #296 (#295), #284 (#277), #282 (#276), #280 (#275) p2-a: business poll cancellation; accessible toasts; tracking drawer §3A; reconnect/runId
- PR #290 (#287), #281 (#274), #278 (#273), #268 (#250) victor-2: simulator poll cancellation; map on the largest city; package queue §3C; compare honesty
- PR #289 (#286), #279 (#272), #269 (#247), #266 (#245) victor-1: health probe in client/src/api; clean shutdown + busy port; notifications across cycles; abortable GETs
- PR #291 (#288), #261 (#253), #246 (#227) p2-b: employee poll abort on identity switch; job feed; reconnect/runId
- PR #240 and earlier: see git log

## Known bugs / gaps
- Main CI red since PR #297 (#300).
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- Setup drawer CRUD (nice-to-have 16) is blocked on `shared/` contracts.
