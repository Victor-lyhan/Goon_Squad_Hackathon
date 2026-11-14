# Relay one night MVP build specification

## Build objective

Build a complete local web application that matches business packages to employees' existing commutes and simulates those deliveries on an animated city map.

The core flow is **employee saves their commute → business submits a package request → backend finds a match → business receives a delivery confirmation → employee receives a job → simulator advances the same delivery in both portals**.

This specification replaces the previous, broader plan. Focus on normal operation. Assume every participating employee accepts and completes their assigned trip, all sites are accessible, and hubs have sufficient storage. Do not implement cancellations, disruptions, recovery agents, insurance, payment processing, or production accounts.

The result should be a functional hackathon web app with separate business and employee portals, a real local matching backend, shared persisted state, and a convincing simulator. The portals communicate through HTTP APIs, not separate browser-only mock data. No runtime LLM or external API credentials are needed. AI is the implementation tool; the product's intelligence comes from matching and optimization.

## 1. The exact MVP

Relay coordinates small, nonurgent packages between businesses in a fictional city. Employees travel home from their employer on Day 1 and return on Day 2. A package travels either directly with one employee or through one hub with two employees.

### Functional requirements

1. Load a polished example city on first launch.
2. Provide dedicated business and employee portals for entering delivery requests and travel routes.
3. Generate a larger synthetic scenario from a seed and a few controls.
4. Compute valid direct and one-hub relay delivery plans.
5. Allocate employee trips without assigning a trip to two packages.
6. Return a backend-generated match confirmation to the business and create an assigned job for every employee leg, with shared shipment and plan IDs.
7. Animate a complete evening-to-next-morning delivery cycle.
8. Update package statuses, employee earnings, and dashboard metrics from the simulation.
9. Compare direct-only matching with direct-plus-relay matching on identical inputs.
10. Persist shared state on the backend, synchronize both portals, and export/import the complete scenario as JSON.

### Simplifying assumptions

- One small standardized package per employee trip.
- One evening trip and one next-morning trip per employee.
- At most one intermediate hub and two different employees per package.
- Hubs and business pickup/drop-off areas are accessible throughout the simulation.
- Hub storage is unlimited in this MVP.
- All registered employees are willing participants; assignments are automatically accepted.
- Deterministic road travel times; no traffic, cancellation, loss, or late-arrival randomness.
- Two minutes of handling at every package pickup or drop-off.
- Default maximum additional commute time: eight minutes per trip, including handling.
- Payments are simulated ledger totals.
- Unmatched packages stay visibly unmatched. No courier dispatch integration.

Use a persistent “Synthetic city · simulated deliveries” label. These assumptions are intentional scope choices, not hidden features.

## 2. Technical approach

Use a single TypeScript repository with a React frontend and lightweight Node/Express backend. The backend owns businesses, commutes, packages, route calculations, assignments, employee jobs, notifications, simulation time, and metrics. The frontend displays API responses and sends actions.

| Area | Tool / approach |
|---|---|
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind or plain CSS, consistent shared components |
| Backend | Node.js + Express + TypeScript |
| Validation | Shared Zod request/response schemas |
| City map | SVG rendered from the same road graph used for routing |
| Routing and matching | Pure TypeScript modules executed on the backend |
| Simulator | Backend-owned event timeline and simulation clock |
| Persistence | One local JSON state file with serialized atomic writes |
| Synchronization | Poll relevant API snapshots every second; refetch after actions |
| Tests | Vitest domain/API tests and a two-tab browser walkthrough |
| Delivery | One command starts frontend/backend; production server serves built frontend |

Use a local JSON file to avoid database setup. Update state through one serialized mutation path, then write a temporary file and rename it over the previous state file. Persist entities, assignments, jobs, notifications, and simulation state on edits and pause/reset, not every animation frame. Browser localStorage may remember the chosen demo identity, but never holds authoritative delivery data.

