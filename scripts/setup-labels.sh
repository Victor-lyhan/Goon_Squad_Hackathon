#!/usr/bin/env bash
# Create the GitHub labels the loops use. Run once from inside the repo.
# usage: scripts/setup-labels.sh victor-1 victor-2 p1-a p1-b p2-a p2-b
set -e
mk() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null && echo "label: $1"; }
mk ready        0e8a16 "Planned, waiting for its worker"
mk in-progress  fbca04 "A worker is on it"
mk in-review    c5def5 "PR is open"
mk needs-review 1d76db "PR waiting for the reviewer"
mk needs-fix    d93f0b "Reviewer sent the PR back"
mk stuck        b60205 "Needs a human"
mk halt         000000 "Open an issue with this label to stop every loop"
for a in "$@"; do mk "agent:$a" 5319e7 "Assigned to worker $a"; done
