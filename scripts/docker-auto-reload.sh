#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed." >&2
  exit 1
fi

if ! command -v inotifywait >/dev/null 2>&1; then
  echo "inotifywait is required. Install inotify-tools first." >&2
  echo "Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y inotify-tools" >&2
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo "Missing .env. Copy from .env.example first." >&2
  exit 1
fi

RELOAD_COOLDOWN_SECONDS="${RELOAD_COOLDOWN_SECONDS:-2}"
LAST_RELOAD_EPOCH=0

reload_stack() {
  echo
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuilding/restarting frontend + backend..."
  docker compose up -d --build backend frontend
  echo "Reload complete. Frontend: http://localhost:7070 | Backend: http://127.0.0.1:7071"
}

echo "Watching for changes in backend/, frontend/, docker-compose.yml, and .env"
echo "Press Ctrl+C to stop."

inotifywait -m -r \
  -e close_write,create,delete,move \
  --exclude '(^|/)(\.git|node_modules|\.next|\.venv|__pycache__|vendor|dist|build)(/|$)' \
  backend frontend docker-compose.yml .env |
while read -r changed_path event changed_file; do
  now_epoch="$(date +%s)"
  if (( now_epoch - LAST_RELOAD_EPOCH < RELOAD_COOLDOWN_SECONDS )); then
    continue
  fi

  echo "Detected change: ${changed_path}${changed_file:-} (${event})"
  reload_stack
  LAST_RELOAD_EPOCH="$now_epoch"
done