Use SVG rather than a live mapping API. Render roads, districts, businesses, hubs, homes, routes, and moving vehicles from local data. The app works without external services after installation. A Vite development proxy forwards `/api` to the backend. Production serves frontend and API from the same origin.

No cloud database, paid routing service, solver service, production authentication, or runtime LLM is required. Use seeded identity selectors labeled “Demo account.” Separate browser tabs selecting a business and employee must see the same backend data. This is not production authorization or tenant isolation.

Setup references: https://vite.dev/guide/ , https://react.dev/learn , https://expressjs.com/en/starter/hello-world/ , https://zod.dev/ . Use compatible versions and commit the lockfile.

## 3. Three polished product surfaces

Use a consistent Relay brand across `/business/:id`, `/employee/:id`, and `/simulator`. A header lets judges switch portal and demo identity. Each portal should feel like a product for that user, not a generic admin table.

### A. Business portal

Desktop layout: compact left navigation, business name and New delivery action at the top, summary cards, and outgoing/incoming shipment lists. Use a right-side package detail drawer. Navigation: Overview, Send a package, Outgoing, Incoming. The selected business is automatically the sender.

**Send a package form:**

| Field | UI and behavior |
|---|---|
| Destination business | Searchable selector of other registered businesses; show name, district, and location |
| Package name | Required text, e.g. Orientation brochures |
| Category | Envelope or small box; both use one standard package slot |
| Description / contents | Short description of what is being sent |
| Weight | Numeric kilograms, greater than zero and at most 2 kg |
| Ready for collection | Day and time picker, default Day 1 at 16:00 |
| Deliver by | Day and time picker, default Day 2 at 10:00 |
| Pickup/drop-off instructions | Optional text, e.g. Collect from reception |
| Review | Origin/destination mini-map, package details, times, and assumed $10 price |

One request represents one package. Include Duplicate request for several similar packages; do not build bulk inventory management.

The primary button is **Find a delivery match**. It POSTs to the backend, shows “Matching your package”¦”, and waits for a real response. Prevent double submission while pending. Do not invent a browser-side success card.

**Matched result:** a prominent **Delivery arranged** card shows shipment ID, package details, recipient business, collection time, estimated arrival, price, carriers, and intermediate hub if any. Include a compact timeline and View tracking action. Distinguish requested deadline from calculated arrival. Create a persistent in-app notification as well as the confirmation card.

**Unmatched result:** “No matching commute yet,” with the backend reason and Edit request / Try again actions. Keep the package in the list. Saving another employee route automatically retries unmatched requests before simulation begins.

**Tracking detail:** package contents, requested times, route map, carrier legs, ETA, and progress through Scheduled → Picked up → At hub (relay only) → Out for delivery → Delivered. Incoming packages also appear in the recipient business portal. Both businesses eventually see the same delivered timestamp.

### B. Employee portal

Mobile-first layout: welcome header, simulated earnings summary, My commute card, and assigned-jobs feed. Desktop places the route map beside the editor; mobile uses stacked cards and a sticky Save commute button.

**My commute editor:**

- Employer selected from registered businesses.
- Home/start location selected by clicking a road node or choosing a named location.
- Evening employer-to-home route with Day 1 departure time.
- Morning home-to-employer route with Day 2 departure time.
- Separate availability toggles for the evening and morning trips.
- Maximum additional minutes slider, default eight.
- Map previews of normal routes and durations.
- Optional Adjust my route: click up to three ordered intermediate road nodes separately for each direction. Preview the resulting route before saving.

**Save commute and find jobs** sends these fields to the backend. Show the persisted route returned by the API and confirmation that it is available for matching. The matcher must honor saved routes, including optional waypoints. Editing is available before an active simulation locks the plan.

**Assigned job card:** show New delivery job, package name/category/weight, sender and recipient, pickup site/time, drop-off site/time, added minutes, reward, and direct/relay leg. For the first relay employee, the drop-off is the hub; for the second, pickup is the hub. Show the ultimate business destination as context.

