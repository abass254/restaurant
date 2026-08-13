#!/usr/bin/env bash
# Run all FastAPI backend migrations in deterministic order.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

if [[ ! -d ".venv" ]]; then
  echo "Missing backend/.venv. Create it first and install requirements." >&2
  exit 1
fi

source .venv/bin/activate

for f in migrations/*.py; do
  echo "==> Running $f"
  python "$f"
done

echo "FastAPI migrations complete."
