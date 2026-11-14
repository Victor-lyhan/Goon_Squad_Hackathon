# STATUS (maintained by the planner)

_Last update: 2026-11-14 04:09 (Sat), planner pass 9_

## Current milestone: M5 done → verification + demo polish (well ahead of schedule)
All must-haves 1–10 are merged, and so are nice-to-haves 11–15 and the scrubber/Duplicate request from 16. Last pass's queue (#121–#132) merged as PRs #129, #135, #139–#146. The only spec item left is Setup drawer CRUD (16), which is cut pending a `shared/` contract (QUESTIONS.md). This pass queues end-to-end verification over the API (full run, random/zero-hub cities, unknown IDs, poll cost), the Setup drawer Recompute button (demo step 7), the comparison proof panel, and portal edge states.

## Main health
- CI on main: green through PR #144 (#125). Runs for PR #145/#146 were in progress at 04:09. No `stuck` items.

## In review
- PR #149 (#137) p1-b: sim/metrics edge runs · PR #148 (#133) p2-b: commute editor edge states · PR #147 (#126) p2-a: business playback test
- PR #150 (#138) p1-b: generator quality

## Queued (label `ready`), 18 issues
- victor-1: #151 full-run API test (play/finish/rewind) · #152 random/zero-hub/no-match API flow + export/import · #153 JSON 404s + `status` on client errors · #154 poll time/size budget
- victor-2: #155 Setup drawer Recompute button + step-7 hint · #156 ComparePanel proof slide · #157 simulator real-data playback test · #158 simulator layout + a11y
- p2-a: #159 stale business deep links · #160 no-match → edit/retry/duplicate flow · #161 app shell 404/identity switch/skip link · #162 business 390 px + drawer keyboard
- p2-b: #163 "New" job highlight on poll · #164 stale employee deep links · #165 job card spec §3B audit · #166 earnings summary + 390 px
- p1-a: #134 matcher edge cases · #136 spec test 10 (test-only). Nothing new: all p1-a files are in these two.
- p1-b: nothing new. Every p1-b file is in #137/#138.

## Next up
- Fix whatever this pass's tests mark `it.fails` once their owners' files are free.
- p1-a/p1-b: queue follow-ups after #134/#136/#137/#138 merge (pricing §8 audit, extra distance counted once per trip).
- M6 (11 p.m. Sat): bug fixes only, from the humans' list. A human two-tab browser walkthrough (spec §10) is still needed.

## Done (newest first)
- PR #146 (#130), #143 (#128), #140 (#127) victor-2: large/zero-hub map render; playback keyboard shortcuts; `/simulator?package=` deep link
- PR #145 (#132), #141 (#131) p2-b: job detail links + live progress; employee playback test
- PR #144 (#125), #139 (#124) p2-a: carrier/simulator links; landing "Run the demo" strip
- PR #142 (#123), #135 (#122), #129 (#121) victor-1: planning-cycle flow test; README; scenario routes registered
- PR #120 (#105) p1-b: timeline/snapshotAt random invariants · PR #119 (#104) p1-a: matcher random determinism
- PR #118 (#108), #117 (#107), #113 (#106) p2-a: connection banner; business real-data audit; maps
- PR #116 (#110), #112 (#109) p2-b: commute layout + locked state; employee real-data audit
- PR #115 (#102), #111 (#101) victor-1: demo steps 1–6 API test; compare/recompute/reset routes
- PR #114 (#103) victor-2: simulator real-data audit · PR #99 (#82) Setup drawer + ComparePanel
- Earlier (M0–M4): see git log

## Known bugs / gaps
- Nothing in the UI calls `recomputeMatches`, so demo step 7 can't be done from the browser yet (victor-2 issue this pass).
- Nobody has done a real two-tab browser walkthrough. All verification so far is server-side render and API tests.