**Job detail:** normal commute as a faint line, augmented route highlighted, stop instructions, package details, expected finish time, and reward. Explain “Drop at Hub H; another employee completes delivery” or “Collect from Hub H and deliver to Business B.” Jobs progress Assigned → In progress → Completed from simulator events. Completed jobs move into history and add to earnings.

All jobs are automatically accepted. The action is View job, not a nonfunctional Accept button. Do not build offers, declines, scanning, or camera permissions.

### C. Network simulator

A separate control room uses exactly the same businesses, commutes, packages, plans, and jobs submitted through the portals.

- Top: delivered/requested, matched/requested, average added minutes, projected savings, employee earnings.
- Center: large animated city map.
- Left: package queue with status filters.
- Right: selected package timeline, businesses, employee jobs, price, and added minutes.
- Bottom: play/pause, reset, speed, timeline scrubber, next event, and Jump to morning.
- Setup drawer: generate city, seed, employee/package/hub counts, detour limit, import/export, direct-only versus relay comparison.
- Links from the selected package to business tracking and employee job pages, preserving IDs.

Use a light map, subtle gray roads, business building icons, blue hubs, small homes, and colored package/vehicle markers. Highlight selected routes; avoid hundreds of bright lines. Include a legend, visible simulation day/time, and synthetic-data badge.

### Visual quality requirements

Use an off-white background, white panels, dark navy text, one blue/teal accent, generous spacing, rounded cards, and consistent icons. Readable 14”“16 px body text; clear headings. Forms have descriptive labels, inline validation, and defaults. Show friendly location labels instead of raw node IDs. Status pills combine text and color. Match confirmations and employee job cards should be the visual focus.

Implement loading, empty, success, and no-match states. Toasts supplement persistent notifications. Primary buttons work, keyboard focus is visible, and the employee portal fits a 390 px viewport. Support reduced motion.

Business/employee creation and deletion can live in the demo setup drawer. Prevent deletion of referenced records. After playback starts, disable input edits and offer Start new planning cycle, which resets assignments/jobs/playback while retaining entity inputs. Do not build mid-delivery editing or recovery.

### Exact backend interaction

1. Employee saves a commute. Backend validates it, calculates baseline routes, persists trips, and retries pending requests.
2. Business submits a package. Backend validates it, persists the request, and matches against available trips.
3. On a match, reserve the trips, save one plan, create one employee job per leg, and create business/employee notifications in the same state update.
4. Business receives the confirmation in the POST response. Employee and recipient-business portals see the same records on their next poll, within approximately one second.
5. Simulator advances those exact plan/job IDs. Tracking, jobs, earnings, and metrics read the same server snapshot.

Keep existing assignments reserved when new requests arrive. Retrying a matched request returns its existing plan/jobs. Only explicit reset/recompute before playback can replace all assignments.

### Required API

| Method and path | Contract |
|---|---|
| `GET /api/businesses` | Registered businesses and friendly locations |
| `GET /api/businesses/:id/dashboard` | Outgoing/incoming shipments, plans, notifications, totals |
| `POST /api/shipments` | Package form → shipment, matched/unmatched status, plan, job IDs, reason |
| `PATCH /api/shipments/:id` | Edit unmatched request before playback, then retry |
| `POST /api/shipments/:id/match` | Retry or return existing assignment |
| `GET /api/shipments/:id` | Package details, plan, tracking, current status |
| `GET /api/employees/:id/dashboard` | Commute, assigned/completed jobs, earnings, notifications |
| `PUT /api/employees/:id/commute` | Save endpoints, waypoints, departures, availability, detour limit; return calculated routes |
| `GET /api/jobs/:id` | Delivery leg, package, route, times, reward, status |
| `GET /api/simulator` | Shared snapshot, clock, run ID, version, map data, metrics |
| `POST /api/simulator/control` | Play, pause, seek, next event, jump to morning, finish, reset playback |
| `POST /api/scenario/generate` | Generate an explicitly selected synthetic world |
| `POST /api/planning/reset` | New cycle retaining business/employee/package inputs |
| `POST /api/matches/recompute` | Before playback, replace assignments/jobs/notifications with fresh results |
| `POST /api/matches/compare` | Direct-only and relay results without modifying live assignments |
| `GET /api/scenario/export` and `POST /api/scenario/import` | Export/restore validated shared scenario and run |

