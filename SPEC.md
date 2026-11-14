# SPEC: Relay

Written by the humans. Agents read this; only humans change it.
Full product spec: `docs/relay-spec.md` (the source of truth for UI copy, pricing, algorithm details). This file sets priority and milestones.

## One-liner
Relay matches small business-to-business packages to employees' existing commutes (direct, or relayed through one hub overnight) and simulates the deliveries on an animated synthetic city map.

## The 2-minute demo (everything serves this)
1. Employee portal: saved commute, departure times, added-time limit.
2. Business portal: pick recipient, describe package, set times, **Find a delivery match**.
3. Backend returns a real **Delivery arranged** card (shipment ID, ETA, price, carriers, hub).
4. Employee tab, no manual refresh: the new job is already there with stops and reward.
5. Simulator: play the evening leg; package sits at the hub overnight; Jump to morning; delivered.
6. Sender/recipient tracking and employee earnings update from the same run.

## Must have (in priority order)
1. Routing + greedy matcher that reproduces the exact fixture (docs/relay-spec.md §9).
2. `POST /api/shipments` → stored shipment, plan, one job per leg, notifications, idempotent by clientRequestId.
3. `PUT /api/employees/:id/commute` → baseline routes, persisted, retries unmatched shipments.
4. Backend event timeline + pure `snapshotAt(run, t)` + one shared server clock + control endpoint.
5. Business portal: send form, confirmation / no-match card, outgoing + incoming lists, tracking drawer.
6. Employee portal: commute editor, assigned job cards, job detail, earnings. Fits 390 px.
7. Simulator page: SVG city map, moving markers, play/pause/speed/next event/jump to morning/finish.
8. Designed "Demo city" preset loaded on first launch (`fixtures/demoScenario.json`).
8b. `/` landing page: one screen explaining Relay with buttons to the business portal, employee portal and simulator (judges land here).
9. Metrics cards computed from snapshots (Projected vs actual labels, no NaN).
10. Polling every 1 s so two tabs stay in sync.

## Nice to have (build only after 1–10 work end to end; cut in reverse order)
11. Start new planning cycle / reset playback / recompute.
12. Seeded random city generator with controls.
13. Direct-only vs relay comparison.
14. Scenario JSON export/import.
15. Route waypoints ("Adjust my route", up to 3 per direction).
16. Setup drawer CRUD for businesses/employees, Duplicate request, timeline scrubber.

## Out of scope
Cancellations, disruptions, recovery, offers/declines, auth, real payments, GPS, QR scanning, traffic randomness, emissions, LLM/runtime AI, external APIs, WebSockets, databases.

## Tech stack
- One TypeScript repo, npm workspaces not required.
- Frontend: React + TypeScript + Vite, plain CSS or Tailwind (decide in M0, record in DECISIONS.md).
- Backend: Node + Express + TypeScript (run with tsx in dev).
- Shared: `shared/types.ts` + `shared/schemas.ts` (Zod). Human-owned contracts.
- Tests: Vitest. Persistence: `data/state.json`, serialized atomic writes.

## Milestones (the planner works through these in order)

Clock times assume hacking ends ~9:00 a.m. Sun Nov 15. Every milestone has frontend AND backend work so no worker sits idle.
UI work before the API exists must still be real code: components take props typed from `shared/`, and any sample objects live only in test files or in `fixtures/`. Never put fake match results, statuses or metrics in app code.

### M0: Scaffold (done by humans)
- Project builds; `/api/health` works; `bash scripts/test.sh` is green.

