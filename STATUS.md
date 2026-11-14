# STATUS (maintained by the planner)

_Last update: 2026-11-14 04:40 (Sat), planner pass 11_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Pass 10's queue: 5 merged and 9 PRs open for review. This pass queues the CI fix, the §8 metrics follow-up, cross-portal consistency, API hardening, reduced motion (M6 item) and §3A/§3B audits.

## Main health: RED (flaky timeout, not broken code)
- The latest finished main run (at #201 / issue #184) failed, and so did the PR runs for #200, #201 and #202. In each one, the only failure is `tests/domain/generator-quality.test.ts` › "has matches for every default seed…", which takes 7.2 s against the 5 s vitest timeout. The other 95 files and 774 tests pass.
- Fix queued: **#213 (p1-b, P0)**. Runs for #202/#203 were still going at 04:40.

## Stuck
- #197 (p1-b metrics §8) asked for a new `Metrics` field in `shared/`. Decided no contract change (DECISIONS pass 11). Closed and replaced by #214 (p1-b) plus the UI label in #218 (victor-2).

## In review (10 PRs)
- p1-b: PR #211 (#198) snapshotAt perf + marker continuity · #199 pricing §8 in progress
- victor-1: PR #206 (#185) two-tab sync · PR #208 (#186) playback endgame
- victor-2: PR #204 (#189) Setup drawer confirm/errors · PR #209 (#190) scrubber keyboard + ticks
- p2-a: PR #205 (#192) §3A copy · PR #207 (#193) UI kit/formatter · PR #210 (#194) landing live summary
- p2-b: PR #182 (#166) earnings + 390 px: **needs-fix**

## Queued (label `ready`)
- p1-b: **#213 CI timeout (do first)** · #214 per-trip metrics + projected = actual
- victor-1: #215 portals agree with the simulator · #216 bad-body sweep on mutating routes · #217 client/src/api ↔ server route parity
- victor-2: #218 metrics cards §4/§8 + external-cost label · #219 reduced-motion markers · #220 map legibility · #221 playback bar end states
- p2-a: #222 reduced motion + focus rings · #223 package lists §3A · #224 route maps · #225 shell resilience
- p2-b: #195 commute editor §3B · #226 job detail §3B · #227 portal reconnect / runId change
- p1-a: #134 matcher edge cases · #136 spec test 10. Both have been `ready` since pass 9 with no pickup (see QUESTIONS).

## Next up
- After #213 merges: confirm main is green. If the slow part turns out to be `matching.ts`, queue a matcher perf issue for p1-a.
- p2-b: once PR #182 is fixed and merged, the 390 px job feed / EmployeePortalView pass.
- Fixes for any `it.fails` tests left by #215–#217 (shipments.ts/simulator.ts, once PRs #206/#208 merge).
- M6 (11 p.m. Sat): bug fixes only, from the humans' list. A human two-tab browser walkthrough (spec §10) and a fresh-clone `npm install && npm run dev` check are still needed.

## Done (newest first)
- PR #203 (#191) p2-a: send-form edge cases §3A
- PR #202 (#188), #200 (#187) victor-2: queue/detail keyboard pass; run change / reconnect on simulator page
- PR #201 (#184), #196 (#183), #181 (#154), #178 (#153) victor-1: state-file restart/corruption; production deep links + README; poll budget; JSON 404s
- PR #180 (#165), #176 (#164), #174 (#163) p2-b: job card §3B; stale employee links; "New" job badge
- PR #179 (#162), #175 (#161) p2-a: business 390 px + drawer focus; shell 404/skip link
- PR #177 (#158) victor-2: simulator layout + a11y
- PR #173 (#157), #172 (#152), #171 (#160), #170 (#156), #168 (#155), #167 (#151): real-data playback, random/zero-hub flow, no-match retry, ComparePanel, Recompute
- Earlier (M0–M5): see git log and previous STATUS versions

## Known bugs / gaps
- Main CI red from the generator-quality timeout (#213).
- `metrics.ts` averages added minutes per leg, not per trip, and can report negative savings if price > courier (#214).
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- p1-a has picked up nothing since pass 9.
