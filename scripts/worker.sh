#!/usr/bin/env bash
# Worker loop: fix my PRs sent back by the reviewer, otherwise take my next ready issue.
#
# usage:   scripts/worker.sh <claude|codex> <agent-name> [model]
# examples:
#   EFFORT=high CLAUDE_CONFIG_DIR=~/.claude-pro1 caffeinate -i scripts/worker.sh claude victor-1 sonnet
#   EFFORT=high CODEX_HOME=~/.codex-b            caffeinate -i scripts/worker.sh codex  p1-b
set -u
ENGINE=${1:?engine: claude|codex}; AGENT=${2:?agent name}; MODEL=${3:-}
cd "$(dirname "$0")/.." || exit 1
source scripts/lib.sh
LOG="$REPO_ROOT/logs/worker-$AGENT.log"
LABEL="agent:$AGENT"
FAST_FAIL=90   # a run shorter than this that produced nothing = probably a usage limit / outage

log "worker $AGENT starting ($ENGINE ${MODEL:-default model}, effort ${EFFORT:-default})"

while ! halted; do
  git -C "$REPO_ROOT" fetch -q --prune origin || { backoff 60; continue; }

  # ---------- 1) my PRs that the reviewer sent back ----------
  PR=$(gh pr list --state open --label needs-fix --label "$LABEL" --json number \
        --jq 'sort_by(.number) | .[0].number // empty')
  if [ -n "$PR" ]; then
    BR=$(gh pr view "$PR" --json headRefName --jq .headRefName)
    DIR=$(prep_worktree "$AGENT" "$BR" "origin/$BR")
    git -C "$DIR" merge -q --no-edit origin/main >/dev/null 2>&1 || true   # conflicts are left for the agent
    FEEDBACK=$(gh pr view "$PR" --json comments --jq '.comments[-3:][] | "---\n" + .body')
    PROMPT="$(cat "$REPO_ROOT/prompts/worker.md")

# Your task: fix PR #$PR (branch $BR)
The reviewer requested changes. Most recent feedback (newest last):
$FEEDBACK

main has just been merged into this branch. If 'git status' shows conflicts, resolve them, keeping the intent of both sides."
    log "fixing PR #$PR"
    START=$SECONDS
    run_agent "$ENGINE" "$MODEL" "$DIR" "$PROMPT"
    if commit_all "$DIR" "Address review feedback on #$PR" "origin/$BR" && git -C "$DIR" push -q origin "HEAD:$BR"; then
      gh pr edit "$PR" --remove-label needs-fix --add-label needs-review >/dev/null
      log "PR #$PR updated and sent back for review"
    elif [ $((SECONDS - START)) -lt $FAST_FAIL ]; then
      log "agent failed fast (usage limit?)"; backoff 900
    else
      gh pr comment "$PR" --body "Worker $AGENT could not produce a fix. Needs a human." >/dev/null
      gh pr edit "$PR" --remove-label needs-fix --add-label stuck >/dev/null
      log "PR #$PR marked stuck"
    fi
    continue
  fi

  # ---------- 2) my next ready issue ----------
  N=$(gh issue list --state open --label ready --label "$LABEL" --json number \
       --jq 'sort_by(.number) | .[0].number // empty')
  if [ -z "$N" ]; then sleep 60; continue; fi

  gh issue edit "$N" --remove-label ready --add-label in-progress >/dev/null
  TITLE=$(gh issue view "$N" --json title --jq .title)
  BODY=$(gh issue view "$N" --json body --jq .body)
  BR="issue-$N"
  DIR=$(prep_worktree "$AGENT" "$BR" origin/main)
  PROMPT="$(cat "$REPO_ROOT/prompts/worker.md")

# Your task: issue #$N - $TITLE
$BODY"
  log "working on #$N: $TITLE"
  START=$SECONDS
  run_agent "$ENGINE" "$MODEL" "$DIR" "$PROMPT"

  if [ -f "$DIR/BLOCKED.md" ]; then
    gh issue comment "$N" --body-file "$DIR/BLOCKED.md" >/dev/null
    gh issue edit "$N" --remove-label in-progress --add-label stuck >/dev/null
    log "#$N blocked: $(head -n 1 "$DIR/BLOCKED.md")"
    continue
  fi

  if commit_all "$DIR" "#$N: $TITLE" origin/main && git -C "$DIR" push -q -f origin "HEAD:$BR"; then
    BODYFILE=$(mktemp)
    { [ -f "$DIR/SUMMARY.md" ] && cat "$DIR/SUMMARY.md"; echo; echo "Closes #$N"; echo; echo "_Worker: $AGENT ($ENGINE)_"; } > "$BODYFILE"
    if gh pr create --head "$BR" --base main --title "#$N: $TITLE" --body-file "$BODYFILE" \
         --label "$LABEL" --label needs-review >/dev/null 2>&1; then
      log "opened PR for #$N"
    else
      log "PR for #$N already existed; branch updated"
    fi
    rm -f "$BODYFILE"
    gh issue edit "$N" --remove-label in-progress --add-label in-review >/dev/null
  elif [ $((SECONDS - START)) -lt $FAST_FAIL ]; then
    gh issue edit "$N" --remove-label in-progress --add-label ready >/dev/null
    log "agent failed fast on #$N (usage limit?); put it back"
    backoff 900
  else
    FAILS=$(gh issue view "$N" --json comments --jq '[.comments[].body | select(startswith("Worker attempt failed"))] | length')
    gh issue comment "$N" --body "Worker attempt failed ($AGENT): no usable change." >/dev/null
    if [ "$FAILS" -ge 1 ]; then
      gh issue edit "$N" --remove-label in-progress --add-label stuck >/dev/null; log "#$N marked stuck"
    else
      gh issue edit "$N" --remove-label in-progress --add-label ready >/dev/null; log "#$N will be retried"
    fi
  fi
done
log "worker $AGENT stopped"
