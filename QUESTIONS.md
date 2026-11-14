# QUESTIONS for the humans

Agents add questions here; humans answer inline and move settled items to DECISIONS.md.

- 2026-11-14 (planner) I authorized p2-a (#5) to edit the root `tsconfig.json` and `vitest.config.ts` to enable `.tsx` component tests via `react-dom/server` (no new deps). These are human-owned configs. Overrule if you'd rather do that change yourselves.
- 2026-11-14 (planner) I authorized p2-a (#5) to replace the 2-line stubs in `BusinessPortal.tsx`, `EmployeePortal.tsx` and `Simulator.tsx` with title-only default-export placeholders so the router compiles. The owning workers build the real pages later. OK?
- 2026-11-14 (planner) UI workers (p2-b, victor-2) have no `tests/` path in the AGENTS.md table. I assigned `tests/ui/` prefixes per worker (see DECISIONS.md). Consider adding these to AGENTS.md.
- 2026-11-14 (planner, pass 2) I queued generator.ts (#15: PRNG + 12x12 grid) for p1-b ahead of M5, because the M2 demo city needs the grid and p1-b would otherwise have had only one task. It covers just the PRNG and the graph; full random scenarios stay in M5.
- 2026-11-14 (planner, pass 3) Direct shipments show Scheduled → Picked up → Delivered and skip "Out for delivery", because status maps 1:1 from events (DECISIONS.md). Overrule if you want direct pickups shown as "Out for delivery" instead.
- 2026-11-14 (planner, pass 3) The full `generateScenario` (spec §5, nice-to-have 12) was queued for p1-b now (#29) because the M2 demo city is built from it. The random-city UI controls stay in M5.
- 2026-11-14 (planner, pass 4) The simulator map shows vehicles only for employees carrying a planned leg, and only during that trip (not all 60 commuters). Overrule if you want every commuter visible.
- 2026-11-14 (planner, pass 4) A business's "spend" total counts every matched outgoing package at its price, not only delivered ones. Overrule if spend should accrue on delivery.
- 2026-11-14 (planner, pass 4) A leftover `.planner-tmp/` folder (issue body drafts) may be in the repo; I couldn't delete it without approval. Safe to delete.
- 2026-11-14 (planner, pass 2) `play` locks the phase on the first press (spec §7: "Freeze the run at playback start"). `reset_playback` rewinds but stays locked; only "Start new planning cycle" unlocks. Overrule if reset should unlock.
