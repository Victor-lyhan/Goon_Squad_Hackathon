# STATUS (maintained by the planner)

_Last update: 2026-11-14, 22:47 (Sat), planner pass 103_

## Current milestone: MVP IV (docs/mvp4.md) done; human-approved post-freeze additions and polish in progress. Code freeze 5 a.m. Rollback tag: `demo-3`.
All three MVP IV tracks are on main, and the full demo walk passed (PR #857). Post-freeze: per-plan pricing (PR #866) and the advisor server (PR #865) are merged; the advisor UI (PR #870, in review), the map-control pill look (#864), the advisor price check (#867) and two new human polish issues (#868 header, #869 homepage hero) are open.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Markers, routes and the dark Play pill over the real map are unseen by agents. Write what looks wrong in QUESTIONS.md.
2. **The demo price is now $9.50** (PR #866): the README sentence's window is exactly 18 h, so it gets the $1 flexibility discount. Scenario exports made before PR #866 are refused on import; re-export any you keep.
3. **Calls in QUESTIONS pass 98–102** (carrier A vanishes at home; "Demo account" stays; disabled reason as tooltip; #864 restyles existing map controls). Pass 101's 290 px hero question is superseded by your #869.
4. **Homepage animation in Safari** (CSS `offset-path`), after #869 reshapes the hero.
5. **F1/advisor: put `GEMINI_API_KEY`** (optionally `GEMINI_MODEL`) in `.env`, run `npx tsx scripts/gemini-check.ts "<sentence>"`. Without a key the advisor answers with offline options.
6. **Before the real demo, reset the run** (stop server, delete `data/state-v2.json`, start). **Demo machine:** `npm run build` in the checkout with `.env`.
7. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
8. `docs/relay-spec.md:334` still prices a delivery at $10.00 (human-owned doc).

## Main health
- CI red = billing (DECISIONS pass 61): runs of #861 and the 22:42 planner commit and the workers-skill commit. Last local runs (PR #865/#866 reviews) pass. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass: 0
- Nothing new: every free area is either held by open work or waits for it (see Next up).

## In review / in progress / ready
- PR #870 (#863, victor-6): advisor "Options" card after Parse in `client/src/components/business/v2/`; reviewer-2.
- #864 (victor-7): legend, day/night badge, banners, overnight card → dark translucent pill.
- #867 (victor-1): advisor reads `settings.flexWindowMin`; test that /advise prices equal `customerPriceCents()`.
- #868 (victor-1, ready, human-filed): taller header navbar, larger centered links, 390 px safe.
- #869 (victor-8, human-filed): full-viewport homepage hero, borderless half-page map with a soft gradient edge.

## Merged since pass 102 (22:42)
- None.

## Earlier post-freeze / MVP IV merges
- PR #866 (#861) per-plan pricing; PR #865 (#862) `POST /api/v2/advise`.
- Pass 94–101: PR #860 homepage hero, #859 Play pill, #858 README sync, #857 demo walk, #856, #855, #849, #848 3,024-run study, #845, #844, #840.
- F1: PR #793, #795, #804, #805, #817, #818, #825, #834. F2: PR #789, #801, #783, #794, #830, #835, #837, #839. F3: PR #792, #802, #803, #819.

## Next up (each needs the issues in brackets merged first)
- README follow-up: pill Play bar, README "the line under the buttons" (2-minute demo step 5), journey handling carriers, header, homepage hero, map-control look, advisor Options card [#863, #864, #868, #869].
- Demo walk re-run with per-plan prices, the advisor card, new header and hero (headless Chrome, 1440 + 390 px) [#863, #867, #868, #869].

## Known bugs / gaps / risks
- README 2-minute demo step 5 still quotes "the line under the buttons", which PR #859 removed (README follow-up).
- Real Gemini API never tested (to-do 5). Homepage animation checked in headless Chrome only.
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note); not queued in the freeze.
- `PORT` does not work with `npm run dev`; `npm run study` needs tsx (devDependency).
