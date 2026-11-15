# STATUS (maintained by the planner)

_Last update: 2026-11-14, 22:36 (Sat), planner pass 101_

## Current milestone: MVP IV (docs/mvp4.md) done; human-approved post-freeze additions in progress. Code freeze 5 a.m. Rollback tag: `demo-3`.
All three MVP IV tracks are on main (F2, F1, F3 / PR #848). The full demo walk (#847, PR #857) passed: 13 steps in production at 1440 px, 0 console errors, 0 faults on current main. Humans approved (QUESTIONS 22:25) per-plan pricing (#861), the AI what-if advisor (#862 server, #863 UI), and the dark pill as the style for every map control (#864).

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. The demo walk had no key: markers, routes and the dark Play pill over the real map are unseen. Write what looks wrong in QUESTIONS.md.
2. **Pricing changes the demo number:** after #861 the F1 demo sentence costs $10.50 (or $9.50 if its ready→deadline window is ≥ 18 h; the README sentence's window is 18 h, so expect **$9.50**). README and `tests/ui/demo-walk-mvp4` pin $10.00; #861 must update both.
3. **Calls in QUESTIONS pass 98–100** (carrier A vanishes at home; "Demo account" stays; disabled reason as tooltip; #864 restyles existing map controls).
4. **Homepage animation in Safari** (CSS `offset-path`; without it the package rests at the recipient). PR #860 is merged: look at the hero at 821–1000 px, where the framed map is only ~290 px wide (both reviews flagged it). If it's too small, say so in QUESTIONS and I'll queue a breakpoint change.
5. **F1/advisor: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, run `npx tsx scripts/gemini-check.ts "<sentence>"` (PR #805). Without a key the advisor (#862) answers "offline".
6. **Before the real demo, reset the run** (stop server, delete `data/state-v2.json`, start). **Demo machine:** `npm run build` in the checkout with `.env`.
7. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.

## Main health
- CI red = billing (DECISIONS pass 61): runs of #853, the 22:26 QUESTIONS commit and the 22:29 planner commit. PR #860 review: `scripts/test.sh` passed locally (402 files / 7102 tests); CI failed in 1 s. No fix issue.

## Stuck
- Nothing labeled `stuck`. No open PRs.

## Queued this pass: 0 (DECISIONS pass 101)

## In progress / ready
- #864 (victor-7): legend, day/night badge, banners, overnight card → dark translucent pill. CSS in `sim/v2/compose/`, `sim/v2/legend/`, `map/map.css` day/night rules.
- #861 (victor-4, human-filed): one `customerPriceCents` in `server/domain/pricing.ts` (legs × $3 + $0.50 relay + $4 platform − $1 if window ≥ 18 h); every $10, README, story, study rerun.
- #862 (victor-2, human-filed): `POST /api/v2/advise`, Gemini tool loop over the engine, offline fallback; adds types to `shared/v2/api.ts`. Uses #861's price.
- #863 (victor-6, human-filed): "Options" card after Parse in `client/src/components/business/v2/`, mocks /advise.

## Merged since pass 100 (22:30)
- PR #860 (#853): homepage hero in a centered 1200 px column (7fr/5fr, stacks ≤ 820 px), Relay logo as the R of the title, map now a framed 4:3 panel.

## Merged in pass 100
- PR #857 (#847): full MVP IV demo walk, no faults; `tests/ui/demo-walk-mvp4.test.ts` (API half, `arrived` at 6:22 PM).

## Earlier MVP IV merges
- Pass 94–99: PR #859 Play pill, #858 README sync, #856 header text, #855 journey handling carriers, #849 status chips, #848 3,024-run study, #845, #844, #840 homepage hero.
- F1: PR #793, #795, #804, #805, #817, #818, #825, #834. F2: PR #789, #801, #783, #794, #830, #835, #837, #839. F3: PR #792, #802, #803, #819.
- Other: PR #809, #813, #814, #822/#826, #828, #829, #838.

## Next up (each needs the issues in brackets merged first)
- README follow-up: pill Play bar, README lines 82/100 "under the buttons", journey handling carriers, header, homepage hero (#853 merged), map-control look, advisor Options card [#861, #862, #863, #864]; #861 edits README too, so it waits for it.
- Demo walk re-run with per-plan prices and the advisor card (headless Chrome, 1440 + 390 px) [#861, #862, #863].

## Known bugs / gaps / risks
- #861 and #862 both may touch `shared/` / plan types in parallel (human-arranged); the second to merge rebases.
- README lines 82 and 100 still describe the removed step line under Play (README follow-up).
- Real Gemini API never tested (to-do 5). Homepage animation checked in headless Chrome only.
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); not queued in the freeze.
- `PORT` does not work with `npm run dev`; `npm run study` needs tsx (devDependency).
