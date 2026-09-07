#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${BACKEND_RUNTIME:-fastapi}" != "fastapi" ]]; then
  echo "This project runs FastAPI only. Use BACKEND_RUNTIME=fastapi (or omit it)." >&2
  exit 1
fi

cd "$ROOT_DIR/backend"
if [[ ! -x .venv/bin/python ]] || ! .venv/bin/python -c "import sys" >/dev/null 2>&1; then
  rm -rf .venv
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi

exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${APP_PORT:-7001}" --reload
