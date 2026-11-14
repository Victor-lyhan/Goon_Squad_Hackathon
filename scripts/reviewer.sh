#!/usr/bin/env bash
# Reviewer + merger loop: review the oldest PR labeled needs-review, then merge it or send it back.
#
# usage:   scripts/reviewer.sh <claude|codex> [model] [name]
# example: EFFORT=high caffeinate -i scripts/reviewer.sh claude opus
set -u
ENGINE=${1:?engine: claude|codex}; MODEL=${2:-}; NAME=${3:-reviewer}
cd "$(dirname "$0")/.." || exit 1
source scripts/lib.sh
LOG="$REPO_ROOT/logs/$NAME.log"
MAX_ROUNDS=3

log "$NAME starting ($ENGINE ${MODEL:-default model})"

while ! halted; do
  git -C "$REPO_ROOT" fetch -q --prune origin || { backoff 60; continue; }
  FILTER=${PARITY:+".number % 2 == $PARITY"}; FILTER=${FILTER:-true}
  PR=$(gh pr list --state open --label needs-review --json number \
        --jq "map(select($FILTER)) | sort_by(.number) | .[0].number // empty")
  if [ -z "$PR" ]; then sleep 60; continue; fi

  BR=$(gh pr view "$PR" --json headRefName --jq .headRefName)
  DIR=$(prep_worktree "$NAME" "review-scratch" "origin/$BR")
  INFO=$(gh pr view "$PR" --json title,body,comments,reviews --jq \
    '"# " + .title + "\n\n" + .body + "\n\n## Earlier comments and reviews (includes Codex auto-review, if any)\n" + ([.comments[].body, .reviews[].body] | map(select(. != "")) | join("\n---\n"))')
  ISSUE=$(gh pr view "$PR" --json body --jq .body | grep -oE '[Cc]loses #[0-9]+' | grep -oE '[0-9]+' | head -n 1)
  ISSUE_TXT=""
  [ -n "$ISSUE" ] && ISSUE_TXT=$(gh issue view "$ISSUE" --json title,body --jq '"#'"$ISSUE"' " + .title + "\n\n" + .body')

  PROMPT="$(cat "$REPO_ROOT/prompts/reviewer.md")

# PR #$PR (branch $BR)
$INFO

# Linked issue
${ISSUE_TXT:-none found}

The change to review is: git diff origin/main...HEAD"
  log "reviewing PR #$PR"
  START=$SECONDS
  MAX_TURNS=30 TOOLS="Read,Glob,Grep,Bash,Write" run_agent "$ENGINE" "$MODEL" "$DIR" "$PROMPT"

  if [ ! -f "$DIR/REVIEW.md" ]; then
    log "no REVIEW.md produced for #$PR (usage limit?)"
    [ $((SECONDS - START)) -lt 90 ] && backoff 900 || backoff 120
    continue
  fi
  gh pr comment "$PR" --body-file "$DIR/REVIEW.md" >/dev/null

  if tail -n 5 "$DIR/REVIEW.md" | grep -q 'VERDICT: APPROVE'; then
    if gh pr merge "$PR" --squash >/dev/null 2>&1; then
      git -C "$REPO_ROOT" push -q origin --delete "$BR" >/dev/null 2>&1
      log "merged PR #$PR"
    else
      gh pr comment "$PR" --body "Approved, but the merge failed (probably a conflict with main). Worker: merge origin/main and resolve." >/dev/null
      gh pr edit "$PR" --remove-label needs-review --add-label needs-fix >/dev/null
      log "PR #$PR approved but not mergeable; sent back"
    fi
  else
    ROUNDS=$(gh pr view "$PR" --json comments --jq '[.comments[].body | select(test("VERDICT: CHANGES"))] | length')
    if [ "$ROUNDS" -ge "$MAX_ROUNDS" ]; then
      gh pr edit "$PR" --remove-label needs-review --add-label stuck >/dev/null
      log "PR #$PR rejected $ROUNDS times; marked stuck"
    else
      gh pr edit "$PR" --remove-label needs-review --add-label needs-fix >/dev/null
      log "PR #$PR needs changes (round $ROUNDS)"
    fi
  fi
done
log "$NAME stopped"
