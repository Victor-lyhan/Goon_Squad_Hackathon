# Relay

Relay turns existing employee commutes into a coordinated B2B delivery network: businesses describe a package, the backend matches it to an employee's commute (direct or one-hub relay), and a simulator plays the whole delivery cycle. Everything runs locally on a synthetic city, with no external APIs.

## Requirements
- Node.js 22 or newer (`engines` in `package.json`)
- npm

No API keys or environment variables are needed. `PORT` is optional (default `3001`).

## Setup and run
```bash
npm install
npm run dev
```
`npm run dev` starts the API on **http://localhost:3001** and Vite on **http://localhost:5173**; Vite proxies `/api` to the API. Open http://localhost:5173.

## Production build
```bash
npm run build   # builds the client into client/dist (the server is not compiled)
npm start       # runs the server with tsx and serves client/dist
```
Open **http://localhost:3001** (override with `PORT`). One process serves the API under `/api` and the built client; there is no Vite proxy. Refreshing a deep link such as `/business/<id>?shipment=<id>`, `/employee/<id>?job=<id>` or `/simulator?package=<id>` returns the app shell, while unknown `/api/*` paths return JSON `404 { "error": ... }`. Run state is saved to `data/state.json` (see below). If `client/dist` is missing, only the API is served.

## Tests
```bash
npm test               # vitest only
bash scripts/test.sh   # typecheck + tests + build (must pass before any PR)
```

## State file and reset
All run state is saved to `data/state.json` (gitignored, created on first start). **Delete it to reset to the Demo city**, then restart the server.

Inside the app, the Setup drawer on the Simulator page has **Start new planning cycle**, which recomputes matches and resets playback. After you press Play, sending new packages is refused (the planning phase is locked) until you start a new planning cycle.

## Demo accounts
The landing page lets you choose a demo identity (a business and/or an employee). The identity is the only thing stored in the browser; all delivery data lives on the server.

## 2-minute demo
Known-good request for the **Demo city** (locked by `tests/api/demo-script.test.ts`, which reads the block below). It always matches as a relay: the package is dropped at the hub on Day 1 evening and stays there overnight.

```demo-request
employee: Taylor Irwin
employee_url: /employee/emp-19
sender: Atlas Printworks
recipient: Field Notes Supply
package: Quarterly price lists
category: envelope
weight_kg: 0.5
ready: Day 1, 3:30 PM
deadline: Day 2, 12:00 PM
hub: West Gate Hub
price: $10.00
```

The **Delivery arranged** card should show: relay via **West Gate Hub**, price **$10.00**, carriers Taylor Irwin → Noel Patel, held at West Gate Hub overnight.

If **Play** was pressed earlier, open **Setup** and click **Start new planning cycle** first; otherwise the request is refused (409) because the plan is locked.

1. **Employee portal** (landing page, *Employee portal*, choose **Taylor Irwin**, `/employee/emp-19`): show the saved commute, departure times and the *Max added minutes* limit.
2. **Business portal**: switch to **Atlas Printworks**, choose **Field Notes Supply** as the *Destination business*, enter the package and times from the block above.
3. Click **Find a delivery match**. Show the **Delivery arranged** card with package information, ETA and price.
4. Back in the **Employee portal** as Taylor Irwin: the assigned job is already there, with stops and reward.
5. Open the **Simulator** and press **Play** to run the evening leg; the package stays at the hub overnight.
6. Click **Jump to morning** (then **Finish** if needed): sender/recipient tracking and employee earnings update from the same run.
7. If time remains, open **Setup** (the Setup drawer), click **Start new planning cycle**, change the detour limit (*Max added minutes*) in the employee portal and show the tradeoff.

Message: Relay turns existing commutes into a coordinated delivery network. This prototype calculates the matches and simulates the complete delivery cycle.

## Assumptions and out of scope
- Synthetic city; time is integer minutes since Day 1 00:00, distance in meters, money in integer cents.
- Matching and simulation are deterministic for a given seed and inputs.
- The frontend only renders API responses; it never computes matches, statuses, earnings or metrics.
- Out of scope: cancellations, disruptions, recovery, offers/declines, auth, real payments, GPS, QR scanning, traffic randomness, emissions, LLM/runtime AI, external APIs, WebSockets, databases.

## Repository layout
- `client/` React + Vite frontend (`src/pages`, `src/components`, `src/api`)
- `server/` Express API (`api/`), persistence (`store.ts`), pure domain logic (`domain/`)
- `shared/` types and Zod schemas shared by client and server
- `fixtures/` demo scenario and relay fixture
- `tests/` Vitest suites (`api/`, `domain/`)
- `docs/` full product spec (`relay-spec.md`); `SPEC.md`, `DECISIONS.md` and `AGENTS.md` hold project rules

## MVP II: real NYC data
Everything above describes MVP 1, the synthetic city. It needs no key and stays correct until the cutover.

MVP II runs the same product on real NYC businesses, with driving times, distances and route lines from Google. A person fetches them **once** with `npm run fetch:routes`; the result is saved in `fixtures/nyc/` and committed. After that the app and the tests read the saved files. The five steps below go from "no key" to "NYC data in the app".

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
| Maps JavaScript API | browser | the map on the NYC pages |

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
- **Preview pages.** Until the cutover the NYC pages live under `/nyc`, next to the MVP 1 pages:
  - http://localhost:5173/nyc/simulator
  - `http://localhost:5173/nyc/employee/<id>`, for example `/nyc/employee/emp-1`. The header's **Demo account** selector lists the NYC employees.
  - The Business page follows; on the preview the header shows its link as not available yet.
- **Before the cache is committed**, every `/api/v2` request answers `503` with the code `travel_data_missing`, and the NYC pages show "NYC travel data is not loaded on this server yet." The MVP 1 pages and `/api` are not affected. If the message is still there after a commit and a restart, check that `fixtures/nyc/matrix.json` is in your checkout and that the checkout includes the `/api/v2` start-up (issue #464).
- **State and reset.** The NYC run is saved in `data/state-v2.json` (gitignored, separate from `data/state.json`), and a restart restores it, paused. A changed story or default limit starts a fresh NYC run at the next restart: if `businesses.json`, `neighborhoods.json` or `demoStory.json` in `fixtures/nyc/`, or the default detour limit, changed since the run was saved, the server builds the default run from the current files, prints one line saying so, and keeps the old run as `data/state-v2.json.stale-<n>` (never deleted; remove it by hand when you no longer need it). It knows by a fingerprint of those inputs in `data/state-v2.source.json`; the travel cache is not part of it, so a saved commute does not reset the run. To reset by hand, delete `data/state-v2.json` and restart the server.
