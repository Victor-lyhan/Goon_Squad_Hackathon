# STATUS (maintained by the planner)

_Last update: 2026-11-14 05:30 (Sat), planner pass 14_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Since pass 13, 12 PRs merged. 10 PRs are waiting for review. This pass queued 3 issues (#286–#288), following DECISIONS pass 13 (no filler): they move polls onto the AbortSignal support from #266. No `it.fails` tests are left on main.

## Main health: GREEN
- The last finished main runs (#245/PR #266, #252/PR #265) passed. The run for #254/PR #267 was still going at 05:26.

## Stuck
- None labelled `stuck`.

## In review (10 PRs)
- p1-b: PR #270 (#255) simulation.ts §7 audit · PR #283 (#256) spec test 7 determinism
- victor-1: PR #269 (#247) notifications across cycles · PR #279 (#272) clean shutdown + busy port
- victor-2: PR #268 (#250) compare honesty · PR #278 (#273) package queue §3C · PR #281 (#274) map on the largest city
- p2-a: PR #280 (#275) business reconnect / runId · PR #282 (#276) tracking drawer §3A · PR #284 (#277) accessible toasts

## In progress
- p1-b: #271 metrics at every event minute (test-only)

## Queued (label `ready`)
- p1-a: #134 matcher edge cases · #136 spec test 10 · #257 routing insertion · #259 matcher property tests. **Nothing picked up since pass 9.**
- victor-1: **#286** cancellable health probe in client/src/api
- victor-2: **#287** simulator polls: abort on unmount/runId change, Reconnecting note
- p2-b: **#288** employee polls: abort on unmount and identity switch (A's data never shown under B)
- p2-a: nothing new. 3 PRs are in review, and its other free files have been audited already.
- p1-b: nothing new. simulation.ts and the metrics tests are in open PRs/issues.

## Next up
- After #286 merges: p2-a switches `client/src/ui/connectionModel.ts` to the new probe (no raw `fetch` in the UI).
- After #280 merges: check the business hook also aborts on unmount/business switch (mirror of #288).
- Fixes for any `it.fails` left by #255/#256/#271 (owner's file, next pass).
- M6 (11 p.m. Sat): bug fixes only, from the humans' list. A human two-tab browser walkthrough (spec §10) and a fresh-clone `npm install && npm run dev` check are still needed.

## Done (newest first)
- PR #267 (#254) p1-b: generator §5 audit
- PR #266 (#245), #262 (#244), #258 (#243) victor-1: abortable GETs + timeouts; ticker under load; documented live demo request
- PR #265 (#252), #263 (#251) p2-a: send-form result flow; notification toasts + list
- PR #264 (#249), #260 (#248) victor-2: Setup drawer ranges §5; selected-package panel §3C
- PR #261 (#253), #246 (#227), #242 (#226) p2-b: job feed; reconnect/runId; job detail §3B
- PR #241 (#195) p2-b: commute editor §3B audit
- PR #240 (#214), #234 (#213) p1-b: per-trip metrics + projected = actual; CI timeout fix
- PR #239 and earlier: see git log

## Known bugs / gaps
- p1-a (Codex) has picked up nothing since pass 9. Matcher edge cases (#134) and spec test 10 (#136) are untested at the domain level.
- `client/src/ui/connectionModel.ts` calls `fetch('/api/health')` directly, against the client/src/api rule (fixed by #286 + a p2-a follow-up).
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- Setup drawer CRUD (nice-to-have 16) is blocked on `shared/` contracts.
