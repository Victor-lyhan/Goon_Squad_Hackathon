# STATUS (maintained by the planner)

_Last update: 2026-11-14, 22:42 (Sat), planner pass 102_

## Current milestone: MVP IV (docs/mvp4.md) done; human-approved post-freeze additions nearly in. Code freeze 5 a.m. Rollback tag: `demo-3`.
All three MVP IV tracks are on main, and the full demo walk passed (PR #857). Post-freeze: per-plan pricing (PR #866) and the advisor server (PR #865) are merged; the advisor UI (#863) and the map-control pill look (#864) are in progress.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Markers, routes and the dark Play pill over the real map are unseen by agents. Write what looks wrong in QUESTIONS.md.
2. **The demo price is now $9.50** (PR #866): the README sentence's ready→deadline window is exactly 18 h, so it gets the $1 flexibility discount. README and `tests/ui/demo-walk-mvp4` are updated. Scenario exports made before PR #866 are now refused on import; re-export any you keep.
3. **Calls in QUESTIONS pass 98–101** (carrier A vanishes at home; "Demo account" stays; disabled reason as tooltip; #864 restyles existing map controls; hero map 290 px at 821–1000 px).
4. **Homepage animation in Safari** (CSS `offset-path`) and the hero at 821–1000 px.
5. **F1/advisor: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, run `npx tsx scripts/gemini-check.ts "<sentence>"`. Without a key the advisor answers with offline options.
6. **Before the real demo, reset the run** (stop server, delete `data/state-v2.json`, start). **Demo machine:** `npm run build` in the checkout with `.env`.
7. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
8. `docs/relay-spec.md:334` still prices a delivery at $10.00 (human-owned doc).

## Main health
- CI red = billing (DECISIONS pass 61): runs of #862, and the 22:29 / 22:35 planner commits; both PR #865 and #866 reviews ran `scripts/test.sh` locally. The one real failure on main after PR #859 (`tests/api/readme-mvp4.test.ts` still expected the removed `.ctl-line`) is fixed by PR #866. No fix issue.

## Stuck
- Nothing labeled `stuck`. No open PRs.

## Queued this pass: 1 (#867)
- #867 (victor-1): advisor reads the typed `settings.flexWindowMin` from PR #866; test that /advise option prices equal `customerPriceCents()` (PR #865 review note).

## In progress / ready
- #863 (victor-6, human-filed): "Options" card after Parse in `client/src/components/business/v2/`, against `POST /api/v2/advise`.
- #864 (victor-7): legend, day/night badge, banners, overnight card → dark translucent pill (CSS in `sim/v2/`, `map/map.css`).
- #867 (victor-1): see above.

## Merged since pass 101 (22:36)
- PR #866 (#861): one `customerPriceCents` = legs × $3 + $0.50 relay + $4 platform − $1 if window ≥ 18 h; README, story, study rerun, demo walk test at $9.50.
- PR #865 (#862): `POST /api/v2/advise`, Gemini tool loop (≤ 4 calls, 10 s) over engine what-ifs, offline fallback; engine sets every number; adds `advise()` to `client/src/api/v2.ts`.

## Earlier MVP IV merges
- Pass 94–101: PR #860 homepage hero, #859 Play pill, #858 README sync, #857 demo walk, #856, #855, #849, #848 3,024-run study, #845, #844, #840.
- F1: PR #793, #795, #804, #805, #817, #818, #825, #834. F2: PR #789, #801, #783, #794, #830, #835, #837, #839. F3: PR #792, #802, #803, #819.

## Next up (each needs the issues in brackets merged first)
- README follow-up: pill Play bar, README "the line under the buttons" (2-minute demo step 5), journey handling carriers, header, homepage hero, map-control look, advisor Options card [#863, #864].
- Demo walk re-run with per-plan prices and the advisor card (headless Chrome, 1440 + 390 px) [#863, #867].

## Known bugs / gaps / risks
- README 2-minute demo step 5 still quotes "the line under the buttons", which PR #859 removed (README follow-up).
- Real Gemini API never tested (to-do 5). Homepage animation checked in headless Chrome only.
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); not queued in the freeze.
- `PORT` does not work with `npm run dev`; `npm run study` needs tsx (devDependency).
