#!/usr/bin/env bash
# FastAPI API for local / tunneled dev.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

if [[ ! -d ".venv" ]]; then
  echo "Missing backend/.venv. Create it with:" >&2
  echo "  cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt" >&2
  exit 1
fi

source .venv/bin/activate
exec uvicorn app.main:app --host=127.0.0.1 --port="${APP_PORT:-7001}" --reload
