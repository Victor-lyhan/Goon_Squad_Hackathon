# STATUS (maintained by the planner)

_Last update: 2026-11-14 04:55 (Sat), planner pass 12_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Pass 11's queue: 5 merged, 12 PRs open. This pass queues 15 issues: a locked-in live demo request, §5/§6/§7 domain audits, spec test 7 end to end, clock under load, and portal/simulator polish.

## Main health: RED (known flaky timeout, fix ready)
- The latest finished main run (#222 / PR #228) failed only on `tests/domain/generator-quality.test.ts` › "has matches for every default seed…" (6.7 s vs the 5 s timeout). Same failure as pass 11, so no new fix issue.
- Fix: **PR #234 (#213, p1-b)** is green in CI and waiting for review. **Reviewer: merge #234 first.** Runs for #215/#218 were still going at 04:55.

## Stuck
- None labelled `stuck`.

## In review (12 PRs)
- p1-b: **PR #234 (#213) CI timeout fix** · PR #240 (#214) per-trip metrics + projected = actual
- victor-1: PR #231 (#216) bad-body sweep · PR #235 (#217) client/src/api ↔ server parity · PR #258 (#243) live demo request
- victor-2: PR #232 (#219) reduced-motion markers · PR #236 (#220) map legibility · PR #238 (#221) playback bar end states
- p2-a: PR #233 (#223) package lists §3A · PR #237 (#224) route maps · PR #239 (#225) shell resilience
- p2-b: PR #246 (#227) reconnect / runId change
- Note: PRs #233 and #237 both edit `business/tracking.css`; the second to merge may need a rebase.

## Queued (label `ready`)
- p1-a: #134 matcher edge cases · #136 spec test 10 · #257 routing insertion (test-only) · #259 matcher property tests (test-only). Nothing picked up since pass 9.
- p1-b: #254 generator §5 audit · #255 simulation §7 audit · #256 spec test 7 determinism (test-only)
- victor-1: #244 ticker/state writes under load · #245 client/src/api abort + timeout · #247 notifications across planning cycles
- victor-2: #248 selected-package panel §3C · #249 Setup drawer ranges §5 · #250 compare panel honesty
- p2-a: #251 notification toasts · #252 send-form result flow (demo step 3)
- p2-b: #195 commute editor §3B · #226 job detail §3B · #253 job feed across the run
- p2-a got 2 (not 4) because most of its files are in open PRs, and the pass hit 15 of 16 issues.

## Next up
- After #234 merges: confirm main is green.
- After #233/#237/#239 merge: p2-a business-portal reconnect / runId change (mirror of #227, needs `BusinessPortal.tsx`).
- After #245 merges: hooks may switch to `isNetworkError`/AbortSignal (simulator + business polls).
- Fixes for any `it.fails` left by #254–#259 (owner's file, next pass).
- M6 (11 p.m. Sat): bug fixes only, from the humans' list. A human two-tab browser walkthrough (spec §10) and a fresh-clone `npm install && npm run dev` check are still needed.

## Done (newest first)
- PR #230 (#218) victor-2: metrics cards §4/§8 + external-cost label
- PR #229 (#215) victor-1: portals agree with the simulator over HTTP
- PR #228 (#222) p2-a: app-wide reduced motion + focus rings
- PR #212 (#199), #211 (#198) p1-b: pricing §8 audit; snapshotAt perf + marker continuity
- PR #210 (#194), #207 (#193), #205 (#192) p2-a: landing live summary; UI kit/formatter audit; §3A copy
- PR #209 (#190), #204 (#189) victor-2: scrubber keyboard + ticks; Setup drawer confirm/errors
- PR #208 (#186), #206 (#185) victor-1: playback endgame; two-tab sync
- PR #182 (#166) p2-b: employee earnings + 390 px
- PR #203 (#191), #202 (#188), #201 (#184), #200 (#187), #196 (#183) and earlier: see git log

## Known bugs / gaps
- Main CI red from the generator-quality timeout until #234 merges.
- `metrics.ts` averages added minutes per leg, not per trip, and can report negative savings (fix in PR #240).
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- p1-a has picked up nothing since pass 9.
