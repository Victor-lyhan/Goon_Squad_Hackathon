# Relay

Relay turns existing employee commutes into a coordinated B2B delivery network. A business describes a package, the backend matches it to an employee who already drives past the pickup and the drop-off, either directly or through a **relay point** (another business of the network that holds the package overnight), and a simulator plays the whole delivery cycle on a map of New York City.

**Real NYC locations, simulated deliveries.** The businesses are real, well-known NYC businesses. The driving times, distances and route lines between them come from Google; they were fetched once and are committed in `fixtures/nyc/`. The employees, their homes (made-up points, shown by neighborhood only) and the deliveries are simulated by the backend. The default run has 18 businesses, 60 employees and 24 packages.

## What works with and without a key
You need no key to run the app or the demo. Two optional Google keys add the map and live Google calls ([Google setup](#google-setup-keys-and-travel-data)). A third optional key lets Gemini read a delivery request written as a sentence ([Requests in plain English (Gemini)](#requests-in-plain-english-gemini)).

| You have | What works |
| --- | --- |
| **No key** (a fresh clone) | Everything in the 2-minute demo, from the committed cache: the homepage and its **Watch a package** button, the Business, Employee and Simulator workspaces, matching a new delivery, journey playback, earnings, and a commute save that keeps the home. The server calls nothing outside your machine. Where a map would be, the page says "Google Maps key missing." and the rest of the page works. |
| **Browser key** (`VITE_GOOGLE_MAPS_BROWSER_KEY`) | Adds the Google map: the network on the Simulator with route lines, moving vehicles and packages, the commute on the Employee page and a delivery's route on the Business page. |
| **Server key** (`GOOGLE_MAPS_SERVER_KEY`) | Adds the live Google calls: the address search and a commute save with a new address (its travel times are fetched and added to the cache), the route lines of a new delivery (without the key its legs have no route line and the vehicle moves straight from stop to stop), and the fetch command `npm run fetch:routes`. |
| **Gemini key** (`GEMINI_API_KEY`) | Gemini writes the draft of a delivery request from one sentence. Without the key the server's offline parser writes it, and nothing is sent to Gemini. |

## Requirements
- Node.js 22.12 or newer to run the app (`npm run dev`, `npm run build`, `npm start`). Node 22.0 to 22.11 is too old for Vite (its `engines` in `package-lock.json`).
- Node.js 22.22.2 or newer to run the tests (`npm test`, `bash scripts/test.sh`): vitest and jsdom ask for more than Vite (their `engines` in `package-lock.json`). On Node 24 that is 24.15 or newer; vitest does not list Node 23 or 25.
- npm

No API key or environment variable is needed. `PORT` is optional and applies to `npm start` only (default `3001`); leave it unset for `npm run dev` ([Setup and run](#setup-and-run)). `RELAY_STATE_PATH` is optional too and gives a second server its own state file ([State file and reset](#state-file-and-reset)). The two Google keys are optional and live in `.env` ([Google setup](#google-setup-keys-and-travel-data)), and so does the Gemini key ([Requests in plain English (Gemini)](#requests-in-plain-english-gemini)).

## Setup and run
```bash
npm install
npm run dev
```
`npm run dev` starts the API on **http://localhost:3001** and Vite on **http://localhost:5173**; Vite proxies `/api` to the API. Open http://localhost:5173 and choose **Watch a package** ([30-second demo](#30-second-demo)).

`npm run dev` needs ports 3001 and 5173 free. Do not set `PORT` for it, in the shell or in `.env`: Vite sends `/api` to port 3001 whatever `PORT` says, so with another port every API call of the page fails. If the server says a port is already in use, stop the other server.

The main paths:

| Path | Page |
| --- | --- |
| `/` | Homepage: a dark hero with the title, the **Watch a package** button (it opens the simulator on an example package and plays it), the Business and Employee entries and a drawn map of New York on which a package is relayed in a loop (an illustration, not a run; no map key needed), then **How it works** in three lines with the **See the numbers** button to `/study.html`. |
| `/business/<id>` | Business workspace, for example `/business/biz-brooklyn-roasting`: the **Shipments** table, **New delivery**, delivery details. |
| `/employee/<id>` | Employee workspace, for example `/employee/emp-7`: the saved commute, assigned deliveries, earnings. |
| `/simulator` | Simulator: the whole network, the package list, playback, and the journey of one package. |
| `/study.html` | The numbers: Relay against a standard next-day courier, on one page of its own ([The numbers](#the-numbers-relay-vs-traditional-delivery)). |

You never have to type an ID: the header's **Business** and **Employee** links open the chosen demo account (the first business and the first employee of the run until you choose one), and the **Demo account** selector switches to any other ([Demo accounts](#demo-accounts)). `/business` and `/employee` with no ID go to that same account.

## Production build
```bash
npm run build   # builds the client into client/dist (the server is not compiled)
npm start       # runs the server with tsx and serves client/dist
```
Open **http://localhost:3001**. To use another port, set `PORT`, for example `PORT=3002 npm start`, and open that port. One process serves the API under `/api` and the built client; there is no Vite proxy. Refreshing a deep link such as `/business/<id>?shipment=<id>`, `/employee/<id>?job=<id>` or `/simulator?package=<id>` returns the app shell, while unknown `/api/*` paths return JSON `404 { "error": ... }`. If `client/dist` is missing, only the API is served.

When it starts, `npm start` prints one line about the built client ("Serving the built client from client/dist", or "client/dist not found: run npm run build, or use npm run dev") and one about the Google server key ("Google server key: set", or "Google server key: not set (address search and a commute save with a new address answer 503)"); the key itself is never printed. Before these two it says that `/api/v2` is ready with the NYC travel cache loaded, and the last line is "Relay API listening on http://localhost:3001", with the port it really listens on. If a saved run was set aside, one more line says so ([State file and reset](#state-file-and-reset)).

`npm run dev` prints the same lines with `[api]` in front. On a fresh clone "client/dist not found" is expected there, because Vite serves the page; after an `npm run build` it reads "Serving the built client from client/dist". Either way, open port 5173 while `npm run dev` runs: port 3001 has only the API, or the page as it was at the last build.

**The browser key is read at build time.** `npm run build` writes `VITE_GOOGLE_MAPS_BROWSER_KEY` into the files of `client/dist`; `npm start` only serves those files and never reads that key. So for the map in production mode, run `npm run build` in the checkout that has `.env`, and run it again after the key changes; restarting `npm start` is not enough. A build made without the key shows "Google Maps key missing." on every map area; the fix is another `npm run build`, not a restart ([Google setup](#google-setup-keys-and-travel-data), step 3).

## Tests
```bash
npm test               # vitest only
bash scripts/test.sh   # typecheck + tests + build (must pass before any PR)
```
The tests need no key and no network: they run on the committed cache or on a fake travel provider.

## State file and reset
The run is saved in `data/state-v2.json` (gitignored, written by the server). A restart restores it, paused. **To reset, stop the server, delete `data/state-v2.json` and start it again**: the server then builds the default run from `fixtures/nyc/`.

The file is written at the first change of the run (a new delivery, a played journey, a saved commute) and when `npm start` is stopped with Ctrl-C. On a fresh clone where nothing was changed yet there may be no such file: then there is nothing to delete and the run is the default one. Leave `data/state-v2.source.json` where it is.

A changed story or default limit starts a fresh run at the next restart: if `businesses.json`, `neighborhoods.json` or `demoStory.json` in `fixtures/nyc/`, or the default detour limit, changed since the run was saved, the server builds the default run from the current files, prints one line saying so, and keeps the old run as `data/state-v2.json.stale-<n>` (never deleted; remove it by hand when you no longer need it). It knows by a fingerprint of those inputs in `data/state-v2.source.json`; the travel cache is not part of it, so a saved commute does not reset the run.

So expect this on the first start after a `git pull` that changed the story, also on the demo machine. The line comes before the one about the built client:

```
The NYC story files or the default detour limit changed since data/state-v2.json was saved. Started from the new default run; the old run is kept as data/state-v2.json.stale-1.
```

It is not an error. The deliveries made before the pull are in the `.stale-<n>` file and no longer in the app; the number goes up with every run that is set aside.

A second server (a QA run next to the demo one) keeps its own run when `RELAY_STATE_PATH` names another file, for example `RELAY_STATE_PATH=/tmp/relay-qa/state-v2.json PORT=3002 npm start`. It reads and writes that file, with its `.source.json` next to it, and leaves `data/state-v2.json` alone. Its first start line then reads "State file: /tmp/relay-qa/state-v2.json (RELAY_STATE_PATH)".

In the Simulator, **Play** with no package picked plays every carrier's commute, the evening ones and then the morning ones, and does not lock the run. On the default run it takes about 40 seconds: the clock jumps to the first departure, an "Overnight: skipping to the morning commute" card stands in for the night, and it ends at Day 2, 12:00 PM with every delivery **Delivered**. The line under the buttons then reads "Run finished. Use Back to start to watch again."; **Back to start** returns the clock to Day 1, 3:30 PM, paused. New deliveries and commute changes stay open while it plays and after it, and a new delivery puts the clock back at the start by itself. Playing one package's journey does not lock the run either.

No button of the pages locks the run. Only the `play` control of the API does (`POST /api/v2/simulator/control` with the body `{"action":"play"}`): while the run is locked, new deliveries and commute changes are refused. The Business page then says "Locked", its **New delivery** button is disabled, and a line above the table reads "The simulation has started, so new requests are closed. Press Back to start in the simulator to reopen them." On the Employee page **Edit commute** is disabled, and a line above the saved commute reads "The run is playing, so commute edits are closed until you press Back to start in the simulator." **Back to start** in the Simulator unlocks it, as both lines say: the clock returns to Day 1, 3:30 PM, paused, and every delivery keeps its plan. No reset is needed. **Pause** does not unlock it, and neither does a restart.

## Demo accounts
On the Business and Employee pages the header's **Demo account** selector lists the businesses and employees of the run; the homepage and the Simulator do not show it. An employee is listed with the employer, for example "Elena Rossi · Brooklyn Roasting Company". Opening `/business/<id>` or `/employee/<id>` by its URL chooses that account too. The header's **Business** and **Employee** links open the chosen account, and the first business and the first employee of the run in a browser that has not chosen yet. The chosen account is the only thing stored in the browser; all delivery data lives on the server.

## 30-second demo
Open `/` and choose **Watch a package**. The simulator opens on the package "Navy Yard grinder burrs" and plays its journey by itself, in about 16 seconds. Nothing else to press:

- ■ Sender: a square marks Blue Bottle Coffee. Carrier **A** (blue) leaves work and picks the package up there on the evening commute home. It is evening, so the map is dark and the badge at the top shows a moon and the time.
- ◆ Overnight: a diamond marks the relay point, Etsy, where carrier A leaves the package and drives on home. An "Overnight at Etsy" card stands in for the night for about a second.
- ⇄ Handoff: in the morning the swap symbol at the relay point names carrier **B** (green), who leaves home and collects the package on the commute to work. The map is light and the badge shows a sun.
- ⚑ Delivered: a flag marks the delivery at Brooklyn Roasting Company, with the time.

Each carrier is a large marker with its letter and drives the whole commute: a thin line in the carrier's color, thick on the part with the package on board. The package is an orange badge that rides on its carrier's marker, and an orange marker at the business where it waits. The panel on the right lists the same four steps with the same symbols, and both carriers with their extra minutes and reward.

- **Without the browser key** the map area says "Google Maps key missing." The playback, the moon and sun badge, the Overnight card and the panel on the right work the same, so the journey can still be followed there. The map itself needs the key ([Google setup](#google-setup-keys-and-travel-data)); with `npm start` the key must be there when `npm run build` runs ([Production build](#production-build)).
- **Pause** stops the journey where it is, **Play** goes on from there, and **Back to start** rewinds to Day 1, 3:30 PM and waits for **Play**. When the journey has ended, the line under the buttons reads "Journey complete: Delivered to recipient at Brooklyn Roasting Company." and **Play** plays it again from the start.
- Playing one package's journey does not lock the run, so the 2-minute demo below can follow at once, without a reset.
- **Play** with no package picked ("← Back to network" in a journey, or **Simulator** in the header) plays every carrier's commute in about 40 seconds, and does not lock the run either ([State file and reset](#state-file-and-reset)).

## 2-minute demo
Known-good request for the default run, on a fresh clone with no key. In the demo it is typed as one sentence into the Business text box (step 2):

```text
Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.
```

The block below is the delivery this sentence makes and the match the backend answers with. `tests/api/v2-readme-demo.test.ts` reads the block and runs it over HTTP: it matches as a relay, and the package stays at the relay point overnight. `tests/api/v2-f1-demo-sentence.test.ts` sends the sentence itself, with no key, and gets the same match.

```demo-request
employee: Elena Rossi
employee_url: /employee/emp-7
sender: Brooklyn Roasting Company
sender_url: /business/biz-brooklyn-roasting
recipient: Blue Bottle Coffee
recipient_url: /business/biz-blue-bottle-wall
package: Envelope
type: Envelope
weight_kg: 0.5
contents: Espresso blend samples
ready: Day 1, 4:00 PM
deliver_by: Day 2, 10:00 AM
relay_point: Etsy
evening_carrier: Elena Rossi
morning_carrier: Reese Green
price: $10.00
```

The package name is "Envelope" because the offline parser names a delivery by its item word; "Espresso blend samples" becomes the contents. The sender is not in the sentence: a request is always sent from the business whose page it is typed on. The card shows the times as its fields hold them: "Ready for pickup (Day 1)" 16:00, "Deliver by: day" Day 2 and "Deliver by: time" 10:00 (the browser may write the two times as 04:00 PM and 10:00 AM).

With a Gemini key in `.env`, check the key once before the demo: `npx tsx scripts/gemini-check.ts "<sentence>"` prints `source: gemini` and exits with code 0 when Gemini wrote the draft, or `source: offline` with the reason (`reason: no key`, for example) and code 1 when the offline parser did ([Requests in plain English (Gemini)](#requests-in-plain-english-gemini)). Gemini may give the package another name than "Envelope"; the pages of the later steps then show that name.

Rehearsing and the demo share one run. Use a fresh run for the real demo: the request is planned on commutes that are still free, and a rehearsal that chose **Find a delivery match** uses them up, so reset the run after it ([State file and reset](#state-file-and-reset)). One run arranges the request as the block says once: sent a second time it comes with other carriers than the block names, and a third time it is not matched ("Every matching commute is already carrying a package"). A rehearsal of only **Play**, **Back to start** and a package's journey adds no delivery and needs no reset.

Press **Back to start** in the Simulator before step 2 if a journey or **Play** was watched earlier, the 30-second demo included: it leaves the clock on Day 2, and the offline parser then reads "ready at 4 p.m." as 4 p.m. of Day 2, which is outside the run. The card still holds 16:00 and the match is the same, but "Ready for pickup (Day 1)" is marked "Check this: not in your request". An earlier **Play** does not close **New delivery**. Should the Business page say "Locked" all the same, **Back to start** reopens it ([State file and reset](#state-file-and-reset)).

1. **Employee** (`/employee/emp-7`, or choose **Elena Rossi** as the **Demo account**, where she is listed as "Elena Rossi · Brooklyn Roasting Company"): show the **Saved commute** between the Upper East Side and Brooklyn Roasting Company, the two departure times and the **Detour limit**.
2. **Business** (`/business/biz-brooklyn-roasting`, Brooklyn Roasting Company): choose **New delivery**, which opens on the text box "Describe the delivery". Type the sentence above and choose **Read my request**. The form opens filled in, as the card to check: the label above it reads "Parsed offline" without a Gemini key and "Parsed by Gemini" with one (the page prints it in capitals), with the sentence next to it, and the fields hold the recipient "Blue Bottle Coffee · Financial District", the package name "Envelope", the type Envelope, 0.5 kg and the contents "Espresso blend samples". Nothing is sent yet. Then choose **Find a delivery match**: the backend looks for a matching commute. If the sentence is not read as above, **Fill in the form instead** in the text box opens the same form empty: pick the recipient and enter the package name and the contents of the block (the type, the weight and the times are the form's defaults).
3. The form answers **Delivery arranged** with the shipment ID, under the form's fields. **View delivery** opens the details on the right: plan **Relay via Etsy (relay point)**, the ETA, price **$10.00**, and the carriers Elena Rossi (evening commute, Day 1) and Reese Green (morning commute, Day 2).
4. Back in **Employee** as Elena Rossi, without refreshing (the header's link opens her page, because step 1 chose her): the new job, "Envelope", is under **Assigned deliveries**, with its pickup, drop-off, extra time and reward. Her leg of "Navy Yard grinder burrs" is listed there too.
5. **Simulator**: on the new delivery, "Envelope", choose **Watch in simulator** (or **View journey** in the Business delivery details). Both open `/simulator?package=<shipment ID>&play=1`, and the journey starts playing by itself; it takes about 16 seconds. Elena Rossi leaves work, which is the sender: the package is picked up at Brooklyn Roasting Company, dropped at the relay point Etsy, waits there overnight (an "Overnight at Etsy" card stands in for the wait), and is delivered to Blue Bottle Coffee in the morning, on Reese Green's commute to work. **Pause** stops it where it is, **Play** goes on from there, and **Back to start** rewinds. Let it play to the end before step 6.
6. The same run is in every workspace: once the journey has played to the end, the delivery reads **Delivered** for the sender (`/business/biz-brooklyn-roasting`) and for the recipient (`/business/biz-blue-bottle-wall`), and **Earnings** on the pages of Elena Rossi and Reese Green (choose each as the **Demo account**) show the reward as **Earned**. Elena Rossi's amount also counts her leg of "Navy Yard grinder burrs", which is delivered by the same minute.

To end on the figures, open `/` and choose **See the numbers**, under **How it works**: it opens `/study.html`, Relay against a standard next-day courier ([The numbers](#the-numbers-relay-vs-traditional-delivery)).

Message: Relay turns existing commutes into a coordinated delivery network. This prototype calculates the matches on real NYC travel times and simulates the complete delivery cycle.

## Assumptions and out of scope
- The businesses are real NYC locations; their coordinates come from the Geocoding API. The employees and deliveries are simulated.
- Employee homes are made-up points inside real residential neighborhoods, shown by neighborhood only. Never a real person's address.
- Travel times and distances are Google's, for driving without traffic (travel mode DRIVE, routing preference TRAFFIC_UNAWARE), read from the committed cache, so the same inputs give the same numbers. Seconds are rounded up to whole minutes. No time or distance is ever estimated: when one is missing and there is no server key, the API answers 503 and the page says so.
- Pickups, drop-offs and overnight storage happen only at network businesses, never at homes. Every network business can be a relay point.
- Time is integer minutes since Day 1 00:00, distance in meters, money in integer cents. Matching and simulation are deterministic for the same inputs.
- The frontend only renders API responses; it never computes matches, statuses, earnings or metrics.
- External services: the Google Routes API and Geocoding API (server), the Maps JavaScript API (browser) and, only when `GEMINI_API_KEY` is set, the Gemini API (server, [Requests in plain English (Gemini)](#requests-in-plain-english-gemini)), and no others.
- Out of scope: cancellations, disruptions, recovery, offers/declines, auth, real payments, GPS, QR scanning, live traffic, emissions in the app (only the study page estimates CO₂), LLM/runtime AI beyond the draft of a request (an LLM never sends a request and never matches one), WebSockets, databases.

## Requests in plain English (Gemini)
The server reads a delivery request written as one sentence, for example "Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.", and answers with a **draft** of the request: sender, recipient, item, weight and times. The route is `POST /api/v2/parse-request` with the body `{ "text": "<the sentence>" }`. It stores nothing and sends no delivery: a person checks the draft and sends it as a normal request, so the matching is the same as for the form.

**No key is needed.** Without one, an offline parser inside the server writes the draft and nothing leaves your machine. With a Gemini key the server asks Gemini first, and the offline parser stays as the fallback.

### Turn Gemini on
Add one line to `.env` at the repo root, the file that also holds the Google keys ([Google setup](#google-setup-keys-and-travel-data), step 3):

```
GEMINI_API_KEY=<your Gemini key>
```

- **`GEMINI_API_KEY`** is a Gemini API key from Google AI Studio. **A key that starts with `AQ` is fine**: new AI Studio keys do not start with `AIza` like the Maps keys, and the server does not check how a key starts.
- **`GEMINI_MODEL`** is optional. Leave it out for the default, `gemini-2.5-flash`. For another model add the line `GEMINI_MODEL=<model name>`.
- **Server only, never a `VITE_` variable.** Vite writes every `VITE_` variable into the page, where anyone can read it. These two names are read by the server alone, from the environment or from `.env` (a variable already set in the environment wins), so the key never reaches the browser. The server sends it to Google in the `x-goog-api-key` header, never in a URL.
- **Restart the server after editing `.env`** (`npm run dev` or `npm start`): the file is read once, when the server starts. No `npm run build` is needed. The server prints no start line about this key; the next section says how to tell that Gemini answers.
- The warning box of [Google setup](#google-setup-keys-and-travel-data) holds for this key too: never commit, paste or print it.
- With the key set, each sentence goes to Google's Gemini API, together with the names of the network businesses and the simulated time. Without the key nothing is sent.

### Who wrote the draft
The answer says who wrote the draft in its `source` field, and the card of the draft shows it as a label:

| Case | The draft is written by | `source` | Label on the card |
| --- | --- | --- | --- |
| No `GEMINI_API_KEY` | The offline parser. Gemini is not called. | `offline` | "Parsed offline" |
| Key set, and Gemini answers within 6 s | Gemini. The server checks every field and empties what it cannot trust, such as a business that is not in the network. | `gemini` | "Parsed by Gemini" |
| Key set, but Gemini answers with an error, does not answer within 6 s, or answers with something that is no draft | The offline parser | `offline` | "Parsed offline" |

So Gemini can never make the request fail: the sender always gets a draft, and waits about 6 s for it at the most.

A fallback with a key set prints one line in the server's terminal (with `npm run dev` it has `[api]` in front):

```
[parse-request] Gemini is unavailable: HTTP 403. Parsed offline.
```

The words after "Gemini is unavailable:" name the cause:

| The line says | What happened | What to do |
| --- | --- | --- |
| `HTTP 400` or `HTTP 403` | Google refused the key or the request. | Check `GEMINI_API_KEY` in `.env`, then restart the server. |
| `HTTP 404` | Google does not know the model. | Check `GEMINI_MODEL`, or remove the line to use the default. |
| `HTTP 429` | The key's quota is used up. | Wait, or use another key. The offline parser answers meanwhile. |
| `no answer within 6000 ms` | Gemini was too slow this time. | Nothing: the offline draft was sent in its place. |
| `the request failed before an answer arrived` | The server could not reach Google. | Check the network. |

When Gemini did answer but not with a draft, the line reads "[parse-request] Gemini answered, but not with a usable draft. Parsed offline." The line never holds the key, the sentence or Gemini's answer.

The two other cases print one line each as well, so every sentence has exactly one line in the terminal:

```
[parse-request] Parsed by Gemini (gemini-2.5-flash, 1840 ms).
[parse-request] Parsed offline: no key (GEMINI_API_KEY is not set).
```

The first names the model and how long Gemini took. The second means the server found no key when it started. If it shows although the key is in `.env`, check that the variable is named `GEMINI_API_KEY`, that `.env` is at the repo root, and that the server was restarted after the edit.

To check from a terminal while the server runs (port 3001):

```bash
curl -s -X POST http://localhost:3001/api/v2/parse-request \
  -H 'Content-Type: application/json' \
  -d '{"text":"Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow."}'
```

The answer ends with `"source":"gemini"` when Gemini wrote the draft and with `"source":"offline"` when the offline parser did.

## The numbers: Relay vs traditional delivery
`/study.html` compares Relay with traditional delivery: the same packages sent two ways, on a commute an employee already drives or on a dedicated courier trip. The page is one committed file, `client/public/study.html`, with its charts inside; every run behind it is in `client/public/study/runs.csv`, which the page links to as **Download every run (CSV)**. It needs no key, no network and no study run: open http://localhost:5173/study.html with `npm run dev`, or http://localhost:3001/study.html with `npm start` after `npm run build`.

**The baseline is a standard next-day B2B courier, not a same-hour one**: one dedicated trip from sender to recipient, promised by 10:30 AM on the next business day, and assumed to always keep that promise.

The headline numbers of the committed page, per package that Relay matched:

| Measure | Relay against the courier | In figures |
| --- | --- | --- |
| Cost to the sender | 37.5% less | Relay $10.00 vs courier $16.00 per package |
| Added vehicle miles | 77.0% less | Relay 1.2 mi vs courier 5.0 mi per package |
| CO₂ | 77.0% less | Relay 0.46 kg vs courier 2.01 kg per package |
| Delivered by the courier's promised time | 100.0% | 33.4% a day early, 0.0% late |
| Match rate | 58.2% | 49,254 of 84,672 packages found a commute |

They are averages over 3,024 simulated runs: every combination of 112 seeds, of 30, 60 and 120 commuting employees, of 12, 24 and 48 packages, and of detour limits of 8, 12 and 16 minutes. Each run is a full two-day simulation on the committed travel cache.

What the numbers mean, and what they do not:

- **"Per package" means per package that Relay matched.** A package with no suitable commute would go by courier at the courier's price, so it is left out of the comparison and counted in the match rate. Read the savings together with the match rate: 58.2% of the requested packages got them. The match rate rises as more employees join: 37.4% with 30 employees, 77.8% with 120.
- **"100% on time" holds by construction. It is not a measured reliability.** Every simulated deadline is at or before Day 2, 10:00 AM, which is before the courier's promise (Day 2, 10:30 AM), and Relay only accepts a package it can deliver by its deadline. So a matched package cannot be late. The cost of that rule shows in the match rate, not in lateness: a package Relay cannot deliver in time is not matched.
- **CO₂ follows the miles.** Both sides are counted with the same CO₂ per mile, so the two percentages are equal.
- **The saving varies from run to run.** Relay is ahead on cost in 3,013 of 3,013 runs, and on miles and CO₂ in 3,003 of 3,013 runs. In the other ten only 1 to 4 packages matched, and 11 of the 3,024 runs matched no package, so they have no per-package value. The page has the spread across runs (median and 10th to 90th percentile), the match rate by number of employees and the results by detour limit; every run is in the CSV.
- **Every assumption is listed on the page with its value and the reason for it**: the prices of Relay and of the courier, the courier's promise, how the miles of each side are counted and the CO₂ per mile. No other number is typed in; the rest is travel data from the cache and simulation output. The values are in `scripts/study/assumptions.ts`.

### Run the study again
```bash
npm run study
```

It runs the 3,024 simulations on the committed cache with no key and no network, on worker threads: one per CPU core, less one (`npm run study -- --workers 4` sets the number; the results are the same for every number). That takes a few seconds on a laptop, about 12 seconds on one thread. It prints a progress line every 100 runs, then a summary table (runs, packages, match rate, Relay against the courier per package, match rate by employee count, wall time and workers), and writes three files:

- `data/study/results.json`: every run and every package (gitignored).
- `client/public/study.html`: the page, generated again from the results (committed).
- `client/public/study/runs.csv`: one row per run, the file behind **Download every run (CSV)** (committed).

The same inputs give the same bytes, so on an unchanged checkout `git status` is clean after it. **After a change to the travel cache or the other files of `fixtures/nyc/`, to the engine (`server/domain/v2/`) or to the study itself (`scripts/study/`), run it again and commit `client/public/study.html` and `client/public/study/runs.csv`.** `npm run study -- --check` writes nothing and tells whether the two committed files are still what a fresh run gives. If the headline numbers moved, change them in the table above too. A server started with `npm start` shows the new page after the next `npm run build`.

## Repository layout
- `client/` React + Vite frontend: `src/pages`, `src/components` (`business/`, `employee/`, `sim/`, `map/` for the Google map and its deck.gl layers), `src/ui`, `src/api`
- `server/` Express API (`api/v2/`), pure domain logic (`domain/v2/`), the Google and cache layer (`geo/`)
- `shared/` types and Zod schemas shared by client and server (`shared/v2/`)
- `fixtures/nyc/` the NYC data: `businesses.json`, `neighborhoods.json` and `demoStory.json` (written by hand), `matrix.json` and `polylines.json` (the travel cache from Google)
- `scripts/fetch-routes.ts` the fetch command behind `npm run fetch:routes`
- `tests/` Vitest suites (`api/`, `domain/`, `geo/`, `ui/`)
- `docs/` the product spec (`relay-spec.md`), the UI design (`mvp2-ui-redesign.md`) and the 30-second demo plan that overrides it where they differ (`mvp3.md`); `SPEC.md`, `DECISIONS.md` and `AGENTS.md` hold the project rules

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

- If you run the production build (`npm start`, port 3001), add `http://localhost:3001/*` as a second referrer on the browser key; with another `PORT`, the referrer of that port.
- A changed restriction can take a few minutes to apply.

### 3. Put the keys in `.env`
Create a file named `.env` at the repo root, next to `package.json`, with these two lines:

```
GOOGLE_MAPS_SERVER_KEY=<your server key>
VITE_GOOGLE_MAPS_BROWSER_KEY=<your browser key>
```

Replace each placeholder, angle brackets included, with the key from the console.

- `GOOGLE_MAPS_SERVER_KEY` is read by `npm run fetch:routes` and by the server when it starts (`npm run dev`, `npm start`), from the environment or from `.env`. A variable that is already set in the environment wins. The server then prints "Google server key: set"; restart it after changing the key.
- `VITE_GOOGLE_MAPS_BROWSER_KEY` is read by Vite when `npm run dev` starts and when `npm run build` runs, so restart or rebuild after changing it. `npm start` does not read it: the key it serves is the one `npm run build` found, so build in the checkout that has `.env` ([Production build](#production-build)). Without it the map area says "Google Maps key missing." and the rest of the page still works.
- Check that git ignores the file: `git check-ignore .env` prints `.env`.

### 4. Fetch the travel data
```bash
npm run fetch:routes -- --dry-run     # free: calls nothing, writes nothing, needs no key
npm run fetch:routes -- --check-key   # three small billable calls: is the key set up right?
npm run fetch:routes                  # paid: calls Google with the server key
```

**The dry run comes first.** It prints a "Fetch estimate": the businesses to geocode, the matrix pairs to fetch and in how many requests, the route lines to fetch, and a `Google requests:` line with the total. Take the numbers from that output. They are computed from the files in `fixtures/nyc/` and from what is already cached, so they are not repeated here. On a first run the route lines of the matched plans are shown as "at most", because the matcher can only run once the travel times are there. The dry run also says whether `GOOGLE_MAPS_SERVER_KEY` was found; it never prints the key. Its last line is "Nothing was written. Cache folder: fixtures/nyc".

If the dry run of a fresh clone still lists route lines for matched plans, the story was changed after the last paid fetch. Nothing is broken: every travel time and distance is in the cache and the app, the demo and the tests run as they are. Only the map is affected, and only with the browser key: a plan stretch without a route line shows no line, and its vehicle moves straight from stop to stop, until someone runs the fetch.

**Then check the key**, before the paid run: `npm run fetch:routes -- --check-key` makes three small calls with the server key (one geocode, one route matrix of a single pair, one route line) and prints one row for each of the three calls: "ok", or what is wrong and the Google Cloud setting to change (the API is not enabled, the key is restricted, billing is off). It reads no cache file and writes nothing. Exit code 0 and the last line "All three Google APIs answered." mean the paid run can start; after "Fix the rows above, then run the check again." change the setting (step 1 or 2) and check again.

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
| `1` | Not complete, or an error flagged. This includes a run that could not start. Everything fetched so far is saved. | Read the last line. The table below has the four that name a next step. A run that could not start says so and names the file or the setting to fix. |
| `2` | Wrong usage: an unknown flag or a misused one. Nothing was read, called or written. | Read the usage text it printed. |

The last line of a run that exits 1:

| Last line | What happened | What to do |
| --- | --- | --- |
| "Run again to resume." | A request or a step failed. What was fetched is saved. | Fix what the lines above name (key, API, network) and run the same command again. If the run had `--refetch`, leave it out this time; the line before says so. |
| "Check the flagged rows above." | The data is all there, but a plan or a number is flagged. | A human looks at the flagged rows before anything is committed. |
| "Run `npm run fetch:routes -- --check-key` to see which setting is wrong." | Google refused the first request the run made to one of the APIs (the API is not enabled, the key is restricted, billing is off). The run stopped there; the steps that finished before are saved. | Run that check, change the setting its row names (step 1 or 2), then run the fetch again. |
| `npm run fetch:routes -- --refetch <placeId>`, after "Moved homes:" | A home in the fixtures is no longer where its cached travel times were fetched for. Nothing was dropped or written, and no Google call was made. | Run the printed command, which names every moved home. It drops those places with their pairs and route lines, then fetches only what is missing. |

### 5. Commit the cache and restart the server
After an exit code 0, stop the server (Ctrl-C) and run:

```bash
npm run fetch:routes -- --drop-entered   # free: no key, no Google call
git add fixtures/nyc/matrix.json fixtures/nyc/polylines.json
git commit -m "NYC travel cache from Google"
```

**Why the drop comes first:** a commute saved with a typed address writes that home into the cache under an ID made of its coordinates (`home-c-<lat>_<lng>`), and an address somebody typed must never be committed. `--drop-entered` removes those homes with their pairs and route lines and prints how many it removed, never an ID; with nothing to drop it says so and writes nothing. The server has to be stopped, because a running one still holds these homes in memory and writes them back. A saved run that uses one of them starts fresh afterwards (its state file is set aside, not deleted). A fetch and a dry run say "Entered homes:" with the count when the cache holds one, and `bash scripts/test.sh` fails while `fixtures/nyc/` does.

After the drop the two files hold the coordinates of the businesses and of the made-up homes, seconds, meters and encoded route lines, and no key. Then **start the server again** (`npm run dev`): the cache is read when the server starts.

### What you see
- **The map**, once the browser key is in `.env` and `npm run dev` was restarted (for `npm start`: once `npm run build` was run again):
  - `/simulator`: the network businesses, the route lines of the commutes and plans, and the vehicles and packages moving along them. Selecting a package shows its journey only.
  - `/employee/<id>`, for example `/employee/emp-7`: the employee's commute and the stops of their deliveries.
  - `/business/<id>`, for example `/business/biz-brooklyn-roasting`: a delivery's route next to its details, with the sender, the relay point and the recipient.
  - `/` has no map and looks the same with and without a key.
- **Without the browser key** each map area says "Google Maps key missing." and the lists, forms and panels around it work as before. After adding the key, restart `npm run dev`; with `npm start`, run `npm run build` again instead. If the key is there but wrong, the map area says "Google rejected the browser key."; check its restrictions (step 2) and reload the page.
- **With the server key**, **Edit commute** on the Employee page finds a new address and saves it. That home is written into `fixtures/nyc/matrix.json`: remove it before you commit the cache (step 5). Without it the search says "Address search needs the Google key on the server. Your saved home is unchanged.", and a save that keeps the home still works.
- **If the cache is missing** from your checkout (`fixtures/nyc/matrix.json`), every `/api/v2` request answers `503` with the code `travel_data_missing`, and the pages show "NYC travel data is not loaded on this server yet." The server prints the reason when it starts.
- **Old links.** The preview paths `/nyc/...` redirect to the main paths above.
- **State.** The run is in `data/state-v2.json`; see [State file and reset](#state-file-and-reset).
