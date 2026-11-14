# SPEC: Relay

> **MVP II (added 11:40 a.m. Sat) is at the bottom of this file and overrides anything above that conflicts with it**, including "Out of scope: external APIs" and the synthetic 12×12 grid. M0–M6 below are done or superseded.


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

---

# MVP II: real NYC, Google Maps, enterprise redesign (added 11:40 a.m. Sat)

## What changes and why
MVP 1 works on a synthetic grid. MVP II moves Relay to **real NYC locations with real Google travel times**, makes **relay points ordinary network businesses** (no separate hub entity), and **redesigns the whole UI** (`docs/mvp2-ui-redesign.md` is the source of truth for all UI work).

**This intentionally changes the backend, the data model and the `shared/` contracts.** "Preserve existing behavior" does not apply where this section says otherwise. Safety net: git tag `mvp1` is the last MVP 1 build.

## Rules for MVP II
1. **External APIs allowed, and only these:** Google Routes API (server), Geocoding API (server), Maps JavaScript API (browser). No other external services, no runtime LLM.
2. **Keys:** `.env` holds `GOOGLE_MAPS_SERVER_KEY` and `VITE_GOOGLE_MAPS_BROWSER_KEY`. Never commit, print, log or paste keys (not in code, issues, PRs, QUESTIONS.md or test output). Agents do not have the keys: all tests run on cached data or a fake travel provider. If a key is missing at runtime, the API returns a clear 503 error and the UI shows it. **Never invent travel times or distances.**
3. **Cache first:** Google data is fetched once by a script a human runs, saved under `fixtures/nyc/`, and committed. The app and tests read the cache. Only a newly entered commute calls Google live, and its result is added to the cache.
4. **Reproducible:** routing preference TRAFFIC_UNAWARE, travel mode DRIVE. Same inputs, same numbers.
5. **Homes are only commute endpoints.** Pickups, drop-offs and overnight storage happen only at network businesses, never at homes.
6. **Synthetic homes, real neighborhoods:** employee homes are deterministic (seeded) synthetic points inside real NYC residential neighborhoods, labeled by neighborhood only (e.g. "Astoria"). Never a real person's address.
7. Keep what still applies from MVP 1: one shared server clock, pure `snapshotAt`, deterministic IDs, the package → match → jobs pipeline, two-tab sync, all spec tests that still make sense. The §9 relay fixture stays as a unit test of the matcher using a fake travel provider.
8. The MVP 1 demo flow must keep working at every merge (on NYC data once it lands). A merge that breaks it is P0.

## Data model
- **NetworkBusiness:** id, name, address, neighborhood, borough, lat, lng. Every network business is also a relay point (can hold packages overnight). The separate `Hub` entity is removed; `DeliveryPlan.hubId` becomes `relayBusinessId`.
- **Home:** id, neighborhood, lat, lng (synthetic).
- **Employee:** works at one network business, has one home, evening/morning departure, availability flags, max extra minutes. Waypoints are removed.
- **TravelProvider interface** (in `shared/`): `durationMin(a, b)`, `distanceM(a, b)`, `polyline(a, b)` between places (business or home). Implementations: `CachedProvider` (reads `fixtures/nyc/`), `GoogleProvider` (live, server key, writes to cache), `FakeProvider` (tests). Durations are Google seconds rounded **up** to whole minutes, used the same way everywhere.

## NYC data set
- `fixtures/nyc/businesses.json`: **18 real, well-known NYC businesses** with name and street address only (coordinates come from the Geocoding API in the fetch script, never typed from memory). Spread: 8 Manhattan (Midtown, Chelsea, FiDi, Upper West Side), 6 Brooklyn (DUMBO, Williamsburg, Park Slope, Downtown Brooklyn), 4 Queens (Long Island City, Astoria). Mix of offices, shops and cafés so packages make sense.
- `fixtures/nyc/neighborhoods.json`: 8–10 residential neighborhoods with a bounding polygon or box each (e.g. Astoria, Park Slope, Bushwick, Harlem, Upper East Side, Jackson Heights, Bay Ridge, Washington Heights).
- **Curated demo story (the default scenario):** hand-pick the businesses, employees and packages so a judge understands Relay immediately and it looks as good as possible. Example shape: a Brooklyn design studio sends proofs to a Midtown agency via an employee who already commutes between them (direct); a Long Island City bakery sends a gift box to a Chelsea office, relayed overnight through a DUMBO café that sits on both commuters' routes (relay). Each package has a believable name and description; each featured employee has a name, an employer and a home neighborhood that explains their route. Hand-place the featured employees' home points on real residential blocks in their neighborhood (`fixtures/nyc/demoStory.json`, coordinates reviewed by a human). Cherry-picking is encouraged: choose pairs where commutes genuinely overlap so detours are small and routes look clean on the map.
- Default workload: 18 businesses, 60 employees (the featured story employees plus seeded background commuters spread over the neighborhoods), 24 packages. At least 2 clear direct and 2 clear relay matches in the story. The seeded "Random city" preset stays for experimentation.

