# Agent kit: quick reference

Copy everything in this folder into the root of your hackathon repo.

## Files
- `AGENTS.md`: rules for all agents (fill in the <FILL IN> parts). `CLAUDE.md` points to it.
- `SPEC.md`: what you're building and the milestones (humans write this before starting).
- `STATUS.md`, `DECISIONS.md`, `QUESTIONS.md`: shared memory (planner maintains).
- `contracts/`: interfaces between modules. Write these before starting the agents.
- `prompts/`: planner, worker and reviewer instructions.
- `scripts/planner.sh`, `scripts/worker.sh`, `scripts/reviewer.sh`: the loops.
- `scripts/setup-labels.sh`: creates the GitHub labels (run once).
- `scripts/test.sh`: the one test command agents and CI run. Edit it for your stack.

## Start the loops (one terminal tab each; `caffeinate -i` keeps a Mac awake)
Victor (Ultra = default ~/.claude, Pro = ~/.claude-pro1):
```
EFFORT=high   caffeinate -i scripts/planner.sh fable 20
EFFORT=high   caffeinate -i scripts/reviewer.sh claude opus
EFFORT=medium caffeinate -i scripts/worker.sh claude victor-2 opus
EFFORT=high   CLAUDE_CONFIG_DIR=~/.claude-pro1 caffeinate -i scripts/worker.sh claude victor-1 sonnet
```
Louis (Codex A = default ~/.codex, Codex B = ~/.codex-b):
```
EFFORT=high caffeinate -i scripts/worker.sh codex p1-a
EFFORT=high CODEX_HOME=~/.codex-b caffeinate -i scripts/worker.sh codex p1-b
```
Siddharth (Pro A = default ~/.claude, Pro B = ~/.claude-b):
```
EFFORT=high caffeinate -i scripts/worker.sh claude p2-a sonnet
EFFORT=high CLAUDE_CONFIG_DIR=~/.claude-b caffeinate -i scripts/worker.sh claude p2-b sonnet
```
Update Claude Code first (`claude update`): Fable 5.2 needs a recent version.
On Linux, drop `caffeinate -i` and disable suspend instead. On Windows, use WSL.

## Watch / stop
- Live log: `tail -f logs/worker-victor-1.log` (or planner.log, reviewer.log)
- Stop one laptop: `touch STOP` in the repo (delete it to allow restarting)
- Stop everything, from anywhere (even your phone): open a GitHub issue with the label `halt`. Close it to allow restarting.
- Loops finish their current task before stopping.

## Labels (how work moves)
issue: `ready` -> `in-progress` -> `in-review` -> closed by the merged PR
PR: `needs-review` -> merged, or `needs-fix` -> `needs-review` ... -> `stuck` after 3 rejected rounds
`stuck` = needs a human (the planner also tries to split it up)