Add simple business/employee CRUD endpoints for the setup drawer. Validate that sender and recipient differ, package weight is within the supported range, required fields are present, the deadline follows readiness, times fall within the simulated cycle, and every selected location exists. Return descriptive errors beside the relevant form fields. Attach a client request ID to package creation so retried POSTs return the same shipment. No background queue, push service, or WebSocket framework is needed.

## 4. Data contracts

Use minutes since Day 1 midnight for time, meters for distance, and integer cents for money. Day 2 times therefore exceed 1440. Format them as “Day 2, 8:30 AM.” Round calculated edge travel times up to whole minutes and use that same value everywhere.

```ts
type Node = { id: string; x: number; y: number };
type Edge = {
  from: string; to: string; distanceM: number; durationMin: number;
};
type Business = { id: string; name: string; nodeId: string };
type Hub = { id: string; name: string; nodeId: string };
type Employee = {
  id: string; name: string; businessId: string; homeNodeId: string;
  eveningDepartureMin: number; morningDepartureMin: number;
  maxExtraMin: number; availableEvening: boolean; availableMorning: boolean;
  eveningViaNodeIds: string[]; morningViaNodeIds: string[];
};
type Trip = {
  id: string; employeeId: string; originNodeId: string;
  destinationNodeId: string; departureMin: number;
  baselineNodeIds: string[]; baselineDurationMin: number;
  baselineDistanceM: number;
};
type Shipment = {
  id: string; label: string; originBusinessId: string;
  destinationBusinessId: string; readyMin: number; deadlineMin: number;
  category: 'envelope' | 'small_box'; description: string; weightGrams: number;
  pickupInstructions: string; dropoffInstructions: string;
};
type Stop = {
  nodeId: string; kind: 'pickup' | 'hub_drop' | 'hub_pickup' | 'delivery';
  arrivalMin: number; serviceStartMin: number; serviceEndMin: number;
};
type Leg = {
  tripId: string; employeeId: string; routeNodeIds: string[];
  stops: Stop[]; finishMin: number; extraMin: number;
  extraDistanceM: number; rewardCents: number;
};
type DeliveryPlan = {
  id: string; shipmentId: string; kind: 'direct' | 'relay';
  legs: Leg[]; hubId?: string; deliveryMin: number;
  customerPriceCents: number; platformContributionCents: number;
};
type Job = {
  id: string; planId: string; shipmentId: string; employeeId: string;
  legIndex: number; tripId: string; pickup: Stop; dropoff: Stop; rewardCents: number;
};
type Notification = {
  id: string; audience: 'business' | 'employee'; audienceId: string;
  kind: 'delivery_matched' | 'job_assigned'; shipmentId: string;
  planId: string; jobId?: string; message: string;
};
type SimEvent = {
  id: string; timeMin: number; shipmentId: string;
  kind: 'pickup' | 'hub_drop' | 'hub_pickup' | 'delivered';
  employeeId: string; hubId?: string;
};
```

A Scenario contains seed, graph, businesses, hubs, employees, shipments, and settings. Derive trips from saved employee routes and enabled availability. An AssignmentResult contains selected plans, unmatched IDs/reasons, and computation time. A Run contains an immutable scenario snapshot, assignments, jobs, events, clock, and speed. Derive job IDs from plan ID plus leg index. All notifications and jobs reference the same plan and shipment records returned to the business.

Persist scenario, assignments, jobs, notifications, and last paused simulation time in the backend file with a schema version. Validate imports before replacing state. Derive job and shipment progress from the authoritative simulation snapshot; do not maintain conflicting status copies in the portals.

## 5. Scenario generation

