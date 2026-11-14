# STATUS (maintained by the planner)

_Last update: 2026-11-14, about 12:05 (Sat), planner pass 44 (started 11:37)_

## Current milestone: M7 Foundation (MVP II, target 2:00 p.m. Sat)
MVP II landed in SPEC.md at 11:36–11:45 (real NYC + Google travel times, relay points = network businesses, full UI redesign, package journey mode, new worker victor-3 for the geo layer). MVP 1 (M0–M6) is complete on main. This pass set the migration plan and queued the 10 M7 issues that don't need the new contracts. Everything else waits for #322.

**Plan: build MVP II side by side, then swap** (DECISIONS pass 44). New code goes in `shared/v2/`, `server/domain/v2/`, `server/api/v2/` (routes under `/api/v2`), `server/geo/` and `v2` subfolders of the UI. MVP 1 files stay untouched and its demo keeps working on main until the route swap. Tokens, shell and homepage are restyled in place.

## Main health: GREEN (last finished runs passed; the three human MVP II commits are docs only)
- I can't run `gh run list` in this run, so the 11:36–11:45 commits' CI is unconfirmed. They change only SPEC.md, AGENTS.md, DECISIONS.md and docs/.

## Stuck
- None.

## In progress (picked up within minutes)
- #322 victor-1 **[P0, first]**: `shared/v2` contracts (data model, `TravelProvider`, API types, schemas, fixture formats). Blocks p1-a and most next issues.
- #327 p1-b: NYC data set (18 businesses without coordinates, 8–10 neighborhoods, demo story with 24 packages).
- #329 victor-2: Google basemap + deck.gl map component; installs all seven MVP II client dependencies; adds `envDir` to vite.config.ts.
- #323 victor-3: Google HTTP client (geocode, route matrix in ≤ 625-element batches, polylines), injected fetch, no key leaks.

## Queued (label `ready`)
- #328 p1-b: polyline geometry for the simulation (decode, position by share of travel time).
- #330 victor-2: simulator workspace frame (full-width map slot, left/right panels, layer toggles, focus selector, journey-mode frame, package list).
- #324, #325, #326 p2-a: design tokens + UI kit restyle; enterprise header + `/help` page; new homepage.
- #317 p2-b **[P0 for the MVP 1 fallback]**: commute editor form resets on every 1 s poll.
- #331 p2-b: home address search control (stores neighborhood + coordinates only).
- p1-a: nothing yet. The matcher port needs #322 merged (dependency rule).

## Next up (after #322 merges)
- victor-3: `CachedProvider` / `GoogleProvider` / `FakeProvider`, `scripts/fetch-routes.ts` + `npm run fetch:routes`, geocode route, loading `.env` on the server.
- p1-a: matcher on `TravelProvider` in `server/domain/v2/matching.ts` (relay = any other business), spec tests ported to `FakeProvider`.
- p1-b: 120-home pool + NYC scenario generator, v2 timeline and `snapshotAt` (lat/lng, polyline movement), metrics.
- victor-1: `/api/v2` routes, store and pipeline on the v2 model, `client/src/api` v2 helpers.
- victor-2: compose frame + map + playback; then **package journey mode first** (M8). p2-a: font imports, business workspace. p2-b: employee workspace + v2 commute editor.
- **HUMAN CHECKPOINT:** when the providers, the script and #327 are merged, Victor runs `npm run fetch:routes` and commits `fixtures/nyc/`. Nothing NYC can run before that.
- Then: cutover (routes swap to the v2 pages, indicator text becomes "Real NYC locations · simulated deliveries"), delete MVP 1 code.

## Closed this pass
- #319 (business mini-maps `runId`): the SVG mini-maps are replaced in MVP II.
- #320 (jsdom harness): deferred to M9; it competes with #329 for package.json and with M7 for p2-a's time.

## Done (newest first)
- PR #321 (#318) victor-2: map markers no longer flash forward on each poll.
- MVP 1 complete: must-haves 1–10, nice-to-haves 11–15, scrubber, Duplicate request; CI timing sweeps #309–#316. See git log for PR #316 and earlier.

## Known bugs / gaps
- **p2-a and p2-b have not picked up an issue since about 6:30 a.m.** (#317, #319, #320 sat `ready` for 30+ min while victor-2 took #318 in 4 min). If those workers are down, tokens, shell, homepage and the employee workspace stall (QUESTIONS pass 44).
- Git tag `mvp1` (the fallback named in SPEC) does not exist in this clone.
- Commute editor resets every second in a browser (#317), on the MVP 1 pages.
- No agent can see the Google map: workers have no keys. The first visual check of #329 must be done by a human.
- Until the human fetch, MVP II runs only on `FakeProvider` in tests; `/api/v2` will answer 503 without the cache.
- The p1-b Codex sandbox can't run the API tests (EPERM on listen), so its PRs rely on CI.
