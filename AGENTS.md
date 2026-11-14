# AGENTS.md: rules for every agent (Claude and Codex)

Read this, SPEC.md and DECISIONS.md before doing anything.

## Project
See SPEC.md. One-line summary: <FILL IN>

## Team roster and module ownership
| Worker label | Engine | Module | Owns paths |
| --- | --- | --- | --- |
| agent:p1-a, agent:p1-b (Louis) | Codex | A: core backend / logic | `backend/` |
| agent:p2-a, agent:p2-b (Siddharth) | Claude Sonnet | B: frontend / UI | `frontend/` |
| agent:victor-1, agent:victor-2 (Victor) | Claude Sonnet | C: integration / infra / ML / glue | `integration/`, `scripts/`, `infra/` |

Shared and human-owned: `contracts/`, `SPEC.md`, `AGENTS.md`. Agents do not edit these unless an issue says so.

## Commands
- Install: <FILL IN, e.g. `cd backend && pip install -r requirements.txt`; `cd frontend && npm install`>
- Test everything: `bash scripts/test.sh` (must pass before any PR)
- Run locally: <FILL IN>
- Env vars needed: <FILL IN names only, never values>

## Rules
1. Work only on your assigned task, inside your module's paths.
2. Interfaces between modules are defined in `contracts/`. Code to them exactly.
3. Every change comes with a test or a runnable check.
4. Never commit secrets. Read keys from environment variables.
5. Prefer boring, well-known libraries. Don't add a dependency without saying why in SUMMARY.md.
6. Do not commit or push yourself; the loop scripts do it. Do not touch other branches.
7. If blocked, write BLOCKED.md (see prompts/worker.md) instead of guessing at a contract change.

## Review guidelines
Used by the reviewer loop and by Codex code review on GitHub.
- Blocking (P0/P1): failing tests/build, broken contract, secrets in code, crashes on the demo path, edits outside the module without explanation.
- Not blocking: style, naming, small refactors, missing polish.
- Keep main demo-able at all times.