Provide two presets: a deliberately designed “Demo city” with clear direct and relay examples, and a seeded “Random city” for experimentation.

Default workload: 12 businesses, 6 hubs, 60 employees, 120 trips, and 24 packages. Controls may range from 10”“200 employees, 5”“60 packages, and 0”“10 hubs. Initial demo uses the default workload; prioritize readability over drawing every vehicle.

Generate a connected 12 × 12 road grid. Each grid edge represents 500 meters and two minutes of driving. Add both directed edges for ordinary two-way roads. Group businesses around central employment districts, homes toward residential districts, and hubs near district connectors. Keep some homes/businesses in different districts to produce useful route overlap.

Each employee works at one business and has one home. Generate an evening employer-to-home trip departing between 17:00 and 18:00 on Day 1 and a morning home-to-employer trip departing between 07:00 and 08:30 on Day 2. Seed availability as enabled and waypoint lists as empty; employees can change these in their portal. Compute normal routes from the road graph. Seed complete package metadata and friendly business/location names so generated records use exactly the same API contracts and cards as manually entered records.

Generate packages between different businesses, ready at 16:00 Day 1 and due by 10:00 Day 2 by default. The user can edit these times. Random package demand is independent of matching; do not discard unfavorable random seeds.

Use one seeded pseudorandom generator. Generate a maximum employee roster first and take a prefix when changing employee count so comparisons can reuse the same city and packages. Changing only the detour limit must not regenerate the city.

The designed preset may intentionally include good matches. The random preset may produce unmatched packages. Label these presets accurately and compute all routes and metrics in both.

## 6. Matching algorithm

Implement a working deterministic heuristic first. An exact mathematical solver is unnecessary for this overnight MVP. In the UI call the action “Find matches”; do not claim a globally optimal solution.

### Calculate candidate delivery plans

For each package A → B, enumerate:

1. **Evening direct:** an employee of A follows A → B → home.
2. **Morning direct:** an employee of B follows home → A → B.
3. **One-hub relay:** an employee of A follows A → H → home on Day 1; an employee of B follows home → H → B on Day 2, for each hub H.

Calculate the baseline through the employee's saved ordered waypoints. Preserve that route when adding a delivery. Try inserting the additional business/hub stop between each consecutive pair of baseline nodes: replace edge u → v with shortest paths u → added stop → v and retain the remaining baseline edges in order. Visiting a stop already on the route adds handling only. Choose the feasible insertion with least additional time. This honors the route the employee supplied instead of silently replacing it with a different commute. Cache routing calculations.

Employer pickup at the start or employer delivery at the end adds handling at that endpoint. Include the complete commute, including travel after depositing the parcel. Stop the package animation following the driver after drop-off.

Add two minutes at every pickup and drop-off. Handling at the commute origin or destination still counts. If a driver arrives before a package is ready, waiting is permitted and counts toward added time.

```text
augmented_finish = departure + driving + handling + waiting
extra_minutes = augmented_finish - (departure + normal_commute_duration)
```

A candidate is valid only if every leg stays within that employee's added-time limit, the package is picked up after it is ready, the final delivery completes by its deadline, and the two relay legs use different employees. For a relay, hub pickup cannot begin before deposit completes. Travel follows the graph; packages cannot move merely because routes look close on screen.

Keep the normal route fixed when evaluating candidates. Use distance along the same routes used for timing. One package reserves the employee's entire trip, even if the parcel is dropped off partway through it.

### Allocate trips

1. Generate valid candidates for every package.
2. Sort packages by fewest valid candidates, then earliest deadline, then ID.
3. Sort each package's candidates by lowest carrier-plus-hub cost, then lowest total extra minutes, then earliest arrival, then stable ID.
4. Choose the first candidate whose trip IDs are all unused.
5. Reserve those trips and continue.
6. If no candidate is available, mark the package unmatched with a short reason.

Precompute each source employee/hub and hub/destination employee leg, then pair compatible legs. Cache shortest paths. Avoid repeatedly routing the same node pair inside nested loops. Target less than two seconds for the default scenario, but measure the actual time rather than fabricate a performance number.

