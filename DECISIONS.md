# DECISIONS

One line per decision: date, decision, why. Humans seeded the first block from the spec review.

- 2026-11-14 Contracts live in `shared/` (types.ts, schemas.ts, api.ts), not `contracts/`, to match the spec's repo layout. Human-owned.
- 2026-11-14 All IDs deterministic per `shared/types.ts` conventions (plan-<shipmentId>, <planId>-L<i>, <employeeId>-eve/-morn). Needed for spec test 7 (same seed ⇒ identical assignments).
- 2026-11-14 Weight is kg in the form/request, grams in stored data (weightGrams = round(kg*1000)).
- 2026-11-14 Business has `district`; Node has optional `label`/`district` for friendly location names. UI never shows raw node IDs.
- 2026-11-14 Shipment has `clientRequestId` for idempotent POST and `createdSeq` for stable ordering.
- 2026-11-14 Shipment progress and job status are never stored; always derived from snapshotAt(run, clock.timeMin).
- 2026-11-14 Pickup at a trip's origin: service starts at max(departureMin, readyMin); waiting counts as added time. Delivery at a trip's destination: handling after arrival counts as added time.
- 2026-11-14 Stable event order at equal time: hub_drop before hub_pickup, then pickup, then delivered; ties broken by planId.
- 2026-11-14 Requests are validated with Zod on the server; responses are TypeScript types only (no runtime response validation) to save time.
- 2026-11-14 Static map data is served by GET /api/map (fetched once per runId) so the 1 s simulator poll stays small.
- 2026-11-14 jump_to_morning seeks to 5 minutes before the first Day 2 event (or 1860 if none).
- 2026-11-14 Dev ports: Vite 5173, API 3001. State file `data/state.json`, gitignored; missing file ⇒ load demo city.
- 2026-11-14 (M0) Styling is plain CSS in `client/src/styles/` (no Tailwind): no extra build config, and the UI kit in `client/src/ui/` keeps it consistent.
- 2026-11-14 (M0) `shared/` is imported by relative path (`../shared/types`, `../../shared/schemas`) from client, server and tests; no path alias, so Vite, Vitest, tsx and tsc all agree without extra config.
- 2026-11-14 (M0) Root `vite.config.ts` has `root: 'client'` and builds to `client/dist`; `vitest.config.ts` is separate and runs `tests/**/*.test.ts` in Node. `npm run build` builds the client only; the server is never compiled, `npm start` runs it with tsx and serves `client/dist` when it exists.
- 2026-11-14 (M0) Typecheck is three `tsc --noEmit` projects: `client/`, `server/`, and the root `tsconfig.json` (shared + tests + config files). New `.ts` files need an import or export (`isolatedModules`).