### M1: Engine + building blocks (target: 6:00 a.m. Sat)
- Backend (p1-a): `server/domain/routing.ts` (Dijkstra on durationMin, cached; baseline through waypoints; best single-stop insertion) and `server/domain/matching.ts` (evening direct, morning direct, one-hub relay candidates + greedy allocation, spec §6). Spec tests 1–5 and 10 pass against `fixtures/relayFixture.json`.
- Backend (p1-b): `server/domain/pricing.ts` + `server/domain/metrics.ts` as pure functions with unit tests; start `server/domain/simulation.ts` timeline builder from a DeliveryPlan.
- Backend (victor-1): `server/store.ts` (single serialized mutation path, temp file + rename), `GET /api/businesses`, `GET /api/employees`, `GET /api/map`, and typed fetch helpers in `client/src/api/` for every endpoint in `shared/api.ts`.
- Frontend (p2-a): UI kit in `client/src/ui/` (Button, Card, StatusPill, Field with inline error, Drawer, Toast, EmptyState, Spinner), app shell header with portal switch + Demo account selector + "Synthetic city · simulated deliveries" badge, router for `/`, `/business/:id`, `/employee/:id`, `/simulator`, and the `/` landing page.
- Frontend (p2-b): CommuteEditor and JobCard components taking `shared/` types as props; component tests with sample objects.
- Frontend (victor-2): `CityMap.tsx` renders any `Graph` + businesses + hubs as SVG (roads, building icons, blue hubs, homes, legend, highlighted route prop); a test renders `fixtures/relayFixture.json`.
- Checkpoint: `/` shows the landing page; fixture relay test passes.

### M2: Pipeline + demo city (target: 10:00 a.m. Sat)
- Backend: `POST /api/shipments` (idempotent by clientRequestId) → plan, one job per leg, notifications in one state update; `GET/PATCH /api/shipments/:id`, `POST /api/shipments/:id/match`; `PUT /api/employees/:id/commute` (retries unmatched); business + employee dashboards; `GET /api/jobs/:id`. Spec test 9 passes.
- Backend: `fixtures/demoScenario.json`, the designed Demo city (12 businesses, 6 hubs, 60 employees, 24 packages, at least 2 clear direct and 2 clear relay matches), loaded when `data/state.json` is missing.
- Frontend: business Send-a-package form wired to `POST /api/shipments` with Delivery arranged / No matching commute yet cards; employee commute editor wired to `PUT .../commute` with route previews on CityMap.
- Checkpoint: `curl -X POST /api/shipments` returns a matched plan with job IDs, and the employee dashboard lists the job. HUMAN CHECK: Victor reviews the demo city on the map.

### M3: Simulation + live portals (target: 2:00 p.m. Sat)
- Backend: timeline with stable tie order (hub_drop before hub_pickup), pure `snapshotAt`, per-edge/per-stop position interpolation, one server clock (930 → 2160, speeds 30/120/600), `GET /api/simulator`, `POST /api/simulator/control`, run frozen at playback start, restore paused after restart. Spec tests 6, 11, 12, 13 pass.
- Frontend: business Overview/Outgoing/Incoming lists + tracking drawer; employee assigned-jobs feed, job detail, earnings; 1 s polling on every page, refetch after actions; all loading/empty/success/no-match states.
- Checkpoint: two-tab demo steps 1–4 work with no manual refresh.

### M4: Simulator UI (target: 7:00 p.m. Sat)
- Simulator page: animated CityMap with moving vehicles and packages, package queue with status filters, selected-package detail panel with links to tracking and job pages, playback bar (play/pause, speed, next event, jump to morning, finish, reset), metrics cards (Projected vs actual, no NaN).
- Checkpoint: full demo steps 1–6 work on main.

### M5: Nice-to-haves 11–16, in SPEC order (7:00 p.m. – 11:00 p.m. Sat; whatever is unfinished at 11 p.m. is cut)
- Direct vs relay comparison first if not already done (it is the pitch's proof slide).

### M6: Feature freeze (11:00 p.m. Sat onward; ~10 h buffer before submission)
- Bug fixes only; no new features or new files outside tests/README. Agents work from a human-written bug list.
- 390 px check, reduced motion, README with setup + demo steps, production build on a fresh clone, demo recording.
- 5:00 a.m. Sun: hard code freeze. After that only humans touch main (pitch, video, Devpost).

## Definition of done
- `bash scripts/test.sh` passes on main.
- Demo path above works on a fresh clone with `npm install && npm run dev`.
- Every visible control is wired to real backend state; no hardcoded numbers.
