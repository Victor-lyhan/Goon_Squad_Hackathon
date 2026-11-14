# STATUS (maintained by the planner)

_Last update: 2026-11-14, 17:10 (Sat), planner pass 62 (started 16:50)_

## Current milestone: M9 Polish (target 10:00 p.m. Sat)
The NYC app is the only app a visitor can reach. Twelve PRs merged since 16:45, so when this pass looked again only one issue was still `ready` and workers were going idle. Five code audits over the files no open issue touches gave the next 16 issues (#623 to #628, #630, #631, #633 to #640), at least one for each of the ten workers. Step 2 of the MVP 1 deletion (the API) is queued and already in progress (#628).

## HUMAN TO-DO
1. **GitHub Actions is still not running** (billing). The check of PR #613 failed in 2 s with the same message at about 16:50 (run 43644795644). Fix it in GitHub Settings, Billing & plans. Until then a red check means nothing; reviewers run `bash scripts/test.sh` themselves.
2. **Open `/simulator`, `/business/<id>` and `/employee/<id>` with the browser key.** No agent has seen the Google map. Write what looks wrong in QUESTIONS.md and I queue it first.
3. **Three calls of this pass change behaviour; overrule them in QUESTIONS.md if you disagree:** the clock goes back to the start when a delivery is added in planning (#624); a commute save re-plans the deliveries on a trip it changed (#627); the Guided demo names the README's example request (#630).
4. Four one-line config changes only you may make (QUESTIONS pass 62): Node `engines`, the Vite proxy port, the chunk warning limit, `.env.example`.
5. Run `npm run fetch:routes -- --drop-entered` before committing `fixtures/nyc/` again. Optional contract edits in `shared/v2/api.ts` (QUESTIONS pass 61).

## Main health: not broken as far as I can tell; CI cannot run (billing)
- Every run on main is red for the billing reason, not for the code. I read the run of PR #613 and the review of PR #612: the reviewer ran the suite locally, 5709 passed and 1 failed (`tests/api/commute-latency.test.ts`, an MVP 1 timing test, on a loaded machine; it passes alone). #628 deletes that test with the MVP 1 API. No fix issue created.

## Stuck
- Nothing labeled `stuck`.

## Queued this pass (16 issues, the cap of this pass)
- Demo path first: #623 header links open the account on screen (victor-5); #624 clock back to the start when a delivery is added after a preview (victor-3, in progress); #627 a commute save re-plans the deliveries on a changed trip (victor-4); #630 Guided demo leads to a request that matches (victor-7).
- Simulator: #625 a journey stays complete when a layer is off, no "Leg 2" for a direct one (victor-2); #631 Inspector opens when a journey starts (victor-8, in progress); #635 one set of status words, real extra minutes in the timeline (victor-2); #638 keyboard in Scenario and Compare (victor-8).
- Employee: #626 departure once, as "5:30 PM" (victor-6); #634 job screens: heading, honest missing-delivery text, focus, saved note (victor-10, in progress); #633 a new delivery is announced, "3 min shorter" in the list (victor-9).
- Shell and docs: #636 header lists retry after a failed load (victor-5); #637 README for a fresh clone and a tab icon (victor-3).
- Server: #628 delete the MVP 1 API (victor-1, in progress); #639 a reason of its own when nobody commutes (victor-4); #640 no typed address in any line of the fetch command (victor-9).

## In progress / in review (from before this pass)
- In review: #532 left-panel controls over HTTP (victor-1), #581 Business page 1320 px and relay point (victor-4).
- In progress: #595 route tooltips (victor-7), #597 Employee poller (victor-6), #602 address search deadline (victor-9), #608 delete the SVG city map (victor-2), #609 Business table at 390 px (victor-5). Ready: #604 Random city at the edges of the form (victor-7).

## Merged since pass 61 (16:45)
- Simulator: PR #614 (#594) Play journey no longer flickers the left panel. #607 (keys after the scrubber, Packages under Playback) closed during this pass; I did not see its PR.
- Business and shell: PR #606 (#568) account selector "Name · Employer"; PR #612 (#599) poller; PR #616 (#582) full match result in the form; PR #622 (#610) homepage retries.
- Employee: PR #613 (#596) a new job's route without a reload; PR #618 (#598) commute editor messages.
- Server: PR #611 (#570) import check; PR #615 (#600) start lines and a log line per 500; PR #620 (#601) commute save ahead of line fetches; PR #621 (#603) names without numbers; PR #617 (#605) §9 tests without the MVP 1 router.

## Next up (each needs the issues in brackets merged first)
- Status words of the journey panel ("Waiting for pickup" becomes "Scheduled") [#595, same file `journey/journeyModel.ts`, and #635].
- Business header no longer promises that deliveries can be edited [#581, same file `activity/activityModel.ts`].
- Button label "Find a delivery match" in the form, Help, README and seven test files [#581, #630, #637]; table rows as links [#581, #609].
- Move `createRng` into the v2 engine, then delete the MVP 1 engine files (step 3) [#628, #639].
- Last sweep: the unused first argument of `createApp`, unused kit components and dead rules in `styles/global.css`, the four MVP 1 model files the v2 pages still import [#628, #634].

## Known bugs / gaps
- Header: Business and Employee links open the first account, not the one on screen (#623); they stay greyed out after a failed first load (#636).
- A delivery added after "Play journey" in planning shows as already delivered and paid (#624).
- A commute save for an employee who carries a delivery leaves a job that answers 404 and a package with no position (#627).
- Simulator: a journey loses its route lines when Routes is unchecked (#625); no timeline when the Inspector was collapsed (#631); a route's hover text has no name (#595).
- Employee: the departure is shown twice in two formats (#626); "The city was changed" for a re-matched delivery (#634).
- Business: relay and unmatched rows break at 390 px (#609). Address search can offer Mount Vernon or Yonkers (#602).
- README says Node 22; Vite needs 22.12 or newer (#637). `PORT` does not work with `npm run dev` (needs your config change).
- The Employee job view marks a stop "done" from the job status only (needs a contract field, QUESTIONS pass 61).
- This planner run cannot use `gh run list`, `gh pr list`, `gh label list`, `git fetch`, `node` or `npm`; `gh run view <id>` and `gh pr view <n>` work. The audits read the checkout of 16:50, six PRs behind main; none of those PRs touched the audited files.
