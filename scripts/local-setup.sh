#!/usr/bin/env bash
# Run on your desktop after pulling or extracting the project from the server.
# Installs Python + Node deps and runs migrations. Does not need git.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d backend || ! -d frontend ]]; then
  echo "Run this from the project root (backend/ and frontend/ expected)." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env — copy from the example and fill secrets:" >&2
  echo "  cp .env.example .env" >&2
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
  echo "Installing frontend dependencies..."
  cd "$ROOT/frontend"
  npm ci
else
  echo "npm not found — install Node 20+ and run: cd frontend && npm ci" >&2
fi

echo ""
echo "Done. Start development:"
echo "  Terminal 1: cd ${ROOT}/backend && ./run.sh"
echo "  Terminal 2: cd ${ROOT}/frontend && npm run dev"
echo ""
echo "URLs: frontend http://127.0.0.1:7000  backend http://127.0.0.1:7001"
