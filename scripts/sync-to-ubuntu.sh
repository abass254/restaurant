#!/usr/bin/env bash
# Sync DukAI (FastAPI + Next.js) to an Ubuntu server.
#
# Usage:
#   ./scripts/sync-to-ubuntu.sh ubuntu@YOUR_SERVER_IP /var/www/new_ig
#
# Optional env:
#   DRY_RUN=1     — show what would be copied, do not transfer
#   RUN_REMOTE=1  — after sync, SSH and run scripts/remote-setup.sh on the server

set -euo pipefail

REMOTE="${1:-}"
REMOTE_PATH="${2:-}"

if [[ -z "${REMOTE}" || -z "${REMOTE_PATH}" ]]; then
  echo "Usage: $0 user@host /remote/path" >&2
  echo "Example: $0 ubuntu@54.247.204.95 /var/www/new_ig" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RSYNC_OPTS=(-avz --human-readable)
if [[ "${DRY_RUN:-}" == "1" ]]; then
  RSYNC_OPTS+=(--dry-run)
  echo "DRY RUN — no files will be changed on the server."
fi

echo "Syncing ${ROOT} → ${REMOTE}:${REMOTE_PATH}/"

rsync "${RSYNC_OPTS[@]}" \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'node_modules/' \
  --exclude 'backend/.venv/' \
  --exclude 'backend/uploads/' \
  --exclude 'backend/__pycache__/' \
  --exclude 'backend/.pytest_cache/' \
  --exclude 'backend/.mypy_cache/' \
  --exclude 'frontend/.next/' \
  --exclude '.DS_Store' \
  --exclude '.cursor/' \
  --exclude '.idea/' \
  --exclude '.vscode/' \
  ./ "${REMOTE}:${REMOTE_PATH}/"

if [[ "${DRY_RUN:-}" == "1" ]]; then
  exit 0
fi

echo ""
echo "Sync complete."
echo "Next on the server (first time):"
echo "  ssh ${REMOTE}"
echo "  cd ${REMOTE_PATH}"
echo "  bash scripts/remote-setup.sh"
echo ""
echo "Copy .env separately (never via git):"
echo "  scp .env ${REMOTE}:${REMOTE_PATH}/.env"

if [[ "${RUN_REMOTE:-}" == "1" ]]; then
  echo "Running remote-setup.sh on server..."
  ssh "${REMOTE}" "cd ${REMOTE_PATH} && bash scripts/remote-setup.sh"
fi
