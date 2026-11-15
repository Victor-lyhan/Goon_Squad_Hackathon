# STATUS (maintained by the planner)

_Last update: 2026-11-14, 23:15 (Sat), planner pass 106_

## Current milestone: all milestones done; humans' polish backlog (QUESTIONS 23:01) until 04:30, code freeze 05:00. Rollback tag: `demo-3`.
MVP IV and the approved post-freeze additions are on main (per-plan pricing PR #866, advisor PR #865/#870/#871, pill map controls PR #872, full-viewport hero PR #873, 64 px header PR #875, legend fit PR #876). 19 polish issues are open (#877–#895), one or two per worker.

## HUMAN TO-DO
1. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. Markers, routes and the dark pills over the real map are unseen by agents. Write what looks wrong in QUESTIONS.md.
2. **The demo price is $9.50** (PR #866; the README sentence's 18 h window gets the $1 flexibility discount). Scenario exports made before PR #866 are refused on import.
3. **Look at the homepage hero (PR #873) and the new header (PR #875)**, ideally in Safari (mask + `offset-path`).
4. **F1/advisor: put `GEMINI_API_KEY`** in `.env`, run `npx tsx scripts/gemini-check.ts "<sentence>"`. Without a key the advisor answers offline.
5. **Before the real demo, reset the run** (stop server, delete `data/state-v2.json`, start). **Demo machine:** `npm run build` in the checkout with `.env`.
6. **GitHub Actions still not running (billing).** Reviewers run `bash scripts/test.sh` locally.
7. `docs/relay-spec.md:334` still prices a delivery at $10.00 (human-owned doc).

## Main health
- CI red = billing (DECISIONS pass 61): runs of #874, #868 and the 23:01 QUESTIONS commit. Last local full run: main at 433fbcf passed (410 files / 7319 tests). PRs #875 and #876 were each tested locally by the reviewer before merge. No fix issue.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass: 8 (polish backlog, one per worker with nothing ready)
- #888 victor-1: plain `/api/v2` error sentences (server only, no contract change).
- #889 victor-2: simulator map controls keyboard / screen reader.
- #890 victor-3: one plain placeholder on every Google map (no key, rejected key, error, loading).
- #891 victor-4: rehearse journey and network Play twice in headless Chrome.
- #892 victor-6: Business page frame (header, notifications) audit.
- #893 victor-7: jargon guard test + offender list (feeds next pass's copy fixes).
- #894 victor-8: simulator page states (first load, server error, stale link, desktop-only).
- #895 victor-10: app-wide focus ring + reduced-motion rule.

## In progress / ready (created 23:09–23:10, before this pass)
- In progress: #877 README sync (victor-8), #878 demo re-walk 1440 + 390 px (victor-7), #879 homepage audit (victor-5), #880 Business 30-second path (victor-10), #882 Employee audit (victor-6), #883 sim side panels (victor-2), #884 Gemini 2-minute offline pause (victor-1), #885 lazy-load pages / perf (victor-9), #887 study page audit (victor-4).
- Ready: #881 Business deliveries list + details (victor-5), #886 UI kit 404 / error / banner / spinner (victor-9).

## Merged since pass 105 (23:00)
- PR #875 (#868): taller 64 px header, larger centered links.
- PR #876 (#874): legend fits the 220 px map at 900 px; dead `ml__chevron` / `--night` hooks removed.

## Next up
- Copy fixes from #893's offender table, by module, once it merges.
- Fixes for faults #878 (demo re-walk) and #885 (perf) list outside their own files.
- Header (in `App.tsx`) 390 px / keyboard audit after #885 frees `App.tsx`.
- Stop queuing at 04:30.

## Known bugs / gaps / risks
- Real Gemini API never tested (to-do 4). Homepage animation and mask checked in headless Chrome only.
- PR #870: a parsed form focuses its first field, which may sit below the fold at 390 px (#878 checks).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; unreachable from any page (pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note).
- `PORT` does not work with `npm run dev`; `npm run study` needs tsx (devDependency).
