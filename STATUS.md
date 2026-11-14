# STATUS (maintained by the planner)

_Last update: 2026-11-14 05:12 (Sat), planner pass 13_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Since pass 12, 15 PRs merged, including the CI fix #234. 13 PRs are waiting for review. This pass queued 7 issues (#271–#277), not 16: almost every file is in an open PR, and spec §3/§10 is already well covered by tests.

## Main health: GREEN
- PR #234 (timeout fix) merged. The latest finished main run (#225 / PR #239) passed. Runs for #241 and #240 were still going at 05:12.

## Stuck
- None labelled `stuck`.

## In review (13 PRs)
- p1-b: PR #267 (#254) generator §5 audit
- victor-1: PR #258 (#243) live demo request · PR #262 (#244) ticker under load · PR #266 (#245) abort + timeout · PR #269 (#247) notifications across cycles
- victor-2: PR #260 (#248) package panel §3C · PR #264 (#249) Setup drawer ranges · PR #268 (#250) compare honesty
- p2-a: PR #263 (#251) notification toasts · PR #265 (#252) send-form result flow
- p2-b: PR #242 (#226) job detail §3B · PR #246 (#227) reconnect / runId · PR #261 (#253) job feed

## In progress
- p1-b: #255 simulation.ts §7 audit

## Queued (label `ready`)
- p1-a: #134 matcher edge cases · #136 spec test 10 · #257 routing insertion · #259 matcher property tests. **Nothing picked up since pass 9.**
- p1-b: #256 spec test 7 determinism · **#271** metrics at every event minute (test-only)
- victor-1: **#272** clean shutdown on Ctrl-C + busy-port message
- victor-2: **#273** package queue §3C · **#274** map on the largest random city
- p2-a: **#275** business portal reconnect / runId (mirror of #227) · **#276** tracking drawer §3A · **#277** accessible toasts
- p2-b: nothing new. Every file it owns is in an open PR or was just audited (#241).

## Next up
- After #266 merges: hooks may switch to `isNetworkError`/AbortSignal (simulator, business, employee polls).
- Fixes for any `it.fails` left by #254–#259 and #271 (owner's file, next pass).
- M6 (11 p.m. Sat): bug fixes only, from the humans' list. A human two-tab browser walkthrough (spec §10) and a fresh-clone `npm install && npm run dev` check are still needed.

## Done (newest first)
- PR #241 (#195) p2-b: commute editor §3B audit
- PR #240 (#214), #234 (#213) p1-b: per-trip metrics + projected = actual; CI timeout fix
- PR #239 (#225), #237 (#224), #233 (#223), #228 (#222) p2-a: shell resilience; route maps; package lists §3A; reduced motion + focus
- PR #238 (#221), #236 (#220), #232 (#219), #230 (#218) victor-2: playback end states; map legibility; reduced-motion markers; metrics cards
- PR #235 (#217), #231 (#216), #229 (#215) victor-1: client/src/api ↔ server parity; bad-body sweep; portals agree with simulator
- PR #212 (#199), #211 (#198) p1-b: pricing §8 audit; snapshotAt perf
- PR #210 and earlier: see git log

## Known bugs / gaps
- p1-a (Codex) has picked up nothing since pass 9. Matcher edge cases (#134) and spec test 10 (#136) are untested at the domain level.
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- Setup drawer CRUD (nice-to-have 16) is blocked on `shared/` contracts.
