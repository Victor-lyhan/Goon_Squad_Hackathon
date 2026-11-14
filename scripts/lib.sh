# Shared helpers for planner.sh / worker.sh / reviewer.sh  (sourced, not run)
# Works with macOS bash 3.2 and Linux bash.

REPO_ROOT=$(git rev-parse --show-toplevel) || { echo "run inside the repo"; exit 1; }
WT_BASE="$(dirname "$REPO_ROOT")/wt-$(basename "$REPO_ROOT")"   # worktrees live next to the repo
mkdir -p "$WT_BASE" "$REPO_ROOT/logs"
LOG="$REPO_ROOT/logs/agent.log"   # each script overrides this

log() { echo "[$(date '+%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

backoff() { log "sleeping ${1}s"; sleep "$1"; }

# Kill switch: a local STOP file, or any open GitHub issue labeled "halt" (works from your phone).
halted() {
  [ -f "$REPO_ROOT/STOP" ] && { log "STOP file found"; return 0; }
  local h
  h=$(gh issue list --state open --label halt --json number --jq '.[0].number // empty' 2>/dev/null)
  [ -n "$h" ] && { log "halt issue #$h is open"; return 0; }
  return 1
}

# One reusable worktree per agent: wipe it, then point it at <branch> starting from <start-point>.
# usage: DIR=$(prep_worktree <name> <branch> <start-point>)
prep_worktree() {
  local dir="$WT_BASE/$1"
  if [ ! -d "$dir" ]; then
    git -C "$REPO_ROOT" worktree add -q --detach "$dir" origin/main >/dev/null 2>&1
  fi
  git -C "$dir" merge --abort >/dev/null 2>&1
  git -C "$dir" reset -q --hard >/dev/null 2>&1
  git -C "$dir" clean -fdq >/dev/null 2>&1          # keeps ignored files such as node_modules
  rm -f "$dir/SUMMARY.md" "$dir/BLOCKED.md" "$dir/REVIEW.md"
  git -C "$dir" checkout -q -B "$2" "$3" >/dev/null 2>&1
  echo "$dir"
}

# Run one agent turn in a directory.
# Env: EFFORT (low|medium|high|xhigh|max for Claude; minimal|low|medium|high for Codex),
#      MAX_TURNS and TOOLS (Claude only).
# usage: run_agent <claude|codex> <model-or-empty> <dir> <prompt>
run_agent() {
  local engine=$1 model=$2 dir=$3 prompt=$4
  if [ "$engine" = claude ]; then
    (cd "$dir" && claude -p "$prompt" ${model:+--model "$model"} ${EFFORT:+--effort "$EFFORT"} \
        --max-turns "${MAX_TURNS:-60}" \
        --allowedTools "${TOOLS:-Read,Edit,Write,Glob,Grep,Bash}") >>"$LOG" 2>&1
  else
    # --full-auto = sandboxed, writes limited to the worktree. If package installs fail
    # inside Codex, install dependencies in the worktree yourself before bed (see README).
    (cd "$dir" && codex exec --full-auto ${model:+-m "$model"} ${EFFORT:+-c model_reasoning_effort="$EFFORT"} "$prompt") >>"$LOG" 2>&1
  fi
}

# Stage + commit everything; succeed only if HEAD is now ahead of <base> and no conflict markers remain.
# usage: commit_all <dir> <message> <base-ref>
commit_all() {
  local dir=$1 msg=$2 base=$3
  git -C "$dir" add -A
  if git -C "$dir" diff --cached --name-only | while read -r f; do
       [ -f "$dir/$f" ] && grep -q '^<<<<<<< ' "$dir/$f" && echo "$f"; done | grep -q .; then
    log "conflict markers still present; not committing"
    return 1
  fi
  git -C "$dir" commit -q -m "$msg" >/dev/null 2>&1   # also concludes an in-progress merge
  [ "$(git -C "$dir" rev-list --count "$base..HEAD" 2>/dev/null || echo 0)" -gt 0 ]
}
