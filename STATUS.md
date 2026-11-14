# STATUS (maintained by the planner)

_Last update: 2026-11-14 05:45 (Sat), planner pass 15_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Since pass 14, 9 PRs merged (#268–#270, #278–#283). 8 PRs are waiting for review. **p1-a (Codex) is working again:** PRs #292, #293 and #294 are open for #134, #136 and #257. This pass queued 1 issue (#295). No `it.fails` tests are left on main.

## Main health: GREEN
- The last finished main run (#274/PR #281) passed. Runs for #276/PR #282 and #256/PR #283 were still going at 05:39.

## Stuck
- None labelled `stuck`.

## In review (8 PRs)
- p1-a: PR #292 (#134) matcher edge cases · PR #293 (#136) spec test 10 · PR #294 (#257) routing insertion §6
- p1-b: PR #285 (#271) metrics at every event minute
- victor-1: PR #289 (#286) cancellable health probe
- victor-2: PR #290 (#287) simulator polls abort/Reconnecting
- p2-a: PR #284 (#277) accessible toasts
- p2-b: PR #291 (#288) employee polls abort on identity switch

## Queued (label `ready`)
- p1-a: #259 matcher property tests on 20 seeds
- p2-a: **#295** business portal + landing polls: AbortSignal, abort on unmount/business switch/runId change
- p1-b, victor-1, victor-2, p2-b: nothing new. Their free files are in open PRs or already audited (DECISIONS pass 13: no filler).

## Next up
- After #289 (#286) merges: p2-a switches `client/src/ui/connectionModel.ts` to the new probe (no raw `fetch` in the UI). Wait for #284 to merge too (same folder).
- Fixes for any `it.fails` left by #285/#292/#293/#294 (owner's file, next pass).
- M6 (11 p.m. Sat): bug fixes only, from the humans' list. A human two-tab browser walkthrough (spec §10) and a fresh-clone `npm install && npm run dev` check are still needed.

## Done (newest first)
- PR #283 (#256), #270 (#255), #267 (#254) p1-b: spec test 7 determinism; simulation.ts §7 audit; generator §5 audit
- PR #282 (#276), #280 (#275), #265 (#252), #263 (#251) p2-a: tracking drawer §3A; business reconnect/runId; send-form result flow; notification toasts
- PR #281 (#274), #278 (#273), #268 (#250), #264 (#249) victor-2: map on the largest city; package queue §3C; compare honesty; Setup drawer ranges
- PR #279 (#272), #269 (#247), #266 (#245), #262 (#244) victor-1: clean shutdown + busy port; notifications across cycles; abortable GETs; ticker under load
- PR #261 (#253), #246 (#227), #242 (#226) p2-b: job feed; reconnect/runId; job detail §3B
- PR #240 (#214), #234 (#213) p1-b: per-trip metrics + projected = actual; CI timeout fix
- PR #239 and earlier: see git log

## Known bugs / gaps
- `client/src/ui/connectionModel.ts` calls `fetch('/api/health')` directly, against the client/src/api rule (fixed by #286 + a p2-a follow-up).
- The business portal hook polls without an AbortSignal, so a slow response could land after a business switch (#295).
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- Setup drawer CRUD (nice-to-have 16) is blocked on `shared/` contracts.
