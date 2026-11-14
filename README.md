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

Production-style run (serves the built client from the API process):
```bash
npm run build
npm start
```

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
1. **Employee portal** (landing page, *Employee portal*): show the saved commute, departure times and the *Max added minutes* limit.
2. **Business portal**: switch to a business, choose the *Destination business*, describe the package (name, category, weight, description) and set the ready/deadline times.
3. Click **Find a delivery match**. Show the **Delivery arranged** card with package information, ETA and price.
4. Back in the **Employee portal**: the assigned job is already there, with stops and reward.
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
