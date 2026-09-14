#!/usr/bin/env bash
# Push local backend/uploads files to the production media host folder.
#
# Production serves https://merchants.dukai.app/uploads/... from
# /home/ubuntu/agents/uploads on the merchants server.
#
# Usage:
#   ./scripts/push-uploads-to-prod.sh
#   ./scripts/push-uploads-to-prod.sh ubuntu@13.38.152.115
#   DRY_RUN=1 ./scripts/push-uploads-to-prod.sh
#
# Optional env:
#   UPLOADS_REMOTE_HOST   default: ubuntu@13.38.152.115
#   UPLOADS_REMOTE_PATH   default: /home/ubuntu/agents/uploads
#   DRY_RUN=1             show what would transfer
#   DELETE=1              also remove remote files not present locally (dangerous)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="${ROOT}/backend/uploads/"
REMOTE_HOST="${1:-${UPLOADS_REMOTE_HOST:-ubuntu@13.38.152.115}}"
REMOTE_PATH="${UPLOADS_REMOTE_PATH:-/home/ubuntu/agents/uploads}"

if [[ ! -d "${LOCAL}" ]]; then
  echo "No local uploads dir at ${LOCAL}" >&2
  exit 1
fi

RSYNC_OPTS=(-avz --human-readable --ignore-existing)
if [[ "${DRY_RUN:-}" == "1" ]]; then
  RSYNC_OPTS+=(--dry-run)
  echo "DRY RUN — no files will be written on the server."
fi
if [[ "${DELETE:-}" == "1" ]]; then
  RSYNC_OPTS+=(--delete)
  echo "WARNING: DELETE=1 will remove remote files missing locally."
fi

echo "Pushing ${LOCAL} → ${REMOTE_HOST}:${REMOTE_PATH}/"
echo "(--ignore-existing: only files not already on the server)"

rsync "${RSYNC_OPTS[@]}" \
  --exclude '.gitignore' \
  --exclude '.DS_Store' \
  "${LOCAL}" \
  "${REMOTE_HOST}:${REMOTE_PATH}/"

echo ""
echo "Done. Public URLs: https://merchants.dukai.app/uploads/..."