For new requests, preserve existing assignments and allocate only unreserved trips. Explicit full recompute applies the algorithm to all requests before playback and replaces planned assignments. Do not build assignment swapping, CP-SAT, multi-hop planning, or a complex optimization service.

### Direct versus relay comparison

Run the same matcher twice on the same immutable scenario: once with direct candidates only, once with direct and relay candidates. Compare matched packages, extra minutes, and customer cost. The comparison must not change the user's current run unless they select that plan. Display actual results even if the greedy heuristic does not improve every metric.

## 7. Simulator

This is a real deterministic delivery simulator, not a prewritten animation. Its input is the calculated assignments; its outputs are package states, positions, events, and totals.

After matching, generate a sorted timeline from each plan's stop completion times:

- Pickup completed: waiting → in transit.
- Hub drop completed: in transit → at hub; first carrier earns their reward.
- Hub pickup completed: at hub → in transit.
- Destination delivery completed: in transit → delivered; final carrier earns their reward and customer charge is recorded.

For direct service, pickup goes straight to delivery. Unmatched packages remain unmatched. Use a stable tie order so a deposit precedes retrieval at the same instant. Treat the two minutes of handling consistently: custody changes at completion; show the marker stationary while service is underway.

Implement `snapshotAt(run, time)` as a pure backend function deriving package statuses, employee job statuses, earnings, and deliveries from elapsed timeline events. A first-leg job completes at hub deposit while the package remains undelivered. Rewind/reset/scrubbing therefore require no rollback logic or duplicate payments.

The backend advances one shared clock using a simple timer while playing and exposes snapshots to all portals. React polls every second and may interpolate positions for smooth animation, but cannot independently declare delivery or pay rewards. Play/pause/seek affect every portal. Refreshing or opening a new tab cannot create another clock. Restore the server after restart in paused mode.

For map animation, give every route edge and service stop a start and end time. Interpolate a driver's position along the current edge according to elapsed travel time. A package follows its carrier only between pickup and drop-off, stays at the hub overnight, and then follows its second carrier. Do not interpolate along the whole polyline by total elapsed time because handling creates pauses.

Simulation window: Day 1 15:30 through Day 2 12:00. Playback options: 30, 120, and 600 simulated minutes per real second. Include “Next event,” “Jump to morning,” and “Finish simulation” so judging does not require watching an empty night.

Freeze the run at playback start. New submissions/route edits require a new planning cycle; explain this in the forms. Reset playback rewinds the same plans; Start new planning cycle clears assignments/jobs and enables editing. The simulator calls no external service.

## 8. Pricing and metrics

Use simple editable assumptions:

| Assumption | Default |
|---|---:|
| Business price per successfully delivered package | $10.00 |
| Employee reward per completed leg | $3.00 |
| Hub cost per relay package | $0.50 |
| Platform variable cost per completed package | $0.50 |
| Comparison courier price per package | $14.00 |

Projected platform contribution per direct delivery is $6.50; per relay it is $3.00. These exclude overhead and are assumptions, not real market prices. No risk reserve, refunds, payment provider, or billing workflow is needed.

Compute rather than hardcode:

- Matched packages / all requests; delivered packages / all requests.
- Direct deliveries, relay deliveries, and unmatched count.
- Average additional minutes per assigned commuter trip, plus maximum.
- Employee rewards earned so far from completed legs.
- Projected customer savings: matched count × (assumed courier price âˆ’ Relay price).
- Projected customer spend for all demand: matched count × Relay price + unmatched count × courier price. Label the unmatched portion an external-delivery cost assumption; those packages are not simulated as delivered.
- Projected platform contribution from selected plans; earned contribution only for completed packages.
- Additional commuter distance: sum of augmented commute distance minus baseline commute distance for assigned trips, counting each trip once.

Do not label the entire baseline commute as avoided travel. Do not add emissions calculations, a consolidated-van simulator, or citywide congestion claims to this MVP. The pitch can describe environmental potential without pretending it has been validated.

