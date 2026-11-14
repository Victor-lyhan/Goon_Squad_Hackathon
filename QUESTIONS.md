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
- 2026-11-14 (planner, pass 4) A leftover `.planner-tmp/` folder (issue body drafts) may be in the repo; I couldn't delete it without approval. Safe to delete. (Pass 5: the folder is no longer present.)
- 2026-11-14 (planner, pass 5) The Demo city starts with all 24 of its packages pre-matched, so the simulator has something to play immediately. The live demo request then uses the remaining free trips (a test checks some exist). Overrule if you'd rather start with zero shipments and create them live.
- 2026-11-14 (planner, pass 5) p1-b got no issue this pass: the 8-issue cap was spent on API/UI work, and p1-b's M1–M4 domain work is all merged. Tell me if you want p1-b on M5 items early.
- 2026-11-14 (planner, pass 6) Sending, editing or retrying a package is refused (409) after Play has locked the run, until "Start new planning cycle". If the simulator was played before the live demo, press Start new planning cycle first (Setup drawer, #82). Overrule if you'd rather allow new packages after lock.
- 2026-11-14 (planner, pass 6) "Start new planning cycle" re-matches every package right away (fresh assignments) instead of leaving them all unmatched. Overrule if reset should clear plans.
- 2026-11-14 (planner, pass 6) I started M5 items (compare, recompute/reset, generate/import/export, scrubber, waypoints) before demo steps 1–6 were verified end to end. The workers had spare capacity, and these touch no files used by the must-have issues (#77, #83, #85). SPEC says nice-to-haves come after 1–10 work. Pull them if you want the team focused.
- 2026-11-14 (planner, pass 6) The BusinessPortal (#83) and Setup drawer (#82) issues code against `createShipment`/`compareMatches` etc. while the matching server routes (#77–#79) are built in parallel. They are typed from `shared/api.ts`, so they work once the routes merge.
- 2026-11-14 (planner, pass 7) Setup drawer CRUD for businesses/employees (nice-to-have 16) needs request schemas in `shared/` (human-owned), so I didn't queue it. Add `CreateBusinessRequest`/`CreateEmployeeRequest` (+ delete rules) if you want it; otherwise it's cut.
- 2026-11-14 (planner, pass 7) Nobody owns `README.md` in AGENTS.md. Should I assign the README (setup + 2-minute demo steps) to victor-1, or will you write it during M6?
- 2026-11-14 (planner, pass 7) The app-wide "Can't reach the Relay server" banner (#108) polls `/api/health` every 3 s. Pull it if you'd rather not have the extra request.
- 2026-11-14 (planner, pass 2) `play` locks the phase on the first press (spec §7: "Freeze the run at playback start"). `reset_playback` rewinds but stays locked; only "Start new planning cycle" unlocks. Overrule if reset should unlock.
