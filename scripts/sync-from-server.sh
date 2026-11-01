#!/usr/bin/env bash
# Pull TransChap from this Ubuntu server to your desktop (no git).
#
# Run this ON YOUR DESKTOP (macOS/Linux/WSL), not on the server:
#
#   ./scripts/sync-from-server.sh ubuntu@YOUR_SERVER_IP /home/ubuntu/new_ig ~/projects/new_ig
#
# Optional env:
#   DRY_RUN=1        — show what would be copied, do not transfer
#   INCLUDE_ENV=1    — also copy .env (secrets; keep archive private)
#   INCLUDE_DATA=1   — also copy SQLite DB + backend/uploads (default: yes)
#   RUN_LOCAL=1      — after sync, run scripts/local-setup.sh on the desktop

set -euo pipefail

REMOTE="${1:-}"
REMOTE_PATH="${2:-}"
LOCAL_PATH="${3:-}"

if [[ -z "${REMOTE}" || -z "${REMOTE_PATH}" || -z "${LOCAL_PATH}" ]]; then
  echo "Usage: $0 user@host /remote/project/path /local/project/path" >&2
  echo "" >&2
  echo "Example (run on your desktop):" >&2
  echo "  $0 ubuntu@54.247.204.95 /home/ubuntu/new_ig ~/projects/new_ig" >&2
  echo "" >&2
  echo "Optional env: DRY_RUN=1  INCLUDE_ENV=1  INCLUDE_DATA=1  RUN_LOCAL=1" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXCLUDES_FILE="${SCRIPT_DIR}/rsync-excludes.txt"

if [[ ! -f "${EXCLUDES_FILE}" ]]; then
  echo "Missing ${EXCLUDES_FILE}" >&2
  exit 1
fi

mkdir -p "${LOCAL_PATH}"

RSYNC_OPTS=(-avz --human-readable --exclude-from="${EXCLUDES_FILE}")
if [[ "${DRY_RUN:-}" == "1" ]]; then
  RSYNC_OPTS+=(--dry-run)
  echo "DRY RUN — no files will be changed locally."
fi

# Secrets are excluded by default; opt in explicitly.
if [[ "${INCLUDE_ENV:-}" != "1" ]]; then
  RSYNC_OPTS+=(--exclude '.env' --exclude '.env.*')
fi

# App data (SQLite + uploaded files) — included by default.
if [[ "${INCLUDE_DATA:-1}" != "1" ]]; then
  RSYNC_OPTS+=(--exclude 'database/database.sqlite*' --exclude 'backend/uploads/')
fi

echo "Pulling ${REMOTE}:${REMOTE_PATH}/ → ${LOCAL_PATH}/"

rsync "${RSYNC_OPTS[@]}" \
  "${REMOTE}:${REMOTE_PATH}/" \
  "${LOCAL_PATH}/"

if [[ "${DRY_RUN:-}" == "1" ]]; then
  exit 0
fi

echo ""
echo "Sync complete."
echo ""
echo "Next on your desktop:"
echo "  cd ${LOCAL_PATH}"
echo "  bash scripts/local-setup.sh"
echo ""
if [[ "${INCLUDE_ENV:-}" != "1" ]]; then
  echo "Environment files were NOT copied. Either:"
  echo "  INCLUDE_ENV=1 $0 ${REMOTE} ${REMOTE_PATH} ${LOCAL_PATH}"
  echo "  scp ${REMOTE}:${REMOTE_PATH}/.env ${LOCAL_PATH}/.env"
fi

if [[ "${RUN_LOCAL:-}" == "1" ]]; then
  echo "Running local-setup.sh..."
  bash "${LOCAL_PATH}/scripts/local-setup.sh"
fi