## Fetch script (`npm run fetch:routes`, run by a human)
- Reads `.env`. Geocodes the businesses. Generates the seeded homes.
- Uses the Routes API **computeRouteMatrix** for durations and distances of every needed pair: home→business, business→business, business→home. Writes `fixtures/nyc/matrix.json`.
- Uses **computeRoutes** for encoded polylines of each employee's baseline commutes and of every pair used by the demo scenario's matched plans. Writes `fixtures/nyc/polylines.json`. The server fetches any other polyline on demand (with the key) and caches it.
- Batches requests within API limits, retries politely, prints a summary (pairs fetched, failures), never prints the key. Re-running is safe (skips cached pairs).

## Matching (same three candidate types, new geometry)
- Evening direct: employee of A drives A → B → home. Morning direct: employee of B drives home → A → B. Relay: employee of A drives A → R → home (Day 1); employee of B drives home → R → B (Day 2), where **R is any network business other than A and B**.
- Extra minutes = travel time through the stops in order + 2 min handling per pickup/drop-off + waiting − baseline commute time. Same feasibility rules as MVP 1 (detour limit, ready time, deadline, relay ordering, one package per trip, different employees for relay legs). Same greedy allocation and tie-breaks. For relays, try every R and keep the best by the existing sort.
- Must stay under 2 s on the default workload using the cache.

## Simulator and animation
- UI per `docs/mvp2-ui-redesign.md` §1 (full-width map, left controls, right inspector, no top cards, focus mode, clear interactions).
- Map: Google Maps JavaScript API with a custom simplified light style (hide POI labels, transit, most road labels; muted water/parks; light gray roads) + deck.gl overlay (`@deck.gl/google-maps`). Google route lines are only drawn on the Google basemap.
- Movement: interpolate along each leg's decoded polyline in proportion to elapsed travel time between stops; vehicles stop during handling; a package follows its carrier only between pickup and drop-off and stays at the relay business overnight.

## Milestones (planner: current milestone is M7)

### M7: Foundation (target 2:00 p.m. Sat)
- victor-1 FIRST (everyone depends on it): update `shared/` for the MVP II data model and TravelProvider (this issue is explicitly allowed to edit `shared/`). Keep it small and merge fast.
- victor-1: `server/geo/` providers (Cached, Google, Fake) + `scripts/fetch-routes.ts` + `npm run fetch:routes` + server geocode endpoint for the employee address search.
- p1-b: `fixtures/nyc/businesses.json` + `neighborhoods.json` + `demoStory.json` (curated story) + seeded NYC scenario generator for background commuters, on the new model.
- p1-a: matcher on TravelProvider with relay = network business; port spec tests (FakeProvider); remove grid routing and waypoints.
- p2-a: design tokens (IBM Plex, colors, radii, spacing), app shell/header, new homepage per the redesign doc.
- p2-b: Employee workspace redesign; commute editor with address search (geocode endpoint) instead of node picking.
- victor-2: new full-width simulator layout (left/right panels) with the Google map + deck.gl overlay rendering network businesses from fixtures.
- **HUMAN CHECKPOINT:** once the providers, script and business list merge, Victor runs `npm run fetch:routes` with the real key, checks the output, and commits `fixtures/nyc/`.

### M8: Integration (target 6:00 p.m. Sat)
- Demo scenario on cached NYC data, fully matched on load, 2+ direct and 2+ relay.
- Simulator: routes, moving vehicles/packages along polylines, selection, focus mode, right inspector, left controls wired to the existing API.
- Business workspace redesign (shipments table, New delivery, search/filters, details + match results).
- Saving a new employee address calls Google live (server key), caches, and re-matches unmatched packages.
- End-to-end test of the full demo flow on cached NYC data.

### M9: Polish (target 10:00 p.m. Sat)
- Visual QA against `docs/mvp2-ui-redesign.md`, 390 px for Business/Employee, keyboard and focus states, reduced motion.
- README: Google key setup (APIs to enable, two keys, restrictions, `.env`), `npm run fetch:routes`, demo steps.
- 11:00 p.m. feature freeze and 5:00 a.m. code freeze unchanged (see M6).
