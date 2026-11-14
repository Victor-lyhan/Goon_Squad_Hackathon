# QUESTIONS for the humans

Agents add questions here; humans answer inline and move settled items to DECISIONS.md.

- 2026-11-14 (planner) I authorized p2-a (#5) to edit the root `tsconfig.json` and `vitest.config.ts` to enable `.tsx` component tests via `react-dom/server` (no new deps). These are human-owned configs. Overrule if you'd rather do that change yourselves.
- 2026-11-14 (planner) I authorized p2-a (#5) to replace the 2-line stubs in `BusinessPortal.tsx`, `EmployeePortal.tsx` and `Simulator.tsx` with title-only default-export placeholders so the router compiles. The owning workers build the real pages later. OK?
- 2026-11-14 (planner) UI workers (p2-b, victor-2) have no `tests/` path in the AGENTS.md table. I assigned `tests/ui/` prefixes per worker (see DECISIONS.md). Consider adding these to AGENTS.md.
