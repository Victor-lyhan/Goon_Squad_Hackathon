# STATUS (maintained by the planner)

_Last update: 2026-11-14, 23:00 (Sat), planner pass 105_

## Current milestone: MVP IV (docs/mvp4.md) done; human-approved post-freeze additions and polish in progress. Code freeze 5 a.m. Rollback tag: `demo-3`.
All three MVP IV tracks are on main, and the full demo walk passed (PR #857). Post-freeze merged: per-plan pricing (PR #866), advisor server (PR #865), advisor Options card (PR #870), advisor price check (PR #871), map-control pill look (PR #872), full-viewport homepage hero (PR #873). Open: #868 header, #874 legend fit.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Markers, routes and the dark pills (Play, legend, badge, banners, overnight card) over the real map are unseen by agents. Write what looks wrong in QUESTIONS.md.
2. **The demo price is now $9.50** (PR #866): the README sentence's window is exactly 18 h, so it gets the $1 flexibility discount. Scenario exports made before PR #866 are refused on import; re-export any you keep.
3. **Look at the new homepage hero (PR #873)**: Business and Employee are now stacked under Watch a package (beyond your #869 wording). Not checked in Safari (mask + `offset-path`).
4. **Calls in QUESTIONS pass 98–102** (carrier A vanishes at home; "Demo account" stays; disabled reason as tooltip; #864 restyles existing map controls).
5. **F1/advisor: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, run `npx tsx scripts/gemini-check.ts "<sentence>"`. Without a key the advisor answers with offline options. The Options card is on Business → New delivery after Parse (PR #870).
6. **Before the real demo, reset the run** (stop server, delete `data/state-v2.json`, start). **Demo machine:** `npm run build` in the checkout with `.env`.
7. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
8. `docs/relay-spec.md:334` still prices a delivery at $10.00 (human-owned doc).

## Main health
- CI red = billing (DECISIONS pass 61): runs of #864, #869 and the 22:54 planner commit fail with no steps. Local `scripts/test.sh` on main at 433fbcf (PR #872 + #873 together) passes: 410 files / 7319 tests, build OK. No fix issue.

## Stuck
- Nothing labeled `stuck`. PR #872's thread warns the loop may add `stuck` after a no-op fix round on an already-merged PR; ignore it if it appears.

## Queued this pass: 1
- #874 (victor-2): simulator legend fits a 220 px map at 900 px (it overlaps the Inspector heading today), and the dead `ml__chevron` / `map-v2__daynight--night` hooks go. From PR #872's reviews.

## In review / in progress / ready
- #868 (victor-1, human-filed): taller header navbar, larger centered links, 390 px safe. Comment added: define `--app-header-h` to the new height (hero fold + sticky sim panels use it, default 48 px).
- #874 (victor-2): legend fit + dead hooks.

## Merged since pass 104 (22:53)
- PR #872 (#864): legend, day/night badge, banners, overnight card → dark translucent pill, same rects as before.
- PR #873 (#869): hero fills the viewport below the header; borderless map on the right half with a mask fade; phone/upright windows stack text then map; Business/Employee stacked.

## Earlier post-freeze / MVP IV merges
- PR #870, #871 (advisor card + price check), #866 per-plan pricing, #865 `POST /api/v2/advise`.
- Pass 94–101: PR #860 homepage hero, #859 Play pill, #858 README sync, #857 demo walk, #856, #855, #849, #848 3,024-run study, #845, #844, #840.
- F1: PR #793, #795, #804, #805, #817, #818, #825, #834. F2: PR #789, #801, #783, #794, #830, #835, #837, #839. F3: PR #792, #802, #803, #819.

## Next up (each needs the issues in brackets merged first)
- README follow-up: pill Play bar and map controls, README "the line under the buttons" (2-minute demo step 5) and the stale "never takes more than two lines" sentence, journey handling carriers, header, full-viewport hero with stacked entries, advisor Options card [#868].
- Demo walk re-run with per-plan prices, the advisor card (parsed form's focused field at 390 px, PR #870 note), new header and hero (headless Chrome, 1440 + 390 px) [#868].

## Known bugs / gaps / risks
- Header height change (#868) will push the hero past the fold and slide sticky sim panels under the header unless `--app-header-h` is defined (comment on #868).
- README 2-minute demo step 5 still quotes "the line under the buttons", which PR #859 removed (README follow-up).
- Real Gemini API never tested (to-do 5). Homepage animation and mask checked in headless Chrome only.
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); not queued in the freeze.
- `PORT` does not work with `npm run dev`; `npm run study` needs tsx (devDependency).
