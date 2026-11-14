# STATUS (maintained by the planner)

_Last update: 2026-11-14 04:25 (Sat), planner pass 10_

## Current milestone: all spec items done → verification, edge cases and demo polish (M6 freeze at 11 p.m. Sat)
Must-haves 1–10 and nice-to-haves 11–15 are merged, plus the scrubber and Duplicate request from 16. Setup drawer CRUD (16) is still cut until `shared/` has the contracts (QUESTIONS.md). Pass 9's queue mostly merged in 7 minutes (PRs #167–#173). This pass queues production-mode and restart checks, two-tab sync, playback endgame, spec §3A/§3B/§8 audits, and simulator/landing polish.

## Main health
- CI on main: green at PR #173 (#157). Runs for #172 (#152) and #171 (#160) failed, and the next merge (#173) fixed main. No `stuck` items, and no `it.fails` tests left in `tests/`.

## In review (9 PRs)
- victor-1: PR #178 (#153) JSON 404 test · PR #181 (#154) poll budget test
- victor-2: PR #177 (#158) simulator layout + a11y
- p2-a: PR #175 (#161) shell 404/skip link · PR #179 (#162) business 390 px + drawer focus trap
- p2-b: PR #174 (#163) "New" job badge · PR #176 (#164) stale employee links · PR #180 (#165) job card §3B audit · PR #182 (#166) earnings + 390 px
- Already opened this pass: PR #196 (#183)

## Queued (label `ready`), 18 issues
- victor-1: #183 production deep links + README build steps · #184 state-file restart/corruption · #185 two-tab sync + concurrent double-submit · #186 playback endgame (600x to 2160, controls at the end)
- victor-2: #187 run change / reconnect on simulator page · #188 package queue + detail keyboard pass · #189 Setup drawer confirm + error states · #190 timeline scrubber keyboard + event ticks
- p2-a: #191 send-form edge cases (§3A) · #192 business copy audit (§3A) · #193 UI kit/formatter audit · #194 landing live city summary + 390 px
- p2-b: #195 commute editor §3B audit (only free p2-b files; the rest are in 4 open PRs)
- p1-b: #199 pricing §8 audit · #197 metrics §8 audit (extra distance once per trip) · #198 snapshotAt perf + marker continuity
- p1-a: #134 matcher edge cases · #136 spec test 10 (test-only). Nothing new: #134 covers every p1-a file.

## Next up
- p2-b: queue more once PRs #174/#176/#180/#182 merge and free the portal files (job detail §3B audit, 390 px job feed).
- p1-a: after #134/#136, queue a check that matching honors `maxExtraMin` per direction with waypoints on random cities.
- Fixes found by this pass's audits (`it.fails` tests naming another owner's file).
- M6 (11 p.m. Sat): bug fixes only, from the humans' list. A human two-tab browser walkthrough (spec §10) is still needed.

## Done (newest first)
- PR #173 (#157), #170 (#156), #168 (#155) victor-2: real-data playback test; ComparePanel proof slide; Recompute button + step-7 hint
- PR #172 (#152), #167 (#151) victor-1: random/zero-hub/no-match API flow + export/import; full Demo-city run test
- PR #171 (#160), #169 (#159), #147 (#126) p2-a: no-match → edit/retry/duplicate; stale business links; business playback test
- PR #150 (#138), #149 (#137) p1-b: generator quality; sim/metrics edge runs
- PR #148 (#133) p2-b: commute editor edge states
- PR #146 (#130), #143 (#128), #140 (#127) victor-2: large/zero-hub map; playback shortcuts; `/simulator?package=`
- PR #145 (#132), #141 (#131) p2-b: job detail links + live progress; employee playback test
- PR #144 (#125), #139 (#124) p2-a: carrier/simulator links; landing "Run the demo" strip
- PR #142 (#123), #135 (#122), #129 (#121) victor-1: planning-cycle flow; README; scenario routes
- Earlier (M0–M5): see git log and previous STATUS versions

## Known bugs / gaps
- Nobody has done a real two-tab browser walkthrough. All checks so far are server-side renders and API tests.
- Production mode (`npm run build && npm start`) and restart behaviour are untested until #183/#184 merge.
