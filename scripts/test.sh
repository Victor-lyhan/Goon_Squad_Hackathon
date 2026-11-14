#!/usr/bin/env bash
# The one check agents, the reviewer and CI run. Must pass before any PR.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi

echo "== typecheck =="
npm run -s typecheck

echo "== tests =="
npx vitest run

echo "== build =="
npm run -s build

echo "OK"