Forecast cards must say “Projected.” Playback cards must reflect events that have actually occurred in simulation. When a denominator is zero show 0 or an em dash, never NaN.

## 9. Exact fixture for the first working delivery

Implement this small constructed graph before the larger grid:

| Directed road | Minutes | Meters |
|---|---:|---:|
| A → X | 20 | 7000 |
| A → H | 10 | 3500 |
| H → X | 12 | 4200 |
| Y → B | 20 | 7000 |
| Y → H | 10 | 3500 |
| H → B | 12 | 4200 |

A/B are businesses, H is a hub, X/Y are homes. Only listed edges exist. This unit fixture contains only the two explicitly defined trips; do not derive their reverse commutes on this deliberately partial graph. The larger city generator supplies both daily trips on its connected graph. Employee 1 works at A and leaves for X at 17:00 Day 1. Employee 2 works at B and leaves Y at 08:15 Day 2. The package is ready at A at 16:00 Day 1 and due at B at 09:00 Day 2. Both employees allow eight additional minutes.

Expected calculated plan:

- Employee 1 picks up 17:00”“17:02, drives to H, deposits 17:12”“17:14, and reaches home 17:26. Normal arrival would be 17:20; added time is six minutes.
- Employee 2 reaches H 08:25, retrieves 08:25”“08:27, drives to B, and delivers 08:39”“08:41. Normal arrival would be 08:35; added time is six minutes.
- Package reaches B at 08:41, before its deadline.
- Extra driving is 700 meters per employee, 1.4 km total.
- Total employee reward is $6; projected platform contribution is $3; assumed customer savings are $4.

Lower either employee's limit to five minutes and this relay becomes infeasible. That is sufficient to demonstrate that the matching engine reacts to inputs.

## 10. Repository and completion checks

```text
client/src/
  api/client.ts
  components/CityMap.tsx
  components/ShipmentForm.tsx
  components/CommuteEditor.tsx
  components/JobCard.tsx
  components/Timeline.tsx
  pages/BusinessPortal.tsx
  pages/EmployeePortal.tsx
  pages/Simulator.tsx
server/
  index.ts
  api/businesses.ts
  api/employees.ts
  api/shipments.ts
  api/simulator.ts
  domain/generator.ts
  domain/routing.ts
  domain/matching.ts
  domain/simulation.ts
  domain/metrics.ts
  store.ts
shared/
  schemas.ts
  types.ts
fixtures/
  demoScenario.json
tests/
```

Provide working `npm run dev` (both processes), `npm run build`, `npm start` (API plus built frontend), and `npm test`. Document setup, port, state-file location, reset, assumptions, and demo sequence. No external credentials needed. Keep API paths relative and shared IDs consistent.

Only write meaningful tests:

1. The exact fixture produces the schedule, distance, and money above.
2. Lowering the added-time limit rejects that fixture.
3. A deadline before arrival rejects a plan.
4. Two packages cannot reserve the same trip.
5. Relay pickup follows deposit and readiness.
6. Rewinding and replaying produce the same statuses and earnings.
7. Identical seed and settings produce identical scenarios and assignments.
8. Export/import preserves the scenario and recalculated results.
9. Business POST creates a stored shipment, calculated plan, and one job per leg; retrying creates no duplicates.
10. Saved employee routes, including waypoints and availability, affect backend matching.
11. Sender, recipient, employee, and simulator responses share plan/job IDs and progress.
12. First-leg job completes/pays at hub deposit while the shipment remains at the hub.
13. Backend restart restores inputs/assignments; a new browser tab reads shared state.

Required two-tab demonstration: save a custom commute in an employee portal; submit a named package to another business from a business portal; see a real confirmation and a new employee job without manually refreshing. Play the shared simulation and confirm both tabs update correctly, including job completion and earnings. Check the recipient's incoming view, refreshing, server restart, and the employee UI at 390 px width. Also exercise no-match, random, and zero-hub scenarios.

