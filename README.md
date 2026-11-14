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
