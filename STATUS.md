# STATUS (maintained by the planner)

_Last update: 2026-11-15, 00:21 (Sun), planner pass 113 (planner halted; 00:15 cutoff passed)_

## Current milestone: all milestones done. **Polishing ended at midnight (humans, 23:50): no new issues.** The 00:15 cutoff has passed: what is still open stays open; the planner halts. Code freeze 05:00. Rollback tag: `demo-3`.

## HUMAN TO-DO
1. **CI on main is red six runs in a row**: #919 (PR #930), #900 (PR #932), planner 00:04 (Markdown only), #881 (PR #914), #908 (PR #936), #921 (PR #937), and the 00:16 planner commit (Markdown only). #895 (PR #929) was the last green run. **New clue:** PR #938's CI `test` check also fails, while its reviewer ran `bash scripts/test.sh` locally on the same head and got typecheck, tests and build all OK. That points to CI infra or billing again (pass 61), not necessarily broken code. The planner still could not open CI logs (`gh run list` needs approval). **First thing: run `bash scripts/test.sh` on main.** If it is green, CI is the problem, not main. If it is red, roll back to `demo-3` or fix it before the demo. If only latency/timeout tests fail, rerun with the Mac idle.
2. **Open `/simulator` with the browser key**, or press **Watch a package** on `/`. No agent has seen the markers, routes or dark pills on the real map. The 30-second path (PR #936) and Play-twice rehearsal (PR #934) were checked in headless Chrome only.
3. **Run the demo check (PR #931)** on the demo machine: it says in plain lines whether keys, travel data, saved run and build are ready. **Before the real demo, reset the run** (stop the server, delete `data/state-v2.json`, start it again) and run `npm run build` in the checkout with `.env`.
4. **F1/advisor: put `GEMINI_API_KEY`** in `.env`, then run `npx tsx scripts/gemini-check.ts "<sentence>"`. Without a key, Parse and Options answer offline (PR #925).
5. **The demo price is $9.50** (PR #866). Scenario exports made before PR #866 are refused on import.
6. **Look at the homepage and the 64 px header** (PR #933), ideally in Safari (mask + `offset-path`).
7. Will the demo machine have `GOOGLE_MAPS_SERVER_KEY`? #899 (never started) would have checked whether the Employee step needs it. Without it, address search answers 503.
8. **Left open after the cutoff**: PR #938 (#923, server restarts mid-demo, victor-8, `needs-fix`: code and API test approved, only the headless Chrome walk in the PR body is missing), #890 (map placeholders, victor-3, in progress), #899 (address-search errors, victor-3, ready, not started). None is needed for the demo; merge PR #938 before 05:00 only if its body gets the walk and main is green.
9. `docs/relay-spec.md:334` still prices a delivery at $10.00 (human-owned doc).

## Main health
- Latest runs: 00:16 planner **failure**, #921 (PR #937) **failure**, #908 (PR #936) **failure**, #881 (PR #914) **failure**, 00:04 planner **failure**, #900 (PR #932) **failure**, #919 (PR #930) **failure**; #895 (PR #929) success. No fix issue (humans' stop); see to-do 1.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass: 0 (humans' 23:50 stop)

## Open
- PR #938 (#923, victor-8) `needs-fix`: reviewer ran `scripts/test.sh` green on head cb8fad9; blocking item is the PR description (browser walk results + faults table).
- #890 (victor-3) in progress, no PR. #899 (victor-3) ready, not started.

## Merged since pass 111 (00:09)
- #937 (#921) simulator live updates pause in a hidden tab, back off, stop on leave.
- #936 (#908) 30-second path, simulator half: homepage, Watch a package, journey plays to the end.
- #935 (#916) Employee page copy in plain words.
- #934 (#891) Play the simulator twice in headless Chrome.
- #914 (#881) Business deliveries list and details polish.

## Merged in pass 108-111 window
- #933 (#918), #932 (#900), #931 (#922), #930 (#919), #929 (#895), #928 (#909), #927 (#892), #926 (#886), #925 (#898), #924 (#917), #920 (#907), #915 (#894), #913 (#893), #912 (#889), #911 (#885), #910 (#882), #906 (#888), #905 (#887), #904 (#880), #903 (#877), #902 (#878).

## Next up
- Nothing. The planner has halted; humans take over in the morning.

## Known bugs / gaps / risks
- CI red on main since PR #930 (to-do 1); cause not seen; PR #938 suggests CI infra.
- Real Gemini API never tested (to-do 4). Homepage animation, mask and the simulator 30-second path checked in headless Chrome only.
- PR #870: a parsed form focuses its first field, which may sit below the fold at 390 px.
- Address search with no server key answers 503 (#899 not done).
- Random city at end of day is 158.6 KB, over the 150 KB poll budget; no page reaches it (pass 82).
- Carrier package badge can drift a pixel or two between zoom events (PR #775 note).
- `PORT` does not work with `npm run dev`; `npm run study` needs tsx (devDependency).
