#!/usr/bin/env bash
# Run on Ubuntu after first sync: install FastAPI + frontend deps, then migrate.
# Requires: Python 3.11+, Node 20+.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d backend || ! -d frontend ]]; then
  echo "Run this from the project root (backend/ and frontend/ expected)." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env — copy from .env.example to ${ROOT}/.env" >&2
  exit 1
fi

command -v python3 >/dev/null || {
  echo "Install Python 3.11+." >&2
  exit 1
}

echo "Setting up backend virtualenv..."
cd "$ROOT/backend"
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "Running FastAPI migrations..."
bash "$ROOT/scripts/backend-migrate.sh"

if command -v npm >/dev/null && [[ -f "$ROOT/frontend/package.json" ]]; then
  echo "Installing frontend dependencies and building Next.js app..."
  cd "$ROOT/frontend"
  npm ci
  npm run build
fi

echo ""
echo "Done."
echo "Start API:      cd ${ROOT}/backend && source .venv/bin/activate && uvicorn app.main:app --host 127.0.0.1 --port 7001"
echo "Start frontend: cd ${ROOT}/frontend && npm start"
