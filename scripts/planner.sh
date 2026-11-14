#!/usr/bin/env bash
# Planner loop: every N minutes, look at the repo state and queue the next tasks.
#
# usage:   scripts/planner.sh [model] [interval-minutes]
# example: EFFORT=high caffeinate -i scripts/planner.sh fable 20
set -u
MODEL=${1:-fable}; INTERVAL=${2:-20}
export EFFORT=${EFFORT:-high}
cd "$(dirname "$0")/.." || exit 1
source scripts/lib.sh
LOG="$REPO_ROOT/logs/planner.log"

log "planner starting (model $MODEL, effort $EFFORT, every ${INTERVAL} min)"

while ! halted; do
  git -C "$REPO_ROOT" checkout -q main
  git -C "$REPO_ROOT" pull -q --rebase origin main || { git -C "$REPO_ROOT" rebase --abort 2>/dev/null; git -C "$REPO_ROOT" fetch -q origin main && git -C "$REPO_ROOT" reset -q --hard origin/main; log "pull failed; reset to origin/main"; backoff 30; continue; }

  CTX="## Open issues (number [labels] title)
$(gh issue list --state open --limit 100 --json number,title,labels --jq '.[] | "#\(.number) [\([.labels[].name] | join(","))] \(.title)"')

## Open PRs
$(gh pr list --state open --limit 50 --json number,title,labels --jq '.[] | "#\(.number) [\([.labels[].name] | join(","))] \(.title)"')

## Recently merged PRs (newest first)
$(gh pr list --state merged --limit 15 --json number,title,mergedAt --jq '.[] | "#\(.number) \(.mergedAt) \(.title)"')

## Latest CI runs on main
$(gh run list --branch main --limit 3 --json conclusion,status,displayTitle --jq '.[] | "\(.status)/\(.conclusion) \(.displayTitle)"' 2>/dev/null)"

  PROMPT="$(cat "$REPO_ROOT/prompts/planner.md")

# Current state ($(date '+%Y-%m-%d %H:%M'))
$CTX"

  log "planning pass"
  START=$SECONDS
  MAX_TURNS=60 \
  TOOLS="Read,Edit,Write,Glob,Grep,Bash(gh issue:*),Bash(gh pr view:*),Bash(gh pr diff:*),Bash(gh run view:*),Bash(git log:*),Bash(git diff:*),Bash(git show:*),Bash(ls:*)" \
    run_agent claude "$MODEL" "$REPO_ROOT" "$PROMPT"
  [ $((SECONDS - START)) -lt 60 ] && log "planner pass was very short (usage limit?)"

  # Only the shared-memory files are committed from the planner; anything else it touched is discarded.
  git -C "$REPO_ROOT" add STATUS.md DECISIONS.md QUESTIONS.md 2>/dev/null
  if ! git -C "$REPO_ROOT" diff --cached --quiet; then
    git -C "$REPO_ROOT" commit -q -m "planner: update status ($(date '+%H:%M'))"
    { git -C "$REPO_ROOT" pull -q --rebase origin main || { git -C "$REPO_ROOT" rebase --abort 2>/dev/null; git -C "$REPO_ROOT" reset -q --hard origin/main; false; }; } && git -C "$REPO_ROOT" push -q origin main \
      && log "pushed STATUS/DECISIONS/QUESTIONS" || log "push failed; will retry next pass"
  fi
  git -C "$REPO_ROOT" reset -q --hard HEAD
  git -C "$REPO_ROOT" clean -fdq -e logs -e STOP

  sleep $((INTERVAL * 60))
done
log "planner stopped"
