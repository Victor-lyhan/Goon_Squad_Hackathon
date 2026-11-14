# Relay

Relay turns existing employee commutes into a coordinated B2B delivery network. A business describes a package, the backend matches it to an employee who already drives past the pickup and the drop-off, either directly or through a **relay point** (another business of the network that holds the package overnight), and a simulator plays the whole delivery cycle on a map of New York City.

**Real NYC locations, simulated deliveries.** The businesses are real, well-known NYC businesses. The driving times, distances and route lines between them come from Google; they were fetched once and are committed in `fixtures/nyc/`. The employees, their homes (made-up points, shown by neighborhood only) and the deliveries are simulated by the backend. The default run has 18 businesses, 60 employees and 24 packages.

## What works with and without a key
You need no key to run the app or the demo. Two optional Google keys add the map and live Google calls ([Google setup](#google-setup-keys-and-travel-data)).

| You have | What works |
| --- | --- |
| **No key** (a fresh clone) | Everything in the 2-minute demo, from the committed cache: the homepage, the Business, Employee and Simulator workspaces, Help, matching a new delivery, playback, earnings, and a commute save that keeps the home. The server calls nothing outside your machine. Where a map would be, the page says "Google Maps key missing." and the rest of the page works. |
| **Browser key** (`VITE_GOOGLE_MAPS_BROWSER_KEY`) | Adds the Google map: the network on the Simulator with route lines, moving vehicles and packages, the commute on the Employee page and a delivery's route on the Business page. |
| **Server key** (`GOOGLE_MAPS_SERVER_KEY`) | Adds the live Google calls: the address search and a commute save with a new address (its travel times are fetched and added to the cache), the route lines of a new delivery (without the key its legs have no route line and the vehicle moves straight from stop to stop), and the fetch command `npm run fetch:routes`. |

## Requirements
- Node.js 22 or newer (`engines` in `package.json`)
- npm

No API key or environment variable is needed. `PORT` is optional (default `3001`). The two Google keys are optional and live in `.env` ([Google setup](#google-setup-keys-and-travel-data)).

## Setup and run
```bash
npm install
npm run dev
```
`npm run dev` starts the API on **http://localhost:3001** and Vite on **http://localhost:5173**; Vite proxies `/api` to the API. Open http://localhost:5173.

The main paths:

| Path | Page |
| --- | --- |
| `/` | Homepage: what Relay is, the numbers of the current run, and the three workspaces. |
| `/business/<id>` | Business workspace, for example `/business/biz-brooklyn-roasting`: the deliveries table, **New delivery**, delivery details. |
| `/employee/<id>` | Employee workspace, for example `/employee/emp-7`: the saved commute, assigned deliveries, earnings. |
| `/simulator` | Simulator: the whole network, the package list, playback, and the journey of one package. |
| `/help` | Guided demo: the six demo steps, each with a link to its workspace. |

## Production build
```bash
npm run build   # builds the client into client/dist (the server is not compiled)
npm start       # runs the server with tsx and serves client/dist
```
Open **http://localhost:3001** (override with `PORT`). One process serves the API under `/api` and the built client; there is no Vite proxy. Refreshing a deep link such as `/business/<id>?shipment=<id>`, `/employee/<id>?job=<id>` or `/simulator?package=<id>` returns the app shell, while unknown `/api/*` paths return JSON `404 { "error": ... }`. If `client/dist` is missing, only the API is served.

## Tests
```bash
npm test               # vitest only
bash scripts/test.sh   # typecheck + tests + build (must pass before any PR)
```
The tests need no key and no network: they run on the committed cache or on a fake travel provider.

## State file and reset
The run is saved in `data/state-v2.json` (gitignored, written by the server). A restart restores it, paused. **To reset, stop the server, delete `data/state-v2.json` and start it again**: the server then builds the default run from `fixtures/nyc/`.

A changed story or default limit starts a fresh run at the next restart: if `businesses.json`, `neighborhoods.json` or `demoStory.json` in `fixtures/nyc/`, or the default detour limit, changed since the run was saved, the server builds the default run from the current files, prints one line saying so, and keeps the old run as `data/state-v2.json.stale-<n>` (never deleted; remove it by hand when you no longer need it). It knows by a fingerprint of those inputs in `data/state-v2.source.json`; the travel cache is not part of it, so a saved commute does not reset the run.

In the Simulator, **Play** with no package picked runs the whole network and locks the run: after it, new deliveries and commute changes are refused. The app has no control that starts a new planning cycle (removed in MVP III), so reset as above to unlock it. Playing one package's journey does not lock the run.

## Demo accounts
On the Business and Employee pages the header's **Demo account** selector lists the businesses and employees of the run. The chosen account is the only thing stored in the browser; all delivery data lives on the server.

## 2-minute demo
Known-good request for the default run, on a fresh clone with no key. `tests/api/v2-readme-demo.test.ts` reads the block below and runs it over HTTP: it matches as a relay, and the package stays at the relay point overnight.

```demo-request
employee: Elena Rossi
employee_url: /employee/emp-7
sender: Brooklyn Roasting Company
sender_url: /business/biz-brooklyn-roasting
recipient: Blue Bottle Coffee
recipient_url: /business/biz-blue-bottle-wall
package: Espresso blend samples
type: Envelope
weight_kg: 0.5
contents: Three sample bags of the new espresso blend
ready: Day 1, 4:00 PM
deliver_by: Day 2, 10:00 AM
relay_point: Etsy
evening_carrier: Elena Rossi
morning_carrier: Reese Green
price: $10.00
```

The times are the defaults of the **New delivery** form, so leave them as they are. Use a fresh run: the request is planned on commutes that are still free, so after an earlier try, reset first ([State file and reset](#state-file-and-reset)). If the Simulator's **Play** was pressed earlier with no package picked, the run is locked and the form is closed: reset first.

1. **Employee** (`/employee/emp-7`, or choose **Elena Rossi** as the **Demo account**): show the **Saved commute** between the Upper East Side and Brooklyn Roasting Company, the two departure times and the **Detour limit**.
2. **Business** (`/business/biz-brooklyn-roasting`, Brooklyn Roasting Company): choose **New delivery**, pick **Blue Bottle Coffee** as the recipient, enter the package from the block above and choose **Send request**. This is the "Find a delivery match" step: the backend looks for a matching commute.
3. The form answers **Delivery arranged** with the shipment ID. **View delivery** opens the details: plan **Relay via Etsy (relay point)**, the ETA, price **$10.00**, and the carriers Elena Rossi (evening commute, Day 1) and Reese Green (morning commute, Day 2).
4. Back in **Employee** as Elena Rossi, without refreshing: the new job is under **Assigned deliveries**, with its pickup, drop-off, extra time and reward.
5. **Simulator**: on the new delivery choose **Watch in simulator** (or **View journey** in the Business delivery details; both open `/simulator?package=<shipment ID>`), then **Play**. The package is picked up at Brooklyn Roasting Company, dropped at the relay point Etsy, waits there overnight (an "Overnight at Etsy" card stands in for the wait), and is delivered to Blue Bottle Coffee in the morning. **Pause** stops it where it is, **Play** goes on from there, and **Back to start** rewinds.
6. The same run is in every workspace: the delivery reads **Delivered** for the sender (`/business/biz-brooklyn-roasting`) and for the recipient (`/business/biz-blue-bottle-wall`), and **Earnings** on the pages of Elena Rossi and Reese Green show the reward as **Earned**.

Message: Relay turns existing commutes into a coordinated delivery network. This prototype calculates the matches on real NYC travel times and simulates the complete delivery cycle.

## Assumptions and out of scope
- The businesses are real NYC locations; their coordinates come from the Geocoding API. The employees and deliveries are simulated.
- Employee homes are made-up points inside real residential neighborhoods, shown by neighborhood only. Never a real person's address.
- Travel times and distances are Google's, for driving without traffic (travel mode DRIVE, routing preference TRAFFIC_UNAWARE), read from the committed cache, so the same inputs give the same numbers. Seconds are rounded up to whole minutes. No time or distance is ever estimated: when one is missing and there is no server key, the API answers 503 and the page says so.
- Pickups, drop-offs and overnight storage happen only at network businesses, never at homes. Every network business can be a relay point.
- Time is integer minutes since Day 1 00:00, distance in meters, money in integer cents. Matching and simulation are deterministic for the same inputs.
- The frontend only renders API responses; it never computes matches, statuses, earnings or metrics.
- External services: the Google Routes API and Geocoding API (server) and the Maps JavaScript API (browser), and no others.
- Out of scope: cancellations, disruptions, recovery, offers/declines, auth, real payments, GPS, QR scanning, live traffic, emissions, LLM/runtime AI, WebSockets, databases.

## Repository layout
- `client/` React + Vite frontend: `src/pages`, `src/components` (`business/`, `employee/`, `sim/`, `map/` for the Google map and its deck.gl layers), `src/ui`, `src/api`
- `server/` Express API (`api/v2/`), pure domain logic (`domain/v2/`), the Google and cache layer (`geo/`)
- `shared/` types and Zod schemas shared by client and server (`shared/v2/`)
- `fixtures/nyc/` the NYC data: `businesses.json`, `neighborhoods.json` and `demoStory.json` (written by hand), `matrix.json` and `polylines.json` (the travel cache from Google)
- `scripts/fetch-routes.ts` the fetch command behind `npm run fetch:routes`
- `tests/` Vitest suites (`api/`, `domain/`, `geo/`, `ui/`)
- `docs/` the product spec (`relay-spec.md`) and the UI design (`mvp2-ui-redesign.md`); `SPEC.md`, `DECISIONS.md` and `AGENTS.md` hold the project rules

## Google setup: keys and travel data
You need this section for three things: the map (browser key), a commute with a new address (server key), and fetching the travel data again after the businesses or the story changed (server key). The travel data of the default run is already committed, so a fresh clone needs none of it.

A person fetches the travel data with `npm run fetch:routes`; the result is saved in `fixtures/nyc/` and committed. After that the app and the tests read the saved files. The five steps below go from "no key" to "map and fresh travel data in the app".

> [!WARNING]
> - **Never commit, paste or print a key.** Not in code, an issue, a PR, a chat, a screenshot or a terminal you share. Do not `cat .env`.
> - **`.env` is gitignored. Keep the keys there and nowhere else.** `git status` must never list `.env`.
> - **The fetch is billed to the Google Cloud project that owns the server key.** Run the free dry run first (step 4) and read what it will request.
> - If a key does leak, delete it on the Credentials page of the Google Cloud console and create a new one.

### 1. Enable three APIs
You need a Google account and a Google Cloud project with a billing account linked. Google Maps Platform refuses calls from a project without billing.

1. Open https://console.cloud.google.com/ and create a project (the project picker at the top, then **New project**), or select an existing one.
2. Open **Billing** in the menu and link a billing account to the project.
3. Open **APIs & Services**, then **Library**. Search for each API below, open it and press **Enable**.

| API | Called from | Used for |
| --- | --- | --- |
| Routes API | server | travel times and distances (`computeRouteMatrix`), route lines (`computeRoutes`) |
| Geocoding API | server | coordinates of the business addresses |
| Maps JavaScript API | browser | the map on the Simulator, Employee and Business pages |

Enable these three and no others; Relay calls nothing else. The menu names are the console's at the time of writing and Google moves them now and then. The three API names are what you search for.

### 2. Create two keys
Open **APIs & Services**, then **Credentials**, then **Create credentials**, then **API key**. Do it twice and name the keys so you can tell them apart (for example `relay-server` and `relay-browser`). Open each key and set both kinds of restriction:

| Key | API restrictions (**Restrict key**) | Application restrictions, for local use |
| --- | --- | --- |
| Server key | Routes API and Geocoding API | **None**. Not **Websites**: a server call sends no HTTP referrer, so Google refuses a key with a referrer restriction. |
| Browser key | Maps JavaScript API | **Websites**, with the referrer `http://localhost:5173/*` |

Why two: the browser key is part of the page, so anyone who opens the app can read it. It is therefore limited to drawing maps on your own machine. The server key can spend money on routes, so it never reaches the browser.

- If you run the production build (`npm start`, port 3001), add `http://localhost:3001/*` as a second referrer on the browser key.
- A changed restriction can take a few minutes to apply.

### 3. Put the keys in `.env`
Create a file named `.env` at the repo root, next to `package.json`, with these two lines:

```
GOOGLE_MAPS_SERVER_KEY=<your server key>
VITE_GOOGLE_MAPS_BROWSER_KEY=<your browser key>
```

Replace each placeholder, angle brackets included, with the key from the console.

- `GOOGLE_MAPS_SERVER_KEY` is read by `npm run fetch:routes`, from the environment or from `.env`. A variable that is already set in the environment wins.
- `VITE_GOOGLE_MAPS_BROWSER_KEY` is read by Vite when `npm run dev` starts and when `npm run build` runs, so restart or rebuild after changing it. Without it the map area says "Google Maps key missing." and the rest of the page still works.
- Check that git ignores the file: `git check-ignore .env` prints `.env`.

### 4. Fetch the travel data
```bash
npm run fetch:routes -- --dry-run   # free: calls nothing, writes nothing, needs no key
npm run fetch:routes                # paid: calls Google with the server key
```

**The dry run comes first.** It prints a "Fetch estimate": the businesses to geocode, the matrix pairs to fetch and in how many requests, the route lines to fetch, and a `Google requests:` line with the total. Take the numbers from that output. They are computed from the files in `fixtures/nyc/` and from what is already cached, so they are not repeated here. On a first run the route lines of the matched plans are shown as "at most", because the matcher can only run once the travel times are there. The dry run also says whether `GOOGLE_MAPS_SERVER_KEY` was found; it never prints the key.

**What the real run does**, in this order (`server/geo/fetchScript.ts`, `server/geo/fetchRoutes.ts`):

1. Before any Google call it reads `.env`, the three hand-written files (`businesses.json`, `neighborhoods.json`, `demoStory.json`) and the cache so far. A missing or malformed file, or a missing key, stops the run here with "No Google call was made."
2. **Step 1/4, geocode:** asks the Geocoding API for the coordinates of every business that has none yet.
3. **Step 2/4, matrix:** asks the Routes API for the time and distance of every missing pair: business to business, home to business and business to home. The homes are the seeded home pool plus the homes of the story's employees.
4. **Step 3/4, default scenario and matcher:** builds the default scenario and runs the matcher on the fetched times. No Google call.
5. **Step 4/4, route lines:** asks the Routes API for the route line of every employee's two baseline commutes and of every stretch the matched plans drive.
6. It prints three reports: the fetch summary (requests made, failures), the plan check (every plan's times derived again from the cache, and whether each story package matched as `demoStory.json` expects) and the travel cache report (what the two files cover, and which of Google's numbers look wrong).

Good to know:

- Every request uses travel mode DRIVE and routing preference TRAFFIC_UNAWARE, so the same inputs give the same numbers.
- **The cache is saved after every step**, before the next one starts. **A second run resumes**: whatever is already in the two cache files is skipped and not paid for again. On a complete cache the dry run says "Nothing to fetch".
- A request that fails for a passing reason (no answer, too many requests, a Google server error) is retried. A step gives up after three failed requests in a row, so a wrong key or a missing API costs a handful of calls and not the whole run.
- No time or distance is ever estimated. A step that lacks data is skipped and reported.

**Exit codes** (in the same terminal, `echo $?` right after the command):

| Code | Meaning | What to do |
| --- | --- | --- |
| `0` | Complete, and no error flagged: no failed request, no skipped step, a clean plan check, every story package matched as written, no gap and no error in the cache report. Warnings do not count. A dry run and `--help` also exit 0. | Read the two reports, warnings too, then go to step 5. |
| `1` | Not complete, or an error flagged. This includes a run that could not start. Everything fetched so far is saved. | Read the last line. "Run again to resume." means fix what the lines above name (key, API, network) and run the same command again. "Check the flagged rows above." means the data is all there but a plan or a number needs a human look before anything is committed. A run that could not start names the file or the setting to fix. |
| `2` | Wrong usage: an unknown flag or a misused one. Nothing was read, called or written. | Read the usage text it printed. |

### 5. Commit the cache and restart the server
After an exit code 0:

```bash
git add fixtures/nyc/matrix.json fixtures/nyc/polylines.json
git commit -m "NYC travel cache from Google"
```

The two files hold coordinates, seconds, meters and encoded route lines, and no key. Then **restart the server** (stop `npm run dev` with Ctrl-C and start it again): the cache is read when the server starts.

### What you see
- **The map**, once the browser key is in `.env` and `npm run dev` was restarted:
  - `/simulator`: the network businesses, the route lines of the commutes and plans, and the vehicles and packages moving along them. Selecting a package shows its journey only.
  - `/employee/<id>`, for example `/employee/emp-7`: the employee's commute and the stops of their deliveries.
  - `/business/<id>`, for example `/business/biz-brooklyn-roasting`: a delivery's route next to its details, with the sender, the relay point and the recipient.
  - `/` and `/help` have no map and look the same with and without a key.
- **Without the browser key** each map area says "Google Maps key missing." and the lists, forms and panels around it work as before. If the key is there but wrong, the map area says "Google rejected the browser key."; check its restrictions (step 2) and reload the page.
- **With the server key**, **Edit commute** on the Employee page finds a new address and saves it. Without it the search says "Address search needs the Google key on the server. Your saved home is unchanged.", and a save that keeps the home still works.
- **If the cache is missing** from your checkout (`fixtures/nyc/matrix.json`), every `/api/v2` request answers `503` with the code `travel_data_missing`, and the pages show "NYC travel data is not loaded on this server yet." The server prints the reason when it starts.
- **Old links.** The preview paths `/nyc/...` redirect to the main paths above.
- **State.** The run is in `data/state-v2.json`; see [State file and reset](#state-file-and-reset).
