# AGENTS.md: rules for every agent (Claude and Codex)

Read this, SPEC.md and DECISIONS.md before doing anything. For product detail (copy, pricing, algorithm), read the relevant section of `docs/relay-spec.md`.

## Project
Relay: match B2B packages to employees' commutes (direct or one-hub relay), with a business portal, employee portal and a backend-driven delivery simulator. Synthetic city, all local, no external APIs.

## Team roster and module ownership
Paths are chosen so two workers never edit the same file.

| Worker label | Engine | Module | Owns paths |
| --- | --- | --- | --- |
| agent:p1-a | Codex | Engine: routing + matching | `server/domain/routing.ts`, `server/domain/matching.ts`, `tests/domain/routing*`, `tests/domain/matching*` |
| agent:p1-b | Codex | Engine: simulation, metrics, generator | `server/domain/simulation.ts`, `server/domain/metrics.ts`, `server/domain/generator.ts`, `server/domain/pricing.ts`, `tests/domain/sim*`, `tests/domain/metrics*`, `tests/domain/generator*` |
| agent:victor-1 | Claude Sonnet | API + persistence | `server/index.ts`, `server/api/`, `server/store.ts`, `server/clock.ts`, `client/src/api/`, `tests/api/`, `fixtures/demoScenario.json` |
| agent:victor-2 | Claude Sonnet | Simulator UI | `client/src/pages/Simulator.tsx`, `client/src/components/CityMap.tsx`, `client/src/components/Timeline.tsx`, `client/src/components/sim/` |
| agent:p2-a | Claude Sonnet | Business portal + UI kit | `client/src/pages/BusinessPortal.tsx`, `client/src/components/ShipmentForm.tsx`, `client/src/components/business/`, `client/src/ui/`, `client/src/App.tsx`, `client/src/pages/Landing.tsx`, `client/src/styles/` |
| agent:p2-b | Claude Sonnet | Employee portal | `client/src/pages/EmployeePortal.tsx`, `client/src/components/CommuteEditor.tsx`, `client/src/components/JobCard.tsx`, `client/src/components/employee/` |

Shared and human-owned: `shared/` (types + Zod schemas = the contracts), `SPEC.md`, `AGENTS.md`, `docs/`, `fixtures/relayFixture.json`, root config (package.json, vite/ts configs). Agents do not edit these unless an issue says so. If you need a contract change, write BLOCKED.md.

UI workers (victor-2, p2-b) use components from `client/src/ui/` (owned by p2-a). If a component is missing, build it locally in your own folder; don't edit `client/src/ui/`.
Frontend workers call the backend only through `client/src/api/` (owned by victor-1). If a call is missing, write BLOCKED.md.

### MVP II additions (overrides the table above where they conflict)
- agent:victor-3 (Claude Fable, Victor's Ultra) owns the Google/geo layer: `server/geo/`, `scripts/fetch-routes.ts`, the `fetch:routes` script entry in `package.json`, `fixtures/nyc/matrix.json` + `fixtures/nyc/polylines.json` (generated cache format; humans run the script), and the geocode route in `server/api/geo.ts` + `tests/geo/`.
- agent:victor-1 keeps the API and persistence. victor-1 may edit `shared/` **only** in the single MVP II contracts issue.
- agent:victor-4 (Claude, Victor's Ultra) covers Louis's engine module (p1-a and p1-b paths) while his workers are down. Planner: queue engine issues to victor-4 when p1-a/p1-b have not picked up ready work for 15+ minutes; never give victor-4 and p1-a/p1-b issues that touch the same files at the same time.
- agent:p1-b also owns `fixtures/nyc/businesses.json`, `fixtures/nyc/neighborhoods.json`, `fixtures/nyc/demoStory.json` and the NYC scenario generator.
- agent:victor-2 also owns `client/src/components/map/` (Google map + deck.gl layers).
- agent:victor-5 (Claude Fable, Victor's Ultra) takes over p2-a's module from 16:25 Sat (Business workspace, UI kit, tokens, shell, homepage, Help). Planner: queue p2-a-module issues to victor-5, not p2-a.
- agent:victor-6 (Claude Fable, Victor's Ultra) takes over p2-b's module from 16:25 Sat (Employee workspace). Planner: queue p2-b-module issues to victor-6, not p2-b.
- The victor-* workers form one pool (POOL=victor-): an idle victor worker may take a ready issue from a busier victor worker (it comments on the issue when it does). Reviewers: a victor worker editing another victor worker's paths for such an issue is expected, not an ownership violation.
- RETIRED from 16:45 Sat: agent:p1-a, agent:p1-b, agent:p2-a, agent:p2-b (all down). Planner: never queue issues to them. Their modules: engine -> victor-4, Business/UI kit/shell/homepage -> victor-5, Employee -> victor-6.
- agent:victor-7, agent:victor-8, agent:victor-9, agent:victor-10 (Claude Fable, Victor's Ultra) are general workers with no fixed module. Planner: give them any ready work, keeping the rule that two issues queued at the same time never edit the same files. They also take over waiting issues from busier victor workers automatically (POOL=victor-).
- agent:p2-a also owns the design tokens in `client/src/styles/` and `client/src/pages/Help.tsx`.
- New dependencies allowed for MVP II: `@googlemaps/js-api-loader`, `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/google-maps`, `@mapbox/polyline` (or equivalent polyline decoder), `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`. The issue that first needs one adds it to package.json.
- Keys: never read, print or commit `.env`. Tests must not need network or keys.

## Commands
- Install: `npm install`
- Test everything: `bash scripts/test.sh` (must pass before any PR)
- Run locally: `npm run dev` (Vite on 5173, API on 3001, `/api` proxied)
- State file: `data/state.json` (gitignored). Delete it to reset to the demo city.
- Env vars needed: none. `PORT` optional. Optional, server only, in `.env`: `GEMINI_API_KEY` and `GEMINI_MODEL` (default `gemini-2.5-flash`), read by `server/ai/env.ts` for MVP IV F1; never a `VITE_` variable.

## Hard rules for this project
- Time = integer minutes since Day 1 00:00 (Day 2 08:30 = 1950). Distance = meters. Money = integer cents. Weight = grams in data, kg in the form.
- IDs must be deterministic (no Math.random / uuid in domain code): same seed + inputs ⇒ identical IDs and assignments. Use the formats in `shared/types.ts`.
- All randomness goes through the one seeded PRNG in `server/domain/generator.ts`.
- Domain modules are pure functions: no Express, no fs, no Date.now().
- The frontend never computes match results, statuses, earnings or metrics. It renders API responses and may only interpolate marker positions between polls.
- Never use the browser's localStorage for delivery data (only the chosen demo identity).

## Rules
1. Work only on your assigned task, inside your module's paths.
2. Interfaces between modules are defined in `shared/`. Code to them exactly.
3. Every change comes with a test or a runnable check.
4. Never commit secrets. There should be none in this project.
5. Prefer boring, well-known libraries. Don't add a dependency without saying why in SUMMARY.md.
6. Do not commit or push yourself; the loop scripts do it. Do not touch other branches.
7. If blocked, write BLOCKED.md (see prompts/worker.md) instead of guessing at a contract change.

## Review guidelines
Used by the reviewer loop and by Codex code review on GitHub.
- Blocking (P0/P1): failing tests/build/typecheck, broken contract, nondeterministic IDs in domain code, frontend computing business logic, crashes on the demo path, edits outside the module without explanation.
- Not blocking: style, naming, small refactors, missing polish.
- Keep main demo-able at all times.