A working MVP means every visible control is connected to real state. No decorative buttons, fixed match percentages, or separate fake numbers for the animation.

## 11. One night build sequence

| Budget | Work | Required checkpoint |
|---|---|---|
| Hour 1 | Frontend/backend scaffold, schemas, persistence | Both start; portals save/read shared entities |
| Hours 2”“3 | Routing, matching API, package-to-job pipeline | Business POST creates a valid match and employee jobs |
| Hour 4 | Backend timeline, clock, snapshots, metrics | One run drives package and job progress |
| Hours 5”“6 | Business/employee portals, forms, confirmations, maps | Two tabs exchange requests/jobs through the backend |
| Hour 7 | Simulator UI, playback, synchronization | Animate a relay and see both portals update |
| Hour 8 | Generator and direct/relay comparison | Default city and adjustable scenario work |
| Hour 9 | Styling, import/export, browser checks | Complete reliable demo on a laptop |
| Hour 10 | Fixes, README, build, demo recording | Reproducible final project |

Treat ten hours as a work budget, not a promise. If time is short, reduce scenario size and styling complexity first. Keep both portals, the real backend, and the intake-to-job-to-simulation flow intact. Cut fancy map decoration and comparison charts before cutting functionality. Do not introduce additional sponsor integrations or a runtime AI agent.

## 12. Two minute demo

1. In the employee portal, show a saved commute, departure times, and added-time limit.
2. Switch to a business, choose a recipient, describe the package, and set ready/deadline times.
3. Submit and show the backend's Delivery arranged card, package information, ETA, and price.
4. Switch back to the employee portal: the assigned job is already there, with stops and reward.
5. Open the simulator and play the evening leg; the package stays at the hub overnight.
6. Jump to morning and complete delivery; sender/recipient tracking and employee earnings update from the same run.
7. If time remains, change the detour limit in a new planning cycle and demonstrate the tradeoff.

The message is: “Relay turns existing commutes into a coordinated delivery network. This prototype calculates the matches and simulates the complete delivery cycle.”

## Copy this prompt to the implementing AI

> Build the complete Relay MVP described in this attached specification. Implement working code, not another proposal. Work independently through the build sequence and make routine implementation choices without asking me to approve each one.
>
> Use React/TypeScript/Vite with a Node/Express HTTP backend, shared schemas, server-side routing/matching/simulation, persisted local JSON state, and an SVG city map. No external API keys are required. First make the exact fixture and API package-to-job pipeline work. Then build the business portal, employee portal, and simulator around those backend records.
>
> The essential experience is: an employee saves travel routes/schedules; a business selects another business, enters package details/times, and submits; the backend returns a match confirmation and creates employee jobs/notifications. Build polished separate portals with useful forms, route previews, confirmation cards, tracking, job cards, and earnings. Both portals and the simulator reference the same backend plan/job IDs. Every control works and every number comes from the same calculated scenario.
>
> Assume all carriers participate and complete their assignments, all sites are accessible, and hubs have sufficient storage. Do not implement cancellations, recovery, offer acceptance, authentication, real payments, GPS tracking, QR scanning, traffic uncertainty, LLM agents, or extra sponsor integrations. Do preserve basic time feasibility, one parcel per trip, package readiness/deadlines, and correct relay ordering.
>
> Build the deterministic greedy matcher described here; do not spend the night implementing an exact optimizer. The backend simulator derives state from a sorted event timeline and exposes one shared clock so all portals stay consistent during play, pause, reset, scrubbing, and replay. Show synthetic-data and pricing-assumption labels clearly.
>
> Run core/API tests and verify the entire journey in separate business and employee tabs, including automatic job appearance and synchronized simulation progress. Finish with a polished working local app, a production build, lockfile, sample scenarios, JSON import/export, README, and two-minute demo instructions. Prioritize completing the entire functional flow over extra architecture or edge cases. Report what works, the commands to run it, test results, and any unfinished items honestly.