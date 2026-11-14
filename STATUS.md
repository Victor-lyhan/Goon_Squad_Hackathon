# STATUS (maintained by the planner)

_Last update: 2026-11-14, 18:45 (Sat), planner pass 69 (started 18:29)_

## Current milestone: MVP III (docs/mvp3.md), feature freeze 9:30 p.m.
Goal: a judge understands Relay in 30 seconds by watching one package move. **P1 and P3 are merged except the legend (PR #708). P2 has one sweep left (#711). P4 is down to the simulator CSS (#701) and a browser QA pass (#714).**

## HUMAN TO-DO
1. **Open `/simulator` with the browser key now**, or press **Watch a package** on `/`. Play/Pause, day/night, the journey map and the timeline symbols are all on main. Nobody has seen the map yet. Write what looks wrong in QUESTIONS.md; it goes first.
2. **Run the fetch for #650:** QUESTIONS.md "NEEDS FETCH" line (25 route lines): `npm run fetch:routes`, then `npm run fetch:routes -- --drop-entered`, commit `fixtures/nyc/`. Navy Yard is fine without it.
3. **GitHub Actions still not running (billing).** Fix in GitHub Settings, Billing & plans. Reviewers run `bash scripts/test.sh` locally.
4. Overrule the calls of passes 63 to 69 in QUESTIONS.md if you disagree.
5. Still open from pass 62: four config lines (Node `engines`, Vite proxy port, chunk limit, `.env.example`).

## Main health
- CI red = billing (DECISIONS pass 61); the last three runs on main (#700, #702, status commit) are that. The two local red tests were fixed by PR #696 (#690). No fix issue. (This pass could not run the suite itself.)

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (3 new)
- P2 #711 delete the MVP 1 engine (`server/domain/{routing,matching,simulation,metrics,generator}.ts`), `server/api/{initialRun,views,pipeline}.ts` and their ~30 tests; compare fixture to v2 `computeMetrics` (victor-4).
- #712 Employee page keeps its loading view until the business list arrives: no "Unknown place" flash (victor-6).
- P4 #714 headless Chrome QA of `/`, `/business`, `/employee` at 1440 and 390 px, CSS fixes only (victor-10).
- Only 3: every other open step edits files of #699/#701/#703/#704/#705. Everyone else is busy or has no MVP III work in its module.

## In progress / in review
- PR #708 (#699 legend with journey symbols, map's last old colours, victor-2), PR #709 (#705 error fallback resets on query change, victor-3).
- #701 simulator CSS restyle (victor-7), #703 "Find a delivery match" + README to MVP III (victor-5), #704 UI test of the 30-second demo path (victor-9).

## Merged since pass 68 (18:19)
- PR #707 (#700) simulator setup and MVP 1 playback code out; `sim/playbackModel.ts` deleted.
- PR #706 (#702) `client/src/api/client.ts` shim deleted. PR #698 (#692) `markerTween.ts` out. PR #697 (#691) Business `trackingModel.ts` out.
- PR #696 (#690) the two red local tests fixed.
- Earlier MVP III: #680 Play/Pause, #682 story retune, #679 journey map, #694 timeline symbols, #693/#695 Business/Employee restyle, #689, #688, #687, #681.

## Next up (each needs the issues in brackets merged first)
- Simulator visual QA in headless Chrome (layout, fonts, overflow; the map itself needs the key) [#699, #701].
- Markup faults #714 lists under "Needs markup" [#714].
- After freeze (9:30 p.m.): bug fixes, copy and demo polish only.

## Known bugs / gaps
- `PORT` does not work with `npm run dev` (needs your config change; README says `npm start` only).
- 25 relay stretches move on straight lines until the NEEDS FETCH is run.
